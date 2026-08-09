# tepna-capture — tests/test_cpap_wpa_up.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `_wpa_up` is the association: write a wpa_supplicant config holding the card's PSK, bring the
# interface up, start the supplicant, wait bounded for COMPLETED, then add an address and NO route.
# CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04 §4 step 3, built on the `recorded_run` double.
#
# Everything it does is `sudo -n`, and it is the only privileged code in the harvest. Nothing asserted
# on the commands it issues, their deadlines, the config it writes, or the mode it writes it with — so
# the PSK's file permissions, the interface name reaching wpa_cli, and every timeout were unobservable.

import os

import pytest

import cpap_harvest as ch


@pytest.fixture
def wpa(monkeypatch, recorded_run, completed, tmp_path):
    """Drives _wpa_up with a writable control dir and no real sleeping."""
    wdir = tmp_path / "run" / "wpa_supplicant"
    wdir.mkdir(parents=True)
    # RECORDS the root rather than swallowing it — a double that accepts an argument and discards it
    # makes the code computing that argument unobservable, which is the defect this whole campaign
    # keeps finding. `_wpa_dir(root)` resolving to the wrong place puts the control socket somewhere
    # wpa_cli will not look, and every association poll then fails on a card that DID associate.
    seen_roots = []

    def _dir(root=None):
        seen_roots.append(root)
        return str(wdir)

    monkeypatch.setattr(ch, "_wpa_dir", _dir)
    monkeypatch.setattr(ch.time, "sleep", lambda s: None)
    monkeypatch.setattr(ch, "associated", lambda iface, **kw: None)   # force the wpa_cli fallback
    # associate by default: wpa_cli reports COMPLETED, so the happy path exits the wait at once
    recorded_run.reply = lambda argv: completed(0, "bssid=00:11\nwpa_state=COMPLETED\n", "")
    recorded_run.completed = completed
    recorded_run.wdir = str(wdir)
    recorded_run.seen_roots = seen_roots
    return recorded_run


def _conf_written(rec):
    """The config path is the `-c` argument of the wpa_supplicant invocation."""
    for c in rec.calls:
        if c.argv and "wpa_supplicant" in c.argv:
            return c.argv[c.argv.index("-c") + 1]
    return None


# ── the PSK on disk ─────────────────────────────────────────────────────────────────────────────────
def test_the_config_holding_the_psk_is_owner_only(wpa, monkeypatch):
    """`os.chmod(conf, 0o600)`, and the comment beside it states why: the PSK is in that file. 0o601 —
    which is what the literal becomes if the octal is read as decimal 385 — leaves it WORLD-EXECUTABLE,
    and any mode that grants a group or other bit puts the card's key in reach of every account on the
    box. The file is short-lived, not secret-free."""
    seen = {}
    real_chmod = os.chmod
    monkeypatch.setattr(ch.os, "chmod", lambda p, m: (seen.__setitem__("mode", m), real_chmod(p, m))[1])

    ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)
    assert seen["mode"] == 0o600, "owner read/write only"
    assert seen["mode"] & 0o077 == 0, "no group or other bit may be set on a file holding the PSK"


def test_the_config_carries_the_control_dir_ssid_and_psk(wpa):
    """A config written with a None in any of the three slots associates to nothing — and the failure
    surfaces minutes later as 'did not associate', pointing at the radio rather than at the file."""
    written = {}
    real_write = os.write

    def spy(fd, data):
        written.setdefault("blob", b"")
        written["blob"] += data
        return real_write(fd, data)

    import unittest.mock as _m
    with _m.patch.object(ch.os, "write", spy):
        ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)

    blob = written["blob"].decode()
    assert f"ctrl_interface={wpa.wdir}" in blob, "the supplicant must be told where its socket goes"
    assert 'ssid="ez Share"' in blob
    assert 'psk="88888888"' in blob


def test_the_config_file_is_named_so_a_leftover_is_identifiable(wpa):
    """prefix/suffix are how an operator finds one of these if the unlink in `finally` ever loses a
    race — an anonymous /tmp file holding a PSK is worse than a named one."""
    ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)
    conf = _conf_written(wpa)
    assert conf is not None
    base = os.path.basename(conf)
    assert base.startswith("tepna-ezshare-") and base.endswith(".conf")


# ── the command sequence, its privileges and its deadlines ──────────────────────────────────────────
def test_the_association_runs_these_commands_as_root_with_these_bounds(wpa):
    """Every bound here is the difference between a harvest that fails and one that hangs. `_sh` never
    raises, so a `None` timeout does not error — it removes the deadline from a command run against a
    Wi-Fi card that may never answer, and the daemon waits forever with the radio held."""
    ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)

    by = {}
    for c in wpa.calls:
        key = next((p for p in ("ip", "wpa_supplicant", "wpa_cli") if p in (c.argv or [])), None)
        by.setdefault(key, []).append(c)

    link_up = next(c for c in by["ip"] if "link" in c.argv)
    assert link_up.argv == ["sudo", "-n", "ip", "link", "set", "wlan0", "up"]
    assert link_up.kw["timeout"] == 10

    sup = by["wpa_supplicant"][0]
    assert sup.argv[:6] == ["sudo", "-n", "wpa_supplicant", "-B", "-i", "wlan0"]
    assert sup.kw["timeout"] == 20, "the supplicant gets the longest bound — it does the scanning"

    status = by["wpa_cli"][0]
    assert status.sudo is True, "the control socket is root-owned; an unprivileged poll always fails"
    assert "wlan0" in status.argv, "the interface must reach wpa_cli, or it polls the wrong radio"
    assert status.kw["timeout"] == 8


def test_the_address_is_added_with_no_route_ever(wpa):
    """`ip addr add ... dev <iface>` and nothing else. Adding a route would send the box's traffic at a
    Wi-Fi card with no uplink — the harvest joins an isolated AP and must not become the default path."""
    assert ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0) is True
    addr = next(c for c in wpa.calls if c.argv and "addr" in c.argv and "add" in c.argv)
    assert addr.argv == ["sudo", "-n", "ip", "addr", "add", "192.168.4.2/24", "dev", "wlan0"]
    assert addr.kw["timeout"] == 10
    assert not any("route" in (c.argv or []) for c in wpa.calls), "no route, ever"


# ── the bounded wait ────────────────────────────────────────────────────────────────────────────────
def test_association_is_detected_through_the_wpa_cli_fallback(wpa):
    """`associated()` reads /sys and needs no privilege, but returns None when the interface is absent
    from sysfs — then the wpa_cli poll is the only signal, and it must require BOTH rc==0 and the
    COMPLETED state. Either alone is a false positive: wpa_cli exits 0 while merely SCANNING."""
    assert ch._wpa_up("wlan0", "s", "p", "10.0.0.2/24", 1.0) is True


def test_a_supplicant_that_never_associates_tears_down_and_reports_false(wpa, monkeypatch):
    """The teardown on the failure path is not tidiness: a root wpa_supplicant left holding the radio
    blocks the next attempt AND the box's own Wi-Fi. `_wpa_down` must be called with the same root, or
    it looks for the control socket in the wrong place and reaps nothing."""
    # a synthetic clock: `time.sleep` is already a no-op, but without advancing `monotonic` the
    # bounded wait burns the whole real 5 s floor. That is 5 s on every suite run, and mutation runs
    # pay it per mutant — three `wifi_up` mutants went from KILLED to TIMEOUT on the budget it cost.
    t = {"now": 0.0}
    monkeypatch.setattr(ch.time, "monotonic", lambda: t["now"])

    def _scanning(argv):
        t["now"] += 1.0
        return wpa.completed(0, "wpa_state=SCANNING\n", "")

    wpa.reply = _scanning
    downs = []
    monkeypatch.setattr(ch, "_wpa_down", lambda iface, root=None: downs.append((iface, root)) or True)

    assert ch._wpa_up("wlan0", "s", "p", "10.0.0.2/24", 0.0, root="/custom") is False
    assert downs == [("wlan0", "/custom")], "the teardown needs the root it was given"
    assert wpa.seen_roots and all(r == "/custom" for r in wpa.seen_roots), \
        "_wpa_dir must be resolved against the caller's root, not against None"


def test_the_wait_is_bounded_below_by_five_seconds(wpa, monkeypatch):
    """`max(5.0, timeout)`. A caller passing 0 must still get a real chance to associate — a scan takes
    seconds — but the floor must not be raised either, because this runs before every harvest."""
    t = {"now": 0.0}
    monkeypatch.setattr(ch.time, "monotonic", lambda: t["now"])
    polls = []

    def reply(argv):
        if argv and any("wpa_cli" in a for a in argv):       # only the association polls advance time
            polls.append(t["now"])
            t["now"] += 1.0
        return wpa.completed(0, "wpa_state=SCANNING\n", "")

    wpa.reply = reply
    monkeypatch.setattr(ch, "_wpa_down", lambda *a, **k: True)
    ch._wpa_up("wlan0", "s", "p", "10.0.0.2/24", 0.0)
    # deadline = 0 + max(5.0, 0.0) = 5.0, polled once per simulated second, loop EXCLUSIVE of the
    # deadline -> exactly 5 polls at t=0..4. Raising the floor to 6.0 gives 6; making the bound
    # inclusive (`<=`) also gives 6. Counting is what separates them from the correct behaviour.
    assert polls == [0.0, 1.0, 2.0, 3.0, 4.0], \
        "a 5.0s floor and an EXCLUSIVE deadline — either change adds a sixth poll"


# ── the teardown warning must be TRUE, not merely loud ───────────────────────────────────────────────
# FOLLOWUPS-II §2. `_wpa_down` warns "a supplicant may be left running" whenever `terminate` returns
# non-zero, and that warning exists for a real leak (2026-07-29: `wpa_supplicant -B -i wlp1s0` still
# running after a failed terminate, while the code returned True unconditionally). It must keep firing
# for that.
#
# But measured on the live box 2026-08-05 it also fires when there is nothing to leak: with no control
# socket, `terminate` returns rc=255 "Failed to connect to non-global ctrl_ifname" — the NORMAL state
# once our supplicant has exited — so it warned twice per cycle, forever, about a process that was not
# running. A warning that cries wolf twice an hour is one nobody reads, which is how the original leak
# went unnoticed. So the claim is now verified against /proc before it is made.

_SYSTEM = "/usr/sbin/wpa_supplicant\0-u\0-s\0-O\0DIR=/run/wpa_supplicant\0"
_OURS = "/usr/sbin/wpa_supplicant\0-B\0-i\0wlp1s0\0-c\0/run/x/wpa.conf\0"


def test_the_system_supplicant_is_not_mistaken_for_ours():
    """THE case that would make this warn forever. The vigil box always runs the D-Bus supplicant
    (`-u -s -O DIR=...`, no `-i`), so "is any wpa_supplicant alive?" answers yes on every cycle."""
    assert ch.supplicants_for("wlp1s0", {1870: _SYSTEM}) == []


def test_our_supplicant_for_this_interface_is_found():
    assert ch.supplicants_for("wlp1s0", {1870: _SYSTEM, 4242: _OURS}) == [4242]


def test_a_supplicant_on_a_DIFFERENT_interface_is_not_ours():
    assert ch.supplicants_for("wlan9", {4242: _OURS}) == []


def test_the_interface_must_match_the_ARGUMENT_not_a_substring():
    """An iface name is short enough to appear inside an unrelated path, and this decides whether the
    box shouts about a leak. `-c /run/wlan0/wpa.conf` must not make a wlan0 supplicant out of nothing."""
    decoy = "/usr/sbin/wpa_supplicant\0-B\0-i\0eth9\0-c\0/run/wlan0/wpa.conf\0"
    assert ch.supplicants_for("wlan0", {77: decoy}) == []


def test_a_process_that_merely_mentions_wpa_supplicant_is_not_one():
    """argv[0] is the discriminator; a log tail or an editor holding the name is not a supplicant."""
    tail = "/usr/bin/tail\0-f\0/var/log/wpa_supplicant.log\0-i\0wlp1s0\0"
    assert ch.supplicants_for("wlp1s0", {88: tail}) == []


def test_a_failed_terminate_with_a_LIVE_supplicant_still_warns(monkeypatch, caplog):
    """The 2026-07-29 leak. This must not go quiet — it is the reason the warning exists."""
    monkeypatch.setattr(ch, "_sh", lambda argv, t, sudo=False: (255, "boom"))
    monkeypatch.setattr(ch, "_live_supplicants", lambda iface: [4242])
    with caplog.at_level("INFO"):
        ch._wpa_down("wlp1s0", "/tmp/root")
    text = caplog.text
    assert "STILL RUNNING" in text and "4242" in text, text
    assert any(r.levelname == "WARNING" for r in caplog.records), "a real leak is a WARNING"


def test_a_failed_terminate_with_NO_supplicant_does_not_cry_wolf(monkeypatch, caplog):
    """The live-box case: no control socket, nothing bound to the interface, nothing to terminate."""
    monkeypatch.setattr(ch, "_sh", lambda argv, t, sudo=False:
                        (255, "Failed to connect to non-global ctrl_ifname: wlp1s0"))
    monkeypatch.setattr(ch, "_live_supplicants", lambda iface: [])
    with caplog.at_level("INFO"):
        ch._wpa_down("wlp1s0", "/tmp/root")
    assert "nothing to terminate" in caplog.text, caplog.text
    assert not [r for r in caplog.records if r.levelname == "WARNING"], \
        "no supplicant is bound to the interface — warning about a leak would be false"


def test_the_return_value_still_reports_the_failure(monkeypatch):
    """Quieter is not the same as swallowed. `_wpa_down` used to `return True` unconditionally, which is
    the defect the loud warning replaced; the rc must still reach the caller either way."""
    monkeypatch.setattr(ch, "_sh", lambda argv, t, sudo=False: (255, "x"))
    monkeypatch.setattr(ch, "_live_supplicants", lambda iface: [])
    assert ch._wpa_down("wlp1s0", "/tmp/root") is False


def test_a_process_that_exits_mid_scan_is_skipped_not_fatal(monkeypatch, tmp_path):
    """Reading /proc is inherently racy: a pid listed a microsecond ago may be gone by the open. On a
    box that spawns a helper per cycle this is ordinary, and it must not take down the check that
    decides whether to warn about a leak."""
    real_open = open

    def flaky_open(path, *a, **k):
        if str(path) == "/proc/999/cmdline":
            raise ProcessLookupError("vanished")          # an OSError subclass, as the kernel raises
        if str(path) == "/proc/4242/cmdline":
            return real_open(tmp_path / "ours", "rb")
        raise OSError("not interesting")
    (tmp_path / "ours").write_bytes(b"/usr/sbin/wpa_supplicant\0-B\0-i\0wlp1s0\0")
    monkeypatch.setattr(ch.os, "listdir", lambda p: ["999", "4242", "self", "cpuinfo"])
    monkeypatch.setattr("builtins.open", flaky_open)
    assert ch._live_supplicants("wlp1s0") == [4242], "the survivor is still found"


def test_an_unreadable_proc_claims_NOTHING_rather_than_guessing(monkeypatch):
    """If the check cannot run, it must not manufacture either answer. Returning [] means the caller
    logs "nothing to terminate" — the quiet arm — which is the safe direction: a false "no leak" costs
    a missed line in a journal, a false "LEAK, pid N" sends someone hunting a process that never
    existed and teaches them to distrust the warning."""
    def boom(_p):
        raise PermissionError("no /proc")
    monkeypatch.setattr(ch.os, "listdir", boom)
    assert ch._live_supplicants("wlp1s0") == []


# ── a crashed privilege layer is not a refused one ───────────────────────────────────────────────────
# FOLLOWUPS-II §1. On 2026-07-26 every helper on the live box failed with rc=101 and a Rust panic —
# sudo-rs CRASHING, not refusing. The daemon logged the number and nothing read it, so
# `cpap.state: "error"` sat unexplained for ten days while two correct-but-irrelevant code fixes were
# credited with covering it. The kinds differ in what you DO about them: a crash means the box's sudo
# is broken and retrying cannot help; a refusal is a one-line sudoers fix.

# The line as the journal actually recorded it. Note the PID in parentheses between the thread name and
# "panicked" — the first version of the pattern expected `'main' panicked` and matched no real output.
_PANIC_REAL = "thread 'main' (9270) panicked at src/system/audit.rs:80:14:"


def test_the_live_sudo_crash_is_classified_as_crashed():
    assert ch.helper_failure_kind(101, _PANIC_REAL) == "crashed"


def test_a_panic_without_a_pid_is_still_a_crash():
    """Older rustc omits the parenthesised pid. Both shapes are real."""
    assert ch.helper_failure_kind(101, "thread 'main' panicked at src/lib.rs:1:1") == "crashed"


def test_rc_101_WITHOUT_a_panic_is_not_called_a_crash():
    """`sudo` passes the child's exit code through, so 101 is just a number unless the output says
    otherwise. Claiming a crash from the code alone would be a fabricated diagnosis."""
    assert ch.helper_failure_kind(101, "some tool exited 101 normally") == "failed"


def test_a_sudoers_refusal_is_distinguishable_from_a_crash():
    for out in ("sudo: a password is required", "user vigil is not allowed to execute /usr/sbin/ip"):
        assert ch.helper_failure_kind(1, out) == "refused", out


def test_a_missing_binary_and_a_timeout_have_their_own_kinds():
    assert ch.helper_failure_kind(127, "wpa_cli: command not found") == "missing"
    assert ch.helper_failure_kind(124, "timed out after 10s") == "timeout"


def test_an_ordinary_tool_failure_is_not_over_diagnosed():
    """The wpa teardown's own rc=255 must stay `failed` — inventing a cause for it is how a real crash
    stops standing out."""
    assert ch.helper_failure_kind(255, "Failed to connect to non-global ctrl_ifname: wlp1s0") == "failed"


def test_a_crash_is_logged_at_ERROR_and_names_the_kind(monkeypatch, caplog):
    """The whole point is that it reaches a human differently from the warnings around it."""
    import logging
    import subprocess as _sp

    class _P:
        returncode, stdout, stderr = 101, "", _PANIC_REAL
    monkeypatch.setattr(_sp, "run", lambda *a, **k: _P())
    with caplog.at_level(logging.WARNING):
        rc, _out = ch._sh(["ip", "link"], 5, sudo=True)
    assert rc == 101
    assert any(r.levelname == "ERROR" for r in caplog.records), \
        "a crashed privilege layer must not read as one more warning"
    assert "[crashed]" in caplog.text, caplog.text


def test_an_ordinary_failure_stays_a_WARNING(monkeypatch, caplog):
    import logging
    import subprocess as _sp

    class _P:
        returncode, stdout, stderr = 255, "", "some failure"
    monkeypatch.setattr(_sp, "run", lambda *a, **k: _P())
    with caplog.at_level(logging.WARNING):
        ch._sh(["ip", "link"], 5, sudo=True)
    assert not [r for r in caplog.records if r.levelname == "ERROR"]
    assert "[failed]" in caplog.text, caplog.text
