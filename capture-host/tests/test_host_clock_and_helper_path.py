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

from tests._srcscan import module_source
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
    assert ch["skew_ppm"] == 0.123, "chrony Skew is already ppm; carried through as the precision bound"


def test_chrony_skew_is_absent_not_zero_when_the_line_is_missing():
    """Absence of the precision bound must read as unknown, never a fabricated 0 (this module's rule)."""
    ch = hc.parse_chrony_tracking("Reference ID    : C0A8007B (192.168.0.123)\nStratum : 2\n")
    assert "skew_ppm" not in ch


def test_chrony_ref_time_becomes_the_last_sync_instant():
    """`Ref time (UTC)` is when chrony last updated the clock from a source — carried as an ISO UTC
    stamp so the monitor can say 'synced N min ago' without locale-parsing chrony's prose."""
    ch = hc.parse_chrony_tracking(CHRONY_TRACKING)
    assert ch["last_sync_utc"] == "2026-07-26T01:07:19Z"


def test_chrony_ref_time_is_absent_when_the_line_is_missing():
    ch = hc.parse_chrony_tracking("Reference ID    : C0A8007B (192.168.0.123)\nStratum : 2\n")
    assert "last_sync_utc" not in ch


def test_chrony_ref_time_rejects_an_impossible_date_rather_than_rolling_it():
    """datetime() does the calendar validation: Feb 30 must become absence, never a rolled-onto-March
    instant — the same honesty rule as clock.js `_ckMk` (a fabricated stamp is worse than none)."""
    ch = hc.parse_chrony_tracking("Ref time (UTC)  : Mon Feb 30 01:07:19 2026\n")
    assert "last_sync_utc" not in ch


def test_chrony_ref_time_rejects_an_unknown_month_token():
    """A three-letter token that is not an English month abbreviation (map -> month 0) is unparseable,
    and unparseable is absent — not a guess."""
    ch = hc.parse_chrony_tracking("Ref time (UTC)  : Mon Foo 26 01:07:19 2026\n")
    assert "last_sync_utc" not in ch


def test_chrony_tracking_skips_a_colonless_line_rather_than_stopping():
    """A line with no ':' must be SKIPPED (`continue`), never end the parse (`break`). A `break` would
    drop every field AFTER the offending line — and `Ref time` is last in real chronyc output, so the
    last-sync stamp this reader now extracts would be the first casualty. The colonless line sits in the
    MIDDLE here so the assertion can only pass if parsing resumed past it."""
    blob = "Stratum         : 2\n(a blank or wrapped line with no colon)\nRMS offset      : 0.000002345 seconds\n"
    ch = hc.parse_chrony_tracking(blob)
    assert ch["stratum"] == 1, "the field before the colonless line parses"
    assert ch["jitter_us"] == 2.3, "the field AFTER it must still parse — proves continue, not break"


def test_read_state_carries_chrony_skew_and_leaves_timesyncd_skew_none(monkeypatch):
    """The clock-precision fact rides read_state on the chrony path; the timesyncd path has no analogue,
    so it is None there rather than borrowed from another field (O2RING-ADAPTIVE-TIMEBASE Stage 1)."""
    async def via_chrony(*args, timeout=4.0):
        if "show-timesync" in args:
            return 0, ""
        if args[0] == "chronyc":
            return 0, CHRONY_TRACKING
        return 0, "NTP=yes\nNTPSynchronized=yes\n"
    monkeypatch.setattr(hc, "_run", via_chrony)
    st = _run(hc.read_state())
    assert st["chrony_skew_ppm"] == 0.123
    assert st["last_sync_utc"] == "2026-07-26T01:07:19Z", "the last-sync instant rides the chrony path"

    async def via_timesyncd(*args, timeout=4.0):
        if "show-timesync" in args:
            return 0, "NTPMessage={ Leap=0, Stratum=2, Jitter=170us }\n"
        return 0, "NTP=yes\nNTPSynchronized=yes\n"
    monkeypatch.setattr(hc, "_run", via_timesyncd)
    st = _run(hc.read_state())
    assert st["chrony_skew_ppm"] is None
    assert st["last_sync_utc"] is None, "timesyncd reports no sync instant — None, never borrowed"


# ── timebase_decision (O2RING-ADAPTIVE-TIMEBASE Stage 3) ──────────────────────────────────────────────
def _disc(stratum, skew=None):
    """A disciplined state at a given source stratum (+ optional chrony skew ppm)."""
    s = {"available": True, "ntp_enabled": True, "synchronized": True, "ignored": False,
         "stratum": stratum, "chrony_skew_ppm": skew}
    return s


def test_timebase_defaults_to_the_crystal_when_the_host_is_not_disciplined():
    """The safe floor: a holdover/free-running/unreadable host never governs the rate."""
    for state in ({"available": False},
                  {"available": True, "ntp_enabled": False},
                  {"available": True, "ntp_enabled": True, "synchronized": False}):
        d = hc.timebase_decision(state)
        assert d["timebase"] == "device-crystal", d
        assert "device crystal" in d["reason"]


def test_timebase_is_crystal_for_a_stratum_2_client_even_though_absolute_ok():
    """The bar is STRICTER than absolute-time trust: a stratum-2 NTP client is absolute_ok, but its rate
    may be worse than the ±40 ppm crystal, so it stays on the crystal."""
    st = _disc(2)
    assert hc.classify(st)["absolute_ok"] is True, "control: stratum 2 IS absolute_ok"
    assert hc.timebase_decision(st)["timebase"] == "device-crystal"


def test_timebase_is_crystal_when_the_stratum_is_not_yet_reported():
    """absolute_ok but stratum None ⇒ cannot confirm a reference source ⇒ crystal (conservative)."""
    assert hc.timebase_decision(_disc(None))["timebase"] == "device-crystal"


def test_a_stratum_1_reference_earns_host_discipline():
    """The owner's case: 'if somebody has stratum-1 then that will be chosen path.'"""
    d = hc.timebase_decision(_disc(1))
    assert d["timebase"] == "host-disciplined" and "host rate trusted" in d["reason"]


def test_a_stratum_1_with_a_tight_skew_still_earns_host_discipline():
    assert hc.timebase_decision(_disc(1, skew=0.5))["timebase"] == "host-disciplined"


def test_a_stratum_1_with_a_loose_skew_falls_back_to_the_crystal():
    """Even a stratum-1 source falls back if its frequency skew is wider than the bar — a misconfigured
    or unsettled reference is not worth more than the crystal."""
    d = hc.timebase_decision(_disc(1, skew=5.0))
    assert d["timebase"] == "device-crystal" and "skew 5.0 ppm exceeds" in d["reason"]


def test_the_skew_bar_is_inclusive_at_exactly_the_threshold():
    assert hc.timebase_decision(_disc(1, skew=hc.TIMEBASE_MAX_SKEW_PPM))["timebase"] == "host-disciplined"


def test_read_state_stamps_the_timebase_decision(monkeypatch):
    """The decision rides read_state, so host_clock_poller stamps it in the CLOCK sidecar per capture.
    CHRONY_TRACKING is a stratum-1 SOURCE (client of a stratum-2 server) with a 0.123 ppm skew ⇒ host."""
    async def via_chrony(*args, timeout=4.0):
        if "show-timesync" in args:
            return 0, ""
        if args[0] == "chronyc":
            return 0, CHRONY_TRACKING
        return 0, "NTP=yes\nNTPSynchronized=yes\n"
    monkeypatch.setattr(hc, "_run", via_chrony)
    assert _run(hc.read_state())["timebase"] == "host-disciplined"


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


# ── the grant check is WIRED, not merely correct ────────────────────────────────────────────────────

def test_SYSTEM_DIRS_second_entry_is_documented_as_a_FALLBACK_not_a_deploy_target():
    """⚠️ THE COMMENT WAS LOAD-BEARING AND WRONG. It called BOTH entries "root-owned deploy targets",
    but `/opt/tepna/capture-host` is the checkout — vigil-owned BY DESIGN, because `tepna-update.sh`
    must be able to write it to complete a deploy. A constant that mis-describes its own second element
    is how a fallback path looks safe at the call site that prefixes `sudo -n` to it."""
    src = module_source("helper_path.py")
    head = src[:src.index("SUDO_HELPERS")]
    assert "/opt/tepna/capture-host" in head
    assert "vigil-owned" in head or "DEVELOPMENT FALLBACK" in head, (
        "the second entry must be documented as unsafe to grant, not as a deploy target")


def test_every_sudo_helper_is_named_in_ONE_place():
    """`SUDO_HELPERS` exists so the boot self-test can check them all. A per-call-site check is exactly
    what left `grant_warning` with no caller: capture.py resolves three helpers, clockcfg and link_rssi
    resolve others, and nobody owned the whole set."""
    import helper_path as hp
    assert set(hp.SUDO_HELPERS) >= {"tepna-restart.sh", "tepna-btreset.sh", "tepna-clock.sh"}
    for name in hp.SUDO_HELPERS:
        assert name.endswith(".sh") and "/" not in name, name


def test_the_boot_self_test_ASKS_about_helper_grants():
    """It was called by nothing outside its own tests. The condition is reachable: `resolve()` falls back
    to the in-repo copy, that copy is `-rwxrwxr-x vigil` on the box, and `daemon_control.build_cmd`
    prefixes `sudo -n` to whatever it returns."""
    src = module_source("capture.py")
    assert "helper_path.grant_warning(" in src, "the boot self-test must invoke it"
    assert "helper_warnings" in src, "…and feed the result to the pure decision function"


def test_helper_warnings_reach_the_verdict_and_an_absent_list_says_nothing():
    """No `_UNCHECKED` sentinel on this one, deliberately. For a single value like `usb_path`, "not
    looked" and "looked and it was empty" are different verdicts. For a LIST OF WARNINGS they are not —
    both produce no warning — so a sentinel would be decoration that reads like rigour. A surviving
    mutant proved it: swapping `_UNCHECKED` for `()` changed nothing observable."""
    import capture
    assert capture.defense_warnings(None, None) == []
    assert len(capture.defense_warnings(None, None, helper_warnings=["x", "y"])) == 2


def test_ONE_unreadable_helper_does_not_silence_the_others(monkeypatch):
    """⚠️ THE FAIL-OPEN THIS ALMOST SHIPPED WITH. A single try around the whole loop means one bad stat
    aborts the sweep and every helper after it goes unchecked — and the LOOP ORDER then decides which
    defences get reported. A self-test that goes quiet because one input failed is precisely the shape
    it exists to refuse."""
    import capture
    import helper_path as hp
    calls = []

    def _boom(path):
        calls.append(path)
        if len(calls) == 1:
            raise OSError("unreadable")
        return "unsafe: " + path

    monkeypatch.setattr(hp, "grant_warning", _boom)
    monkeypatch.setattr(hp, "SUDO_HELPERS", ("a.sh", "b.sh", "c.sh"))
    monkeypatch.setattr(capture.os.path, "isdir", lambda p: True)   # pretend this is a deployed host
    warns = capture._gather_helper_warnings()
    assert len(calls) == 3, f"every helper must still be asked: {calls}"
    assert len(warns) == 2, f"the two readable ones must still be reported: {warns}"


def test_the_helper_check_is_SILENT_on_a_development_checkout(monkeypatch):
    """⚠️ A SELF-TEST THAT ALWAYS FIRES TEACHES PEOPLE TO STOP READING IT — the same way the retired
    `smeared` canary arm fired on every stream on its first real night. In any dev checkout the helpers
    are repo-local and never root-owned, so an ungated check warns five times at every startup about
    paths that hold no sudoers grant and never will."""
    import capture
    monkeypatch.setattr(capture.os.path, "isdir", lambda p: False)   # no /usr/local/lib/tepna here
    assert capture._gather_helper_warnings() == []


def test_but_it_SPEAKS_on_a_deployed_host_whose_helper_fell_back_to_the_checkout(monkeypatch, tmp_path):
    """The signal that actually bit on 2026-08-14: a deployed box where a helper is MISSING from the
    system dir, so `resolve()` silently returns the vigil-writable checkout copy — and `daemon_control`
    prefixes `sudo -n` to it."""
    import capture
    import helper_path as hp
    unsafe = tmp_path / "tepna-restart.sh"
    unsafe.write_text("#!/bin/sh\n")
    monkeypatch.setattr(capture.os.path, "isdir", lambda p: True)
    monkeypatch.setattr(hp, "SUDO_HELPERS", ("tepna-restart.sh",))
    monkeypatch.setattr(hp, "resolve", lambda n: str(unsafe))
    warns = capture._gather_helper_warnings()
    assert len(warns) == 1 and "not root-owned" in warns[0], warns


def test_a_SAFE_helper_is_skipped_while_the_unsafe_one_is_still_reported(monkeypatch):
    """⚠️ COVERED ONLY BY ACCIDENT ON A MACHINE THAT HAS `/usr/local/lib/tepna`, which CI does not.

    A box mid-deploy is exactly this mixture: some helpers already installed root-owned, one still
    resolving to the vigil-writable checkout. The report must name the unsafe one and stay silent about
    the safe ones — a sweep that reported every helper would be as useless as one that reported none.

    Local runs passed at 100 % because this machine HAS the system dir populated, so the real scan
    walked the `w is None` path incidentally. CI has no such directory, `_gather_helper_warnings`
    returns early, and the branch went uncovered — 99.99 %, one partial branch, every test green. An
    environment-dependent coverage hole is invisible precisely where it is convenient."""
    import capture
    import helper_path as hp
    monkeypatch.setattr(capture.os.path, "isdir", lambda p: True)
    # ⚠️ NAMES CHOSEN SO NEITHER IS A SUBSTRING OF THE OTHER. The first draft used "safe.sh"/"unsafe.sh"
    # with `"safe" in path`, which matches BOTH — "unsafe" contains "safe" — so every helper read as
    # safe and the assertion saw an empty list. A predicate that matches more than intended, inside a
    # test about a predicate that matches more than intended.
    monkeypatch.setattr(hp, "SUDO_HELPERS", ("ok-one.sh", "rewritable.sh", "ok-two.sh"))
    monkeypatch.setattr(hp, "resolve", lambda n: "/fake/" + n)
    monkeypatch.setattr(hp, "grant_warning",
                        lambda path: "not root-owned: " + path if "rewritable" in path else None)
    warns = capture._gather_helper_warnings()
    assert warns == ["not root-owned: /fake/rewritable.sh"], warns


def test_the_btmon_helper_is_registered_in_the_one_place_that_gates_grants():
    """`tepna-btmon.sh` (audit §D2) is operator-invoked rather than daemon-invoked, and is listed in
    SUDO_HELPERS anyway: the sudoers grant is the `/usr/local/lib/tepna/*` wildcard that already covers
    its six siblings, so from the moment it is installed the name IS granted — and an in-repo copy on a
    vigil-writable mount is exactly the unsafe-location case `grant_warning` exists to announce.
    Registering it is what puts it under the boot self-test.

    Its GUARDS are not asserted here. An earlier version of this test scanned the script's source for
    the guard strings, which was both weaker and brittle — it broke the moment the confinement root
    became a variable, without any guard changing. The guards are exercised for real, by running the
    script, in test_tepna_btmon_sh.py; this test owns only the registration."""
    import helper_path as hp
    assert "tepna-btmon.sh" in hp.SUDO_HELPERS
