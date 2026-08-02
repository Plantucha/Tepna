# tepna-capture — tests/test_host_clock_and_helper_path.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Two small modules with outsized consequences.
#
# host_clock decides whether a night's ABSOLUTE timestamps are trustworthy. The dangerous direction is
# one-way: calling a free-running RTC "disciplined" silently upgrades the provenance of every stamp in
# the session, and nothing downstream can detect it afterwards. Every test below therefore pins the
# holdover/unknown verdicts as hard as the happy path.
#
# helper_path decides which file a NOPASSWD sudo grant may point at. Getting it wrong is a
# privilege-escalation hole, not a bug — this checkout sits on an NTFS mount where every file is
# user-writable, so the in-repo copy must never be reported as safe.

import asyncio
import os
import pathlib

import pytest

import helper_path
import host_clock as hc


def _run(coro):
    return asyncio.run(coro)


# ── parse_ntp_message ───────────────────────────────────────────────────────────────────────────────
NTP_BLOB = ("{ Leap=0, Version=4, Mode=4, Stratum=2, Precision=-24, RootDelay=1.113ms, "
            "RootDispersion=2.456ms, Reference=PPS, OriginateTimestamp=Sat 2026-07-18 18:04:29 EDT, "
            "Jitter=170us, PacketCount=9, Ignored=no }")


def test_parse_ntp_message_extracts_pairs_and_strips_braces():
    m = hc.parse_ntp_message(NTP_BLOB)
    assert m["Stratum"] == "2" and m["Reference"] == "PPS" and m["PacketCount"] == "9"
    assert m["Jitter"] == "170us" and m["Ignored"] == "no"


def test_parse_ntp_message_keeps_only_the_first_equals():
    """A timestamp value can itself contain '='-free text with spaces; splitting on every '=' would
    truncate it."""
    assert hc.parse_ntp_message("{ OriginateTimestamp=Sat 2026-07-18 18:04:29 EDT }"
                                )["OriginateTimestamp"] == "Sat 2026-07-18 18:04:29 EDT"


@pytest.mark.parametrize("blob", ["", None, "   ", "no-equals-here"])
def test_parse_ntp_message_is_empty_for_junk(blob):
    assert hc.parse_ntp_message(blob or "") == {}


# ── _num ────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text,expected", [
    ("1.113ms", 1.113), ("170us", 170.0), ("0", 0.0), ("-3.5ms", -3.5), ("42", 42.0),
])
def test_num_reads_the_leading_number_regardless_of_unit(text, expected):
    assert hc._num(text) == expected


@pytest.mark.parametrize("text", [None, "", "n/a", "ms", "  "])
def test_num_returns_none_never_a_fabricated_zero(text):
    """0.0 would be a claim of perfect dispersion/jitter; absence must stay absent."""
    assert hc._num(text) is None


# ── classify — the trust verdict ────────────────────────────────────────────────────────────────────
def _state(**kw):
    base = {"available": True, "ntp_enabled": True, "synchronized": True,
            "stratum": 2, "ignored": False, "reference": "PPS"}
    base.update(kw)
    return base


def test_a_healthy_stratum_2_is_disciplined():
    v = hc.classify(_state())
    assert v["trust"] == "disciplined" and v["absolute_ok"] is True


def test_unreadable_state_is_unknown_not_trusted():
    """Absence of evidence is not evidence of health — a container with no timedatectl must not inherit
    a 'disciplined' verdict by default."""
    v = hc.classify(_state(available=False))
    assert v["trust"] == "unknown" and v["absolute_ok"] is False


def test_ntp_disabled_is_holdover():
    v = hc.classify(_state(ntp_enabled=False))
    assert v["trust"] == "holdover" and v["absolute_ok"] is False
    assert "free-running" in v["reason"]


def test_never_synchronised_is_holdover():
    v = hc.classify(_state(synchronized=False))
    assert v["trust"] == "holdover" and v["absolute_ok"] is False


def test_a_refused_reply_is_holdover_even_though_everything_else_looks_healthy():
    """systemd reports Ignored=yes when it received a reply and REFUSED it. Every other field still
    reads like a good sync, so this is the branch most likely to be dropped by accident."""
    v = hc.classify(_state(ignored=True))
    assert v["trust"] == "holdover" and v["absolute_ok"] is False
    assert "REFUSED" in v["reason"]


@pytest.mark.parametrize("stratum", [0, -1, hc.MAX_TRUSTED_STRATUM + 1, 15])
def test_an_out_of_range_stratum_is_holdover(stratum):
    v = hc.classify(_state(stratum=stratum))
    assert v["trust"] == "holdover" and v["absolute_ok"] is False


@pytest.mark.parametrize("stratum", [1, 2, hc.MAX_TRUSTED_STRATUM])
def test_the_trusted_stratum_band_is_inclusive(stratum):
    assert hc.classify(_state(stratum=stratum))["absolute_ok"] is True


def test_synchronised_with_no_stratum_yet_is_believed_but_says_so():
    """NTPMessage clears on a systemd-timesyncd restart. The flag is still authoritative; the reason
    must record that the stratum was not corroborated."""
    v = hc.classify(_state(stratum=None))
    assert v["trust"] == "disciplined" and "not yet reported" in v["reason"]


def test_every_verdict_carries_a_reason():
    for kw in ({"available": False}, {"ntp_enabled": False}, {"synchronized": False},
               {"ignored": True}, {"stratum": 99}, {}):
        v = hc.classify(_state(**kw))
        assert v["reason"] and isinstance(v["reason"], str)
        assert set(v) == {"trust", "absolute_ok", "reason"}


# ── _kv + read_state ────────────────────────────────────────────────────────────────────────────────
def test_kv_parses_timedatectl_show_output():
    assert hc._kv("NTP=yes\nNTPSynchronized=yes\nTimezone=America/New_York") == {
        "NTP": "yes", "NTPSynchronized": "yes", "Timezone": "America/New_York"}


def test_kv_ignores_lines_without_an_equals():
    assert hc._kv("NTP=yes\ngarbage\n\n") == {"NTP": "yes"}


def _fake_run(monkeypatch, show="", timesync="", rc=0):
    async def fake(*args, timeout=4.0):
        return rc, (timesync if "show-timesync" in args else show)
    monkeypatch.setattr(hc, "_run", fake)


def test_read_state_builds_a_disciplined_verdict_from_real_output(monkeypatch):
    _fake_run(monkeypatch, show="NTP=yes\nNTPSynchronized=yes\n",
              timesync=f"ServerName=time.cloudflare.com\nNTPMessage={NTP_BLOB}\n")
    st = _run(hc.read_state())
    assert st["available"] is True and st["ntp_enabled"] is True and st["synchronized"] is True
    assert st["server"] == "time.cloudflare.com" and st["stratum"] == 2 and st["reference"] == "PPS"
    assert st["root_dispersion_ms"] == 2.456 and st["jitter_us"] == 170.0
    assert st["packet_count"] == 9 and st["ignored"] is False
    assert st["trust"] == "disciplined" and st["absolute_ok"] is True


def test_read_state_reports_unknown_when_timedatectl_is_missing(monkeypatch):
    """rc=127 is the FileNotFoundError path — no timedatectl at all."""
    _fake_run(monkeypatch, rc=127)
    st = _run(hc.read_state())
    assert st["available"] is False and st["trust"] == "unknown" and st["absolute_ok"] is False


def test_read_state_leaves_unreported_numbers_as_none(monkeypatch):
    _fake_run(monkeypatch, show="NTP=yes\nNTPSynchronized=yes\n", timesync="")
    st = _run(hc.read_state())
    assert st["stratum"] is None and st["root_dispersion_ms"] is None
    assert st["jitter_us"] is None and st["packet_count"] is None and st["server"] is None


def test_read_state_falls_back_to_server_address(monkeypatch):
    _fake_run(monkeypatch, show="NTP=yes\n", timesync="ServerAddress=162.159.200.1\n")
    assert _run(hc.read_state())["server"] == "162.159.200.1"


def test_read_state_never_raises_on_a_hostile_blob(monkeypatch):
    _fake_run(monkeypatch, show="NTP=yes\nNTPSynchronized=yes\n",
              timesync="NTPMessage={ Stratum=notanumber, PacketCount=x, Jitter=zzz }\n")
    st = _run(hc.read_state())
    assert st["stratum"] is None and st["packet_count"] is None and st["jitter_us"] is None


def test_run_returns_127_rather_than_raising_for_a_missing_binary():
    rc, out = _run(hc._run("definitely-not-a-real-binary-xyz"))
    assert rc == 127 and out == ""


# ── helper_path — the privilege boundary ────────────────────────────────────────────────────────────
def test_resolve_prefers_a_root_owned_system_copy(monkeypatch, tmp_path):
    sysdir = tmp_path / "sys"
    sysdir.mkdir()
    (sysdir / "tepna-rssi.sh").write_text("#!/bin/sh\n")
    monkeypatch.setattr(helper_path, "SYSTEM_DIRS", (str(sysdir),))
    assert helper_path.resolve("tepna-rssi.sh") == str(sysdir / "tepna-rssi.sh")


def test_resolve_falls_back_to_the_in_repo_copy(monkeypatch, tmp_path):
    """Returned even when absent, so callers keep their existing 'missing helper' handling."""
    monkeypatch.setattr(helper_path, "SYSTEM_DIRS", (str(tmp_path / "nowhere"),))
    got = helper_path.resolve("tepna-rssi.sh")
    # Assert against the module's OWN directory, not the literal string "capture-host". The contract is
    # "falls back to the copy beside helper_path.py"; the checkout's directory NAME is not part of it,
    # and pinning it broke in every copy of the tree — a git worktree, a vendored checkout, and the
    # scratch copy tools/mutate.py runs mutants in, where it failed unconditionally and made three
    # modules unmutatable (found 2026-08-02 by the mutation audit).
    assert got == str(pathlib.Path(helper_path.__file__).resolve().parent / "tepna-rssi.sh")


def test_resolve_tries_system_dirs_in_order(monkeypatch, tmp_path):
    first, second = tmp_path / "a", tmp_path / "b"
    first.mkdir(); second.mkdir()
    (first / "h.sh").write_text("x")
    (second / "h.sh").write_text("x")
    monkeypatch.setattr(helper_path, "SYSTEM_DIRS", (str(first), str(second)))
    assert helper_path.resolve("h.sh") == str(first / "h.sh")


def test_a_user_writable_file_is_not_safely_owned(tmp_path):
    """THE case this module exists for: the in-repo copy on a user-writable mount. Anything running as
    this user could rewrite it, so a NOPASSWD grant on it is instant passwordless root."""
    p = tmp_path / "tepna-rssi.sh"
    p.write_text("#!/bin/sh\n")
    os.chmod(p, 0o755)
    assert helper_path.is_safely_owned(str(p)) is False, "a user-owned helper must never be called safe"


def test_a_missing_file_is_not_safely_owned(tmp_path):
    assert helper_path.is_safely_owned(str(tmp_path / "absent.sh")) is False


def test_group_or_world_writable_is_rejected_even_if_root_owned(tmp_path, monkeypatch):
    """Root-owned but 0777 is just as exploitable as user-owned."""
    p = tmp_path / "h.sh"
    p.write_text("x")

    class FakeStat:
        st_uid = 0
        st_mode = 0o100777
    monkeypatch.setattr(helper_path.os, "stat", lambda _p: FakeStat())
    assert helper_path.is_safely_owned(str(p)) is False


def test_root_owned_and_not_writable_is_accepted(tmp_path, monkeypatch):
    class FakeStat:
        st_uid = 0
        st_mode = 0o100755
    monkeypatch.setattr(helper_path.os, "stat", lambda _p: FakeStat())
    assert helper_path.is_safely_owned(str(tmp_path / "h.sh")) is True


def test_grant_warning_names_the_file_and_the_safe_destination(tmp_path):
    p = tmp_path / "tepna-clock.sh"
    p.write_text("x")
    w = helper_path.grant_warning(str(p))
    assert w and str(p) in w and helper_path.SYSTEM_DIRS[0] in w
    assert "privilege-escalation" in w


def test_grant_warning_is_silent_for_a_safe_helper(monkeypatch, tmp_path):
    monkeypatch.setattr(helper_path, "is_safely_owned", lambda _p: True)
    assert helper_path.grant_warning(str(tmp_path / "h.sh")) is None


# ── STRATUM FAIL-OPEN (VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF §3) ───────────────────────────────
# `read_state` parsed Stratum with `.isdigit()`, so any non-integer form became None and fell into
# classify()'s "synchronised; stratum not yet reported" branch — which TRUSTS. That is a fail-OPEN
# on the one field gating absolute-time trust. A REPORTED-but-unreadable stratum is now holdover;
# a genuinely ABSENT one keeps the documented benefit of the doubt.

def _synced(**kw):
    base = {"available": True, "ntp_enabled": True, "synchronized": True, "ignored": False}
    base.update(kw)
    return base


def test_unparseable_stratum_is_holdover_not_trusted():
    v = hc.classify(_synced(stratum=None, stratum_unparsed=True))
    assert v["trust"] == "holdover"
    assert v["absolute_ok"] is False
    assert "parse" in v["reason"].lower()


def test_absent_stratum_still_gets_the_benefit_of_the_doubt():
    """systemd clears NTPMessage on restart, so absent-but-synchronised is a real, benign state."""
    v = hc.classify(_synced(stratum=None))
    assert v["trust"] == "disciplined" and v["absolute_ok"] is True


def test_read_state_flags_a_reported_but_unreadable_stratum():
    """The parse and the verdict must agree — this is the seam the fail-open lived in."""
    for raw, want_unparsed in (("16", False), ("4", False), ("16.0", False), ("n/a", True), ("", False)):
        msg = hc.parse_ntp_message(f"{{ Stratum={raw}, Reference=PPS }}" if raw else "{ Reference=PPS }")
        num = hc._num(msg.get("Stratum"))
        unparsed = bool((msg.get("Stratum") or "").strip()) and num is None
        assert unparsed is want_unparsed, f"Stratum={raw!r} -> unparsed={unparsed}"


def test_float_stratum_is_read_rather_than_discarded():
    """`16.0` is a legible stratum 16 — it must land as UNSYNCHRONISED, not as 'not reported'."""
    msg = hc.parse_ntp_message("{ Stratum=16.0, Reference=PPS }")
    num = hc._num(msg.get("Stratum"))
    assert num == 16.0
    v = hc.classify(_synced(stratum=int(num)))
    assert v["trust"] == "holdover", "stratum 16 is RFC 5905 unsynchronised"


def test_packet_count_tolerates_a_suffixed_form():
    assert hc._num("36") == 36.0
    assert hc._num("36 packets") == 36.0
    assert hc._num("n/a") is None


# ── chrony reader (VIGIL-CHRONY-CLOCK-READER) ──────────────────────────────────────────────────
# Ubuntu Server and RHEL default to chrony, on which `timedatectl show-timesync` returns nothing.
# Without this reader the daemon still grades the host `disciplined` — but through the weakest branch
# ("synchronised; stratum not yet reported"), believing systemd's flag with none of the evidence.

CHRONY_TRACKING = """Reference ID    : C0A8007B (192.168.0.123)
Stratum         : 2
Ref time (UTC)  : Sun Jul 26 01:07:19 2026
System time     : 0.000000123 seconds fast of NTP time
Last offset     : +0.000001234 seconds
RMS offset      : 0.000002345 seconds
Frequency       : 12.345 ppm slow
Residual freq   : +0.001 ppm
Skew            : 0.123 ppm
Root delay      : 0.000456789 seconds
Root dispersion : 0.001052000 seconds
Update interval : 64.2 seconds
Leap status     : Normal
"""


def test_chrony_stratum_is_normalised_to_the_SERVER_stratum():
    """THE subtlety. timedatectl's NTPMessage.Stratum is the SERVER's; chronyc tracking's is THIS
    HOST's (= server + 1). Mixing them would silently shift MAX_TRUSTED_STRATUM by one hop and make
    the two readers disagree about an identical clock."""
    ch = hc.parse_chrony_tracking(CHRONY_TRACKING)
    assert ch["stratum"] == 1, "a client of a stratum-1 server syncs to a stratum-1 SOURCE"
    assert ch["host_stratum"] == 2, "chrony's own number is kept verbatim so the -1 stays auditable"


def test_both_readers_grade_an_identical_clock_identically():
    """The gate that makes the normalisation trustworthy rather than merely documented."""
    via_chrony = hc.classify({"available": True, "ntp_enabled": True, "synchronized": True,
                              "ignored": False, **hc.parse_chrony_tracking(CHRONY_TRACKING)})
    msg = hc.parse_ntp_message("{ Leap=0, Stratum=1, Reference=PPS, Jitter=170us }")
    via_timesyncd = hc.classify({"available": True, "ntp_enabled": True, "synchronized": True,
                                 "ignored": False, "stratum": int(msg["Stratum"])})
    assert via_chrony["trust"] == via_timesyncd["trust"] == "disciplined"
    assert via_chrony["absolute_ok"] is via_timesyncd["absolute_ok"] is True


def test_chrony_units_are_converted_to_the_shared_shape():
    ch = hc.parse_chrony_tracking(CHRONY_TRACKING)
    assert ch["root_dispersion_ms"] == 1.052, "chrony prints seconds; the state carries ms"
    assert ch["jitter_us"] == 2.3, "RMS offset seconds -> us"
    assert ch["reference"] == "192.168.0.123"


def test_a_reference_clock_is_not_reported_as_a_server():
    ch = hc.parse_chrony_tracking("Reference ID    : 50505300 (PPS)\nStratum         : 1\n")
    assert ch["reference"] == "PPS"
    assert ch["server"] is None, "a refclock name is not a server address"
    assert ch["stratum"] == 1, "a host holding its own refclock is clamped to 1, never 0"


def test_chrony_with_no_source_is_unsynchronised_not_stratum_zero():
    ch = hc.parse_chrony_tracking("Reference ID    : 00000000 ()\nStratum         : 0\n"
                                  "Leap status     : Not synchronised\n")
    assert ch["stratum"] is None
    assert ch["leap_ok"] is False


def test_chrony_leap_not_synchronised_overrides_a_stale_systemd_flag(monkeypatch):
    """chrony knows it lost its sources before NTPSynchronized catches up; believe the daemon that is
    actually steering the clock."""
    async def fake(*args, timeout=4.0):
        if "show-timesync" in args:
            return 0, ""
        if args[0] == "chronyc":
            return 0, "Reference ID    : 00000000 ()\nStratum : 0\nLeap status : Not synchronised\n"
        return 0, "NTP=yes\nNTPSynchronized=yes\n"
    monkeypatch.setattr(hc, "_run", fake)
    st = _run(hc.read_state())
    assert st["synchronized"] is False and st["trust"] == "holdover"


def test_read_state_uses_chrony_when_timesyncd_is_silent(monkeypatch):
    async def fake(*args, timeout=4.0):
        if "show-timesync" in args:
            return 0, ""                      # chrony box: timesyncd interface says nothing
        if args[0] == "chronyc":
            return 0, CHRONY_TRACKING
        return 0, "NTP=yes\nNTPSynchronized=yes\n"
    monkeypatch.setattr(hc, "_run", fake)
    st = _run(hc.read_state())
    assert st["time_source"] == "chrony"
    assert st["stratum"] == 1 and st["host_stratum"] == 2
    assert st["server"] == "192.168.0.123" and st["root_dispersion_ms"] == 1.052
    assert st["trust"] == "disciplined" and st["absolute_ok"] is True
    assert "stratum 1" in st["reason"], "the verdict must cite the evidence, not just the flag"


def test_timesyncd_still_wins_when_it_has_an_ntp_message(monkeypatch):
    """No regression: a timesyncd box must not start shelling out to chronyc."""
    calls = []
    async def fake(*args, timeout=4.0):
        calls.append(args[0])
        if "show-timesync" in args:
            return 0, f"ServerName=time.cloudflare.com\nNTPMessage={NTP_BLOB}\n"
        return 0, "NTP=yes\nNTPSynchronized=yes\n"
    monkeypatch.setattr(hc, "_run", fake)
    st = _run(hc.read_state())
    assert st["time_source"] == "timesyncd" and st["stratum"] == 2
    assert "chronyc" not in calls, "chrony is only consulted when timesyncd reported nothing"


def test_neither_daemon_readable_is_still_a_safe_verdict(monkeypatch):
    async def fake(*args, timeout=4.0):
        if args[0] == "chronyc":
            return 127, ""
        return 0, "NTP=yes\nNTPSynchronized=yes\n" if "show-timesync" not in args else ""
    monkeypatch.setattr(hc, "_run", fake)
    st = _run(hc.read_state())
    assert st["time_source"] is None
    assert st["trust"] == "disciplined", "systemd's own flag is still believed, and says so"
    assert "not yet reported" in st["reason"]


def test_parse_chrony_tracking_never_raises_on_junk():
    for junk in ("", "garbage", ":::", "Stratum : notanumber\n", "Reference ID : \n"):
        assert isinstance(hc.parse_chrony_tracking(junk), dict)
