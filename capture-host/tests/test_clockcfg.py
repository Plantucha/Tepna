# tepna-capture — clockcfg tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import asyncio

import pytest
import clockcfg


def test_dur_to_sec_handles_pretty_and_raw():
    assert clockcfg._dur_to_sec("32s") == 32
    assert clockcfg._dur_to_sec("34min 8s") == 2048
    assert clockcfg._dur_to_sec("5s") == 5
    assert clockcfg._dur_to_sec("2048000000") == 2048        # raw microseconds
    assert clockcfg._dur_to_sec("") is None
    assert clockcfg._dur_to_sec(None) is None


def test_valid_servers_rejects_shell_metachars():
    got = clockcfg._valid_servers(["192.168.0.123", "bad;rm -rf", "pool.ntp.org", "", "a b"])
    assert got == ["192.168.0.123", "pool.ntp.org"]


def test_kv_parse():
    d = clockcfg._kv("NTP=yes\nNTPSynchronized=yes\nTimezone=America/New_York\n")
    assert d["NTP"] == "yes" and d["Timezone"] == "America/New_York"


# ── the privileged surface ──────────────────────────────────────────────────────────────────────────
# Everything below ends up as argv to a NOPASSWD-sudo helper, so validation IS the security boundary: a
# permissive regex here hands attacker-influenced strings to a root shell. These tests concentrate on the
# refusal paths and on the argv actually handed over. `_run` is stubbed; no timedatectl is invoked.

def _go(coro):
    return asyncio.run(coro)


def _stub_helper(monkeypatch, rc=0, out="done", record=None):
    async def fake_run(*args, timeout=20):
        if record is not None:
            record.append(list(args))
        return rc, out
    monkeypatch.setattr(clockcfg, "_run", fake_run)
    monkeypatch.setattr(clockcfg.os, "access", lambda *a, **k: True)


def test_set_ntp_refuses_when_nothing_survives_validation(monkeypatch):
    called = []
    _stub_helper(monkeypatch, record=called)
    r = _go(clockcfg.set_ntp(["; rm -rf /", ""], 1024))
    assert r["ok"] is False and "no valid NTP server" in r["detail"]
    assert not called, "the helper must not run at all when every server was rejected"


def test_set_ntp_drops_a_bad_server_but_keeps_the_good_ones(monkeypatch):
    rec = []
    _stub_helper(monkeypatch, record=rec)
    r = _go(clockcfg.set_ntp(["pool.ntp.org", "bad;server", "162.159.200.1"], 1024))
    argv = rec[0]
    assert argv[:2] == ["sudo", "-n"], "the privileged path must be non-interactive sudo"
    assert "ntp" in argv and "1024" in argv
    assert not any("bad;server" in a for a in argv), "a rejected server must never reach the helper"
    assert r["servers"] == ["pool.ntp.org", "162.159.200.1"]


@pytest.mark.parametrize("given,expected", [(1, 64), (10**9, 86400), (1024, 1024)])
def test_set_ntp_clamps_the_poll_interval(monkeypatch, given, expected):
    _stub_helper(monkeypatch)
    assert _go(clockcfg.set_ntp(["pool.ntp.org"], given))["poll_max_sec"] == expected


def test_set_ntp_rejects_a_non_numeric_interval(monkeypatch):
    called = []
    _stub_helper(monkeypatch, record=called)
    r = _go(clockcfg.set_ntp(["pool.ntp.org"], "soon"))
    assert r["ok"] is False and r["detail"] == "bad interval"
    assert not called


def test_sudo_can_be_disabled_for_a_dev_box(monkeypatch):
    rec = []
    _stub_helper(monkeypatch, record=rec)
    _go(clockcfg.set_ntp(["pool.ntp.org"], 1024, sudo=False))
    assert rec[0][0] != "sudo"


@pytest.mark.parametrize("zone", ["UTC", "America/New_York", "Europe/Prague"])
def test_set_tz_accepts_real_zone_names(monkeypatch, zone):
    _stub_helper(monkeypatch)
    assert _go(clockcfg.set_tz(zone))["timezone"] == zone


@pytest.mark.parametrize("zone", ["", "   ", None, "Europe/Prague; reboot", "$(id)", "Europe Prague",
                                  "Europe/Prague\nreboot", "Europe/Prague&&id"])
def test_set_tz_refuses_anything_unlike_a_zone(monkeypatch, zone):
    called = []
    _stub_helper(monkeypatch, record=called)
    r = _go(clockcfg.set_tz(zone))
    assert r["ok"] is False and r["detail"] == "bad timezone"
    assert not called, "a rejected timezone must not reach the privileged helper"


def test_tz_regex_alone_permits_a_traversal_shaped_name(monkeypatch):
    """DOCUMENTS A KNOWN GAP rather than asserting a contract we do not have.

    `_TZ_RE` is `^[A-Za-z0-9/_.+-]+$`, which permits '.' and '/', so `../../etc/passwd` passes the
    Python-side validator and IS handed to the helper. Two gates downstream stop it: tepna-clock.sh
    re-checks the same character class and then requires `-f /usr/share/zoneinfo/$zone` to exist, and
    timedatectl itself rejects a non-IANA name. So this is not a live escalation — but the defence is
    entirely downstream, and that `-f` test is itself traversal-relative. Anyone tightening `_TZ_RE`
    (e.g. forbidding '..' outright) should flip this test to the refusal list."""
    rec = []
    _stub_helper(monkeypatch, record=rec)
    r = _go(clockcfg.set_tz("../../etc/passwd"))
    assert r["detail"] != "bad timezone", "if this now fails, _TZ_RE was tightened — move the case above"
    assert rec, "it currently reaches the helper, which is what the downstream gates then reject"


def test_set_tz_trims_surrounding_whitespace(monkeypatch):
    _stub_helper(monkeypatch)
    assert _go(clockcfg.set_tz("  UTC  "))["timezone"] == "UTC"


def test_a_missing_helper_is_reported_not_raised(monkeypatch):
    monkeypatch.setattr(clockcfg.os, "access", lambda *a, **k: False)
    r = _go(clockcfg.sync_now())
    assert r["ok"] is False and "missing" in r["detail"]


def test_a_nonzero_exit_is_reported_as_failure_with_its_output(monkeypatch):
    _stub_helper(monkeypatch, rc=1, out="Failed to set time: Access denied")
    r = _go(clockcfg.sync_now())
    assert r["ok"] is False and "Access denied" in r["detail"]


def test_helper_output_is_truncated(monkeypatch):
    """The output is echoed into a JSON API response; an unbounded blob would be reflected to the UI."""
    _stub_helper(monkeypatch, rc=0, out="x" * 5000)
    assert len(_go(clockcfg.sync_now())["detail"]) <= 400


def test_sync_now_succeeds_on_a_zero_exit(monkeypatch):
    _stub_helper(monkeypatch, rc=0, out="ok")
    assert _go(clockcfg.sync_now())["ok"] is True


def test_run_reports_a_missing_binary_rather_than_raising():
    rc, out = _go(clockcfg._run("definitely-not-a-real-binary-xyz"))
    assert rc == 127 and "not found" in out


def test_status_reports_unavailable_when_timedatectl_is_missing(monkeypatch):
    async def fake_run(*args, timeout=12):
        return 127, "timedatectl not found"
    monkeypatch.setattr(clockcfg, "_run", fake_run)
    assert _go(clockcfg.status())["available"] is False


def test_status_reads_timezone_and_sync_flag(monkeypatch):
    async def fake_run(*args, timeout=12):
        if "show-timesync" in args:
            return 0, "SystemNTPServers=pool.ntp.org\n"
        return 0, "NTP=yes\nNTPSynchronized=yes\nTimezone=America/New_York\n"
    monkeypatch.setattr(clockcfg, "_run", fake_run)
    st = _go(clockcfg.status())
    assert st["available"] is True and st["timezone"] == "America/New_York"
    # Exact list equality, not `"pool.ntp.org" in st["servers"]`: `servers` is a LIST so `in` would be
    # exact membership anyway, but the substring-looking form trips CodeQL's
    # py/incomplete-url-substring-sanitization (high) — and asserting the whole list is the stronger
    # check regardless, since it also pins that nothing extra was parsed out of the timesync block.
    assert st["synchronized"] is True and st["servers"] == ["pool.ntp.org"]
