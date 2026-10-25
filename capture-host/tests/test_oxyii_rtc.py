# tepna-capture — tests/test_oxyii_rtc.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The O2Ring RTC re-sync policy. This exists because the previous policy — write the clock on EVERY
# connect — cost 359 GATT writes on the night of 2026-07-19, when a -83 dBm link made the ring reconnect
# every ~16 s. Each write was an extra round-trip ~1.4 s into an already-failing link, plus ~0.4 s of
# setup before the first sample. The clock had not moved; the LINK had.

import datetime as _dt
import capture
import oxyii
from tests._srcscan import module_source, split_segment, until_anchor


NOW = _dt.datetime(2026, 7, 19, 12, 0, 0)
SIX_H = 6 * 3600


def test_first_contact_syncs():
    assert capture.oxyii_rtc_due(None, NOW, False, SIX_H) == "first contact"


def test_a_bare_reconnect_does_NOT_sync():
    """THE regression this policy exists for. A reconnect is not an event the RTC cares about; on a bad
    link there can be hundreds of them in a night and none of them moves the ring's clock."""
    just_synced = NOW - _dt.timedelta(seconds=30)
    assert capture.oxyii_rtc_due(just_synced, NOW, False, SIX_H) is None


def test_359_reconnects_in_one_night_cost_ONE_sync():
    """Replays the real failure: first contact, then 358 reconnects at the measured 16 s median spacing.
    Under the old every-connect policy this was 359 writes."""
    last, writes = None, 0
    t = NOW
    for _ in range(359):
        why = capture.oxyii_rtc_due(last, t, False, SIX_H)
        if why:
            writes += 1
            last = t
        t += _dt.timedelta(seconds=16)  # measured median gap between segments
    assert writes == 1, f"a reconnect storm must cost exactly one clock write, got {writes}"


def test_new_recording_session_syncs_even_if_recent():
    """The .dat stamps a session at its START, so this is the one moment a wrong RTC gets baked into
    stored data. It must win over the 'synced recently' shortcut."""
    just_synced = NOW - _dt.timedelta(seconds=5)
    assert capture.oxyii_rtc_due(just_synced, NOW, True, SIX_H) == "new recording session"


def test_drift_backstop_fires_after_the_interval():
    assert capture.oxyii_rtc_due(NOW - _dt.timedelta(hours=5, minutes=59), NOW, False, SIX_H) is None
    why = capture.oxyii_rtc_due(NOW - _dt.timedelta(hours=6, seconds=1), NOW, False, SIX_H)
    assert why and why.startswith("drift backstop")


def test_backstop_interval_is_configurable():
    hour_old = NOW - _dt.timedelta(hours=1, seconds=1)
    assert capture.oxyii_rtc_due(hour_old, NOW, False, SIX_H) is None  # not due at 6 h
    assert capture.oxyii_rtc_due(hour_old, NOW, False, 3600) is not None  # due at 1 h


def test_session_restart_survives_a_dropout():
    """A session that restarts WHILE the link is down is only visible if the previous duration is carried
    across the gap — capture seeds _seq from the module-level _OXYII_LAST_DURATION for exactly this.
    Duration counts UP across a disconnect, so carrying it over cannot manufacture a false restart."""
    # link drops at 900 s into a session, comes back with the same session still running
    assert oxyii.session_restarted(900, 1500) is False
    # link drops at 900 s, comes back with a NEW session (duration reset) -> must be caught
    assert oxyii.session_restarted(900, 12) is True
    # blind reconnect (no carried duration) cannot see it — the bug the seeding fixes
    assert oxyii.session_restarted(None, 12) is False


def test_rtc_resync_sec_is_in_the_settings_schema():
    import settings_schema

    assert "o2ring.rtc_resync_sec" in settings_schema.SETTINGS


def test_the_clock_write_stays_behind_the_policy():
    """Source scan, in the house style (cf. build.mjs's forbidden-writer assert). The policy is only worth
    anything if EVERY clock write goes through it — one stray unconditional set_time_frame() in the
    connect path silently restores the 359-writes-a-night behaviour while all the unit tests above stay
    green, because they test the decision function rather than its callers."""
    # Via the shared helper, which skips on a mutmut-generated file — this scan sees 664 copies of the
    # single real call site otherwise, and mutmut reports the whole module as "failed to collect stats".
    # See tests/_srcscan.py for the four scan shapes and which of them break.
    src = module_source("capture.py")
    calls = [ln.strip() for ln in src.splitlines() if "set_time_frame(" in ln and not ln.strip().startswith("#")]
    assert len(calls) == 1, f"expected exactly one set_time_frame call site, found {len(calls)}: {calls}"
    # ...and it must sit inside the _rtc_sync helper, which is the only thing that records the write.
    opened = split_segment(src, "async def _rtc_sync(", 1, where="capture.py")
    helper = until_anchor(opened, "\n\n", where="capture.py (the end of _rtc_sync)")
    assert "set_time_frame(" in helper, "the clock write moved out of _rtc_sync — policy bypassed"
    assert "_OXYII_RTC_AT[addr]" in helper, "_rtc_sync must record the write, or the policy cannot age it"


# ── the AES-session guard fires on the BRANCH, and DIS is never the gate ──────────────────────────
# Residue `2026-09-05-dis-firmware-compared-to-a-branch-code`.
import capture as _capture


def _payload(branch: str) -> bytes:
    return bytes((2, 0, 1, 13, 1)) + bytes(4) + branch.encode() + bytes(60 - 17)


def test_the_guard_constant_is_a_branch_code_and_is_named_so():
    """Renamed from `O2RING_PLAINTEXT_FW`: `2D010002` is a branch code, and the old name is what made
    comparing it to a DIS firmware string look reasonable."""
    assert _capture.O2RING_PLAINTEXT_BRANCH == "2D010002"
    assert not hasattr(_capture, "O2RING_PLAINTEXT_FW")


def test_plant_1_a_different_branch_is_flagged_whatever_the_firmware_says():
    """branch 2D010001 + any firmware → the guard's condition holds. The firmware version is reported
    ALONGSIDE, never compared."""
    i = oxyii.parse_get_info(_payload("2D010001"))
    assert i["branch_code"] != _capture.O2RING_PLAINTEXT_BRANCH
    assert i["firmware_version"] == "1.13.1.0"


def test_plant_2_the_measured_plaintext_branch_does_not_fire_even_with_DIS_present():
    """branch 2D010002 + a DIS string like "1.13.1.0" present → no warning. A guard comparing DIS to
    the constant would fire here on every connect, because a version string never equals a branch."""
    i = oxyii.parse_get_info(_payload("2D010002"))
    assert i["branch_code"] == _capture.O2RING_PLAINTEXT_BRANCH
    assert "1.13.1.0" != _capture.O2RING_PLAINTEXT_BRANCH  # the comparison that could never be true


def test_plant_3_DIS_ABSENT_and_branch_2D010001_still_fires():
    """THE CASE THAT IS SILENT TODAY, and the one that must red the wrong fix.

    This box's ring exposes no DIS at all, so a guard keyed on the DIS string never runs. The branch
    code comes from GET_INFO, which EVERY ring answers in our own handshake, so the check exists on
    every link. Asserted through the GUARD's own predicate rather than through parser output — a test
    that only reads `parse_get_info` cannot tell which field the guard is keyed on, which is exactly
    how a wrong fix would slip past it."""
    i = oxyii.parse_get_info(_payload("2D010001"))
    assert _capture.aes_session_suspect(i["branch_code"]) is True


def test_the_predicate_cannot_be_keyed_on_a_firmware_version_by_mistake():
    """The paired opposite. A firmware version handed to this predicate is simply not the measured
    branch, so it reads suspect — which is why the SIGNATURE matters: it takes the branch alone, and a
    guard that cannot see a firmware version cannot compare against one."""
    assert _capture.aes_session_suspect("1.13.1.0") is True
    assert _capture.aes_session_suspect(_capture.O2RING_PLAINTEXT_BRANCH) is False


def test_an_unanswered_GET_INFO_is_not_suspect():
    """Absence of evidence is not evidence of an encrypted session — and warning on it would fire on
    every link before identity arrives."""
    assert _capture.aes_session_suspect(None) is False
    assert _capture.aes_session_suspect("") is False


# ── the agreement bound is its own constant, and the unacknowledged write claims nothing ───────────
# Residue `2026-10-21-the-ring-clock-is-claimed-synced-on-an-unacknowledged-write`.
def test_the_confirm_bound_is_its_own_constant_and_not_the_jump_bound():
    """🔴 A PRE-STATED THRESHOLD MUST NOT BE BORROWED. `_OXYII_RTC_JUMP_S` judges the DELTA between two
    reads and answers "did the RTC restart". The confirm bound judges the ABSOLUTE offset and answers
    "is the clock right now". The two questions take different numbers, and once they share a name
    nothing says which one a reader is looking at — the borrowed-reason defect filed against
    `tools/measurement-walk.mjs:240` on 2026-10-25, in the one place where it would be cheapest to
    create. The bound is the read quantum (±1 s) plus the write latency and one cadence of drift, and
    it is tuned to no corpus."""
    assert capture._OXYII_RTC_CONFIRM_S == 2.0, "the agreement bound is pre-stated, not derived"
    assert capture._OXYII_RTC_CONFIRM_S < capture._OXYII_RTC_JUMP_S, (
        "a delta big enough to suspect a reset sits far outside the agreement bound — the two are "
        "different questions and may never collapse onto one number"
    )


def test_the_unacknowledged_write_does_not_claim_a_synced_clock():
    """Source scan beside `test_the_clock_write_stays_behind_the_policy`, over the same helper. The
    0xC0 write asks `response=False`, so the ring says nothing back and `clock_synced` inside this
    helper would state a measurement nobody made. The behavioural tests live in
    `tests/test_capture_runners.py`; this one holds the SHAPE, because a one-line re-stamp here reads
    as a convenience and restores the false claim with every runner test still green."""
    src = module_source("capture.py")
    opened = split_segment(src, "async def _rtc_sync(", 1, where="capture.py")
    helper = until_anchor(opened, "\n\n", where="capture.py (the end of _rtc_sync)")
    assert "ring_rtc_push=" in helper, "the push must record the request it actually made"
    # Comment lines are stripped the way the sibling scan strips them: the helper's own comment NAMES
    # `clock_synced` to say which site owns it, and a scan that reads prose as code would red on the
    # explanation of the fix.
    code = "\n".join(ln for ln in helper.splitlines() if not ln.strip().startswith("#"))
    assert "clock_synced" not in code, "only an agreeing READ may stamp a synced clock"
