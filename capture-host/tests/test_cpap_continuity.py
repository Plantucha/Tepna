# tepna-capture — tests/test_cpap_continuity.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""INV8 `continuity_status` — the four states, what earns each, and what may never be defaulted.

The tests are organised around the ONE question a downstream consumer asks after a recovery — "can I trust
that no samples were lost?" — and the four honest answers. The assertions that matter most are the
negative ones: that a drop is never followed by `continuous`, that a measured gap is never reported as
unverified, and that an unparseable device clock leaves the tracker saying it did not check rather than
inventing a verdict. Stamps are the AS11's real wire shape (`2026-08-23T01:30:28.730Z`).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cpap_continuity as cc  # noqa: E402

C = cc.Continuity
T0 = "2026-08-23T01:30:28.730Z"


def _ms(s):
    return cc.parse_device_stamp_ms(s)


def _stamp(base_ms, plus_ms):
    """A device stamp `plus_ms` after `base_ms`, in the device's own shape."""
    from datetime import datetime, timezone
    dt = datetime.fromtimestamp((base_ms + plus_ms) / 1000.0, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# ── the parser: explicit format, Clock Contract §2 ──────────────────────────────────────────────
def test_parses_the_device_wire_shape_exactly():
    assert _ms(T0) == pytest.approx(1787448628730.0)
    assert _ms("2026-08-23T05:59:59.000Z") == pytest.approx(1787464799000.0)
    assert _ms("2026-08-23T05:59:59Z") == pytest.approx(1787464799000.0), "fractional part is optional"


@pytest.mark.parametrize("bad", [
    None, 12345, "", "2026-08-23 01:30:28",          # not the wire shape
    "2026-08-23T01:30:28.730+00:00",                  # a zone other than the literal Z
    "2026-13-45T25:99:99.000Z",                       # digits that are not a calendar (§2.7)
    "2026-02-30T00:00:00.000Z",
])
def test_anything_else_is_ABSENT_not_guessed(bad):
    assert _ms(bad) is None


# ── the four states ─────────────────────────────────────────────────────────────────────────────
def test_a_first_session_is_continuous_and_stays_so_while_frames_flow():
    t = cc.ContinuityTracker()
    t.note_start()
    assert t.status is C.CONTINUOUS and t.gap_ms is None
    t.note_frame(T0, 10, 40.0)
    t.note_frame(_stamp(_ms(T0), 400), 10, 40.0)
    assert t.status is C.CONTINUOUS
    assert t.snapshot() == {"continuity_status": "continuous", "continuity_gap_ms": None}


def test_a_DROP_arms_a_resume_and_the_next_session_starts_UNVERIFIED_never_continuous():
    """∅ the load-bearing negative: `continuous` is earned, not defaulted. The session after a drop
    must begin in `resumed-unverified` before a single frame has been compared."""
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    t.note_end(clean=False)                      # the link raised
    t.note_start()
    assert t.status is C.RESUMED_UNVERIFIED and t.gap_ms is None


def test_a_deliberate_STOP_is_not_a_recovery():
    """A stop (button, therapy-end auto-stop) ends the acquisition on purpose. The session that follows
    is a fresh acquisition and starts `continuous` — a stop must not manufacture a resume."""
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    t.note_end(clean=True)
    t.note_start()
    assert t.status is C.CONTINUOUS


def test_VERIFIED_CONTINUOUS_when_the_device_clock_picks_up_where_it_was_owed():
    """Last frame at T0 carried 10 samples at 40 ms → the next sample was owed at T0+400. A first
    post-drop frame at exactly T0+400 means the device buffered through the drop: nothing lost."""
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    t.note_end(clean=False); t.note_start()
    t.note_frame(_stamp(_ms(T0), 400), 10, 40.0)
    assert t.status is C.VERIFIED_CONTINUOUS and t.gap_ms == 0


def test_VERIFIED_CONTINUOUS_tolerates_one_interval_of_frame_batching_but_not_more():
    """Resuming mid-frame is lossless and lands within one interval of the owed sample. One interval
    plus one ms is a lost sample. The boundary is inclusive on the continuous side."""
    base = _ms(T0)
    for offset, expect in ((400 + 40, C.VERIFIED_CONTINUOUS), (400 + 41, C.VERIFIED_GAP)):
        t = cc.ContinuityTracker()
        t.note_start(); t.note_frame(T0, 10, 40.0)
        t.note_end(clean=False); t.note_start()
        t.note_frame(_stamp(base, offset), 10, 40.0)
        assert t.status is expect, offset


def test_VERIFIED_GAP_reports_the_measured_loss_and_never_hides_it_as_unverified():
    """🔴 THE FOURTH STATE. The device says the first post-drop sample is 5.4 s after the one it owed.
    That is knowledge. Reporting `resumed-unverified` would assert ignorance where there is knowledge —
    the mirror of fabricating a value — so the gap gets its own word and its own number."""
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    t.note_end(clean=False); t.note_start()
    t.note_frame(_stamp(_ms(T0), 400 + 5400), 10, 40.0)
    assert t.status is C.VERIFIED_GAP
    assert t.gap_ms == 5400
    assert t.snapshot() == {"continuity_status": "verified-gap", "continuity_gap_ms": 5400}


def test_verification_happens_ONCE_on_the_first_frame_then_the_verdict_holds():
    """Later frames advance the owed clock but must not re-verify: a mid-session frame is not a resume."""
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    t.note_end(clean=False); t.note_start()
    t.note_frame(_stamp(_ms(T0), 400 + 5400), 10, 40.0)      # verdict: gap 5400
    t.note_frame(_stamp(_ms(T0), 400 + 5400 + 400), 10, 40.0)  # ordinary next frame
    assert t.status is C.VERIFIED_GAP and t.gap_ms == 5400


# ── the honest-null paths: cannot verify ⇒ says so ──────────────────────────────────────────────
def test_stays_UNVERIFIED_when_the_predecessor_left_no_usable_clock():
    """A drop before any frame, or a predecessor whose frames had no parseable stamp: there is nothing
    to compare against, so the first post-drop frame cannot verify anything. Not continuous. Not a gap."""
    t = cc.ContinuityTracker()
    t.note_start()                                # no frames at all
    t.note_end(clean=False); t.note_start()
    t.note_frame(T0, 10, 40.0)
    assert t.status is C.RESUMED_UNVERIFIED and t.gap_ms is None

    t2 = cc.ContinuityTracker()
    t2.note_start(); t2.note_frame("garbage", 10, 40.0)   # predecessor's stamp unparseable
    t2.note_end(clean=False); t2.note_start()
    t2.note_frame(T0, 10, 40.0)
    assert t2.status is C.RESUMED_UNVERIFIED


def test_stays_UNVERIFIED_when_the_first_post_drop_frame_has_no_usable_clock():
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    t.note_end(clean=False); t.note_start()
    t.note_frame(None, 10, 40.0)                  # the verifying frame itself is unstamped
    assert t.status is C.RESUMED_UNVERIFIED
    # and a LATER good frame does not retroactively verify — the resume moment has passed
    t.note_frame(_stamp(_ms(T0), 400), 10, 40.0)
    assert t.status is C.RESUMED_UNVERIFIED


def test_unusable_sample_count_or_interval_does_not_move_the_owed_clock():
    """A frame with a bad `n_samples`/`interval_ms` must not advance the owed sample to a guess."""
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    owed = t._expected_next_ms
    t.note_frame(_stamp(_ms(T0), 400), "ten", 40.0)   # bad n
    t.note_frame(_stamp(_ms(T0), 800), 10, 0)         # bad interval
    t.note_frame(_stamp(_ms(T0), 1200), 10, None)
    assert t._expected_next_ms == owed


def test_resume_hint_makes_a_fresh_tracker_start_UNVERIFIED_after_a_daemon_restart():
    """∅ A daemon that restarts mid-therapy has a brand-new tracker with no memory of the drop. The
    controller passes `resume_hint=True` when the autostart record says a therapy was in progress, and
    the honest state is `resumed-unverified` — a fresh tracker defaulting to `continuous` would claim a
    stream ran unbroken across a process it did not survive."""
    t = cc.ContinuityTracker()
    t.note_start(resume_hint=True)
    assert t.status is C.RESUMED_UNVERIFIED
    # and with no predecessor clock the first frame cannot verify: it stays unverified
    t.note_frame(T0, 10, 40.0)
    assert t.status is C.RESUMED_UNVERIFIED
    # the hint is a one-shot: the next clean stop + start is a fresh acquisition again
    t.note_end(clean=True); t.note_start()
    assert t.status is C.CONTINUOUS


def test_resume_hint_does_not_erase_a_real_predecessor_clock():
    """If the tracker DOES remember a drop (armed), a hint must not wipe the clock it could verify with."""
    t = cc.ContinuityTracker()
    t.note_start(); t.note_frame(T0, 10, 40.0)
    t.note_end(clean=False)
    t.note_start(resume_hint=True)
    t.note_frame(_stamp(_ms(T0), 400), 10, 40.0)
    assert t.status is C.VERIFIED_CONTINUOUS


def test_resume_hint_reads_only_a_numeric_open_session_from_the_autostart_record():
    """The daemon's own cross-restart record: `session_ms` numeric ⇒ a therapy was open ⇒ resume.
    Everything else — null, absent, a bool, garbage, no record — is 'no claim', never a hint."""
    assert cc.resume_hint_from_autostart({"session_ms": 1789719792589.3}) is True
    assert cc.resume_hint_from_autostart({"session_ms": 1789719792589}) is True
    for rec in ({"session_ms": None}, {}, {"session_ms": "x"}, {"session_ms": True}, None, [], "str"):
        assert cc.resume_hint_from_autostart(rec) is False, rec
