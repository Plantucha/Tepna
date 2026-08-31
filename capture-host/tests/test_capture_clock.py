# tepna-capture — monotonic capture-clock tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `_now()` stamps every sample of every night, so its failure mode is silent and total. The Clock
# Contract's "overnight 22:00→06:00 = ~8 h monotonic" check is what these lock down — specifically the
# one night a year a DST fall-back could rewind a recording an hour, which no ordinary test night
# would ever reach.
import asyncio
import datetime as dt
import types

import pytest

import capture


class _Clock:
    """A driveable wall+monotonic pair. `wall` and `mono` move INDEPENDENTLY — that divergence is the
    entire signal `_now()` reads, so the test must be able to produce it deliberately."""

    def __init__(self, wall: dt.datetime, offset_h: float = 1.0):
        self.wall = wall
        self.mono = 1000.0
        self.offset = dt.timedelta(hours=offset_h)
        self.writers_open = 1        # set by _install; see its note

    def tick(self, secs: float, wall_secs: float | None = None) -> None:
        self.mono += secs
        self.wall += dt.timedelta(seconds=secs if wall_secs is None else wall_secs)

    def step(self, secs: float, offset_h: float | None = None) -> None:
        """A discontinuity: the wall clock moves with no monotonic time passing."""
        self.wall += dt.timedelta(seconds=secs)
        if offset_h is not None:
            self.offset = dt.timedelta(hours=offset_h)


def _install(monkeypatch, clk: _Clock, writers_open: int = 1) -> None:
    monkeypatch.setattr(capture, "_time", types.SimpleNamespace(monotonic=lambda: clk.mono))
    monkeypatch.setattr(capture, "_dt", types.SimpleNamespace(
        datetime=types.SimpleNamespace(now=lambda: clk.wall), timedelta=dt.timedelta))
    # The zone seam. Patched so the test asserts the same thing in every CI timezone; `_utcoffset`
    # itself is covered against a real zone by test_utcoffset_tracks_a_real_dst_transition.
    monkeypatch.setattr(capture, "_utcoffset", lambda when: clk.offset)
    monkeypatch.setattr(capture, "_anchor_wall", None)
    monkeypatch.setattr(capture, "_anchor_mono", 0.0)
    monkeypatch.setattr(capture, "_anchor_utcoff", dt.timedelta(0))
    monkeypatch.setattr(capture, "_civil_shift", 0.0)
    # A RECORDING IS IN PROGRESS. Every test below the transition group is about a file that must not
    # rewind, and "a file is open" is the precondition that entitles `_now()` to absorb a civil
    # relabelling at all (CAPTURE-HOST-DEEP-AUDIT §A1). It used to be implicit — which is exactly how
    # the absorbed hour came to outlive the file and stamp every later night an hour off — so it is
    # now stated. Pass 0 to model an IDLE box.
    clk.writers_open = writers_open
    monkeypatch.setattr(capture, "open_sample_writers", lambda: clk.writers_open)


def test_normal_advance_is_monotonic(monkeypatch):
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    first = capture._now()
    seen = [first]
    for _ in range(10):
        clk.tick(0.5)
        seen.append(capture._now())
    assert seen == sorted(seen)
    assert (seen[-1] - seen[0]).total_seconds() == 5.0


def test_sub_threshold_jitter_is_smoothed_not_followed(monkeypatch):
    # A <2 s wobble is NTP slewing, not a step: stamps must follow the monotonic prediction, not the wobble.
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(1.0)
    clk.step(1.5)                      # wall nudged forward, still under the threshold
    assert capture._now() == dt.datetime(2026, 11, 1, 22, 0, 1)


def test_genuine_ntp_step_reanchors(monkeypatch):
    # An RTC-less Pi that first syncs minutes after boot: offset UNCHANGED, clock corrected → follow it.
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    clk.step(45.0)                     # +45 s correction, no zone change
    assert capture._now() == dt.datetime(2026, 11, 1, 22, 0, 55)
    clk.tick(1.0)                      # and it keeps counting from the corrected anchor
    assert capture._now() == dt.datetime(2026, 11, 1, 22, 0, 56)


def test_backward_ntp_step_is_ABSORBED_while_a_capture_file_is_open(monkeypatch):
    """CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS §3, decided 2026-08-05. This test previously asserted that a
    backward step RE-ANCHORS, which is what the code did — and what the audit measured as a defect it
    filed but never decided: a -30 s step mid-session sent `_now()` from 22:00:10 to 21:59:50, so the
    Phone column of a file being written REWOUND 20 s.

    The rule was already in the file, one branch up: the DST arm absorbs a relabelling "ONLY to protect
    an open recording … there is no file to rewind". A backward step has the identical consequence by a
    different mechanism, so it takes the identical treatment. A rewind breaks the strictly-increasing
    guarantee every parser depends on — that is a corrupt recording, not a mislabelled one."""
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)                       # writers_open defaults to 1
    capture._now()
    clk.tick(10.0)
    before = capture._now()
    clk.step(-30.0)                    # a backward correction with no zone change
    assert capture._now() >= before, "an absorbed step must never move the clock backwards"
    clk.tick(1.0)                      # …and real time must still ADVANCE across it
    after = capture._now()
    assert after > before, f"the capture clock rewound {before - after} with a file open"
    assert after == dt.datetime(2026, 11, 1, 22, 0, 11), "it keeps counting in the pre-step frame"


def test_backward_ntp_step_is_FOLLOWED_when_nothing_is_being_written(monkeypatch):
    """The other half of the same rule, and the reason absorbing is not simply "ignore the clock": with
    no file open there is nothing to rewind, so the correction is free and the box should take it."""
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk, writers_open=0)
    capture._now()
    clk.tick(10.0)
    clk.step(-30.0)
    assert capture._now() == dt.datetime(2026, 11, 1, 21, 59, 40), \
        "with no recording open the backward correction must be applied, not absorbed"


def test_forward_ntp_step_is_still_applied_even_with_a_file_open(monkeypatch):
    """A forward step cannot rewind anything, so it is applied as before — absorbing it would cost
    absolute accuracy for no gain. The asymmetry is the whole point of the rule."""
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    clk.step(+30.0)
    assert capture._now() == dt.datetime(2026, 11, 1, 22, 0, 40)


def test_dst_fall_back_does_not_rewind_the_night(monkeypatch):
    # THE regression this guards. 01:59:59 EDT → 01:00:00 EST: wall goes back an hour, offset goes
    # back an hour. Stamps must keep counting forward in the session's original offset.
    clk = _Clock(dt.datetime(2026, 11, 1, 1, 59, 0), offset_h=-4.0)
    _install(monkeypatch, clk)
    start = capture._now()
    clk.tick(60.0)
    before = capture._now()
    clk.step(-3600.0, offset_h=-5.0)   # the fall-back
    clk.tick(1.0)
    after = capture._now()
    assert after > before, "a fall-back rewound the recording — Clock Contract §monotonic violated"
    assert after == dt.datetime(2026, 11, 1, 2, 0, 1)
    # and elapsed stamp-time still equals elapsed real time across the transition
    assert (after - start).total_seconds() == 61.0
    clk.tick(30.0)                     # steady state after absorbing it: still monotonic, still 1:1
    assert capture._now() == dt.datetime(2026, 11, 1, 2, 0, 31)


def test_dst_spring_forward_does_not_jump_the_night(monkeypatch):
    # The symmetric case: 01:59:59 EST → 03:00:00 EDT. A +3600 s civil relabelling is monotonic either
    # way, but following it would insert a phantom hour into the file's elapsed time.
    clk = _Clock(dt.datetime(2026, 3, 8, 1, 59, 0), offset_h=-5.0)
    _install(monkeypatch, clk)
    start = capture._now()
    clk.tick(60.0)
    clk.step(3600.0, offset_h=-4.0)
    after = capture._now()
    assert (after - start).total_seconds() == 60.0
    assert after == dt.datetime(2026, 3, 8, 2, 0, 0)


def test_a_transition_is_logged_once_not_per_sample(monkeypatch, caplog):
    # The absorbed shift must persist in the FAST path. If it doesn't, every subsequent sample looks
    # like a fresh step: the stamps still come out right, so only the log betrays it — at 130 Hz that
    # is a warning per ECG sample all night. "A jump you can see" means one line, not a flood.
    clk = _Clock(dt.datetime(2026, 11, 1, 1, 59, 0), offset_h=-4.0)
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(60.0)
    clk.step(-3600.0, offset_h=-5.0)
    with caplog.at_level("WARNING"):
        for _ in range(100):
            clk.tick(1.0 / 130)
            capture._now()
    assert len(caplog.records) == 1, f"clock logged {len(caplog.records)} times for one transition"
    assert "DST" in caplog.records[0].message


def test_ntp_step_after_a_dst_transition_still_reanchors(monkeypatch):
    # Absorbing the transition must not blind the detector: a real step on top of it is still a step.
    clk = _Clock(dt.datetime(2026, 11, 1, 1, 59, 0), offset_h=-4.0)
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(60.0)
    clk.step(-3600.0, offset_h=-5.0)
    capture._now()                     # absorbed
    clk.tick(10.0)
    clk.step(45.0)                     # now a genuine correction, zone unchanged
    assert capture._now() == dt.datetime(2026, 11, 1, 2, 0, 55)


def test_a_step_that_merely_looks_like_an_hour_is_not_excused(monkeypatch):
    # The guard keys on the ZONE, not on the magnitude. A -3600 s correction with the offset UNCHANGED
    # is a broken clock, not a fall-back, and must re-anchor. (A magnitude heuristic would miss this.)
    # Driven with NO writer open, so the zone-vs-magnitude question is asked in isolation: with a file
    # open a backward step is now absorbed regardless (§3, 2026-08-05), which would mask what this is
    # about. The claim under test is that a -3600 s correction with an UNCHANGED offset is not excused
    # as a fall-back — and with nothing to rewind, not excusing it means following it.
    clk = _Clock(dt.datetime(2026, 7, 1, 22, 0, 0), offset_h=-4.0)
    _install(monkeypatch, clk, writers_open=0)
    capture._now()
    clk.tick(10.0)
    clk.step(-3600.0)                  # no offset change
    assert capture._now() == dt.datetime(2026, 7, 1, 21, 0, 10)


def test_an_hour_backward_with_an_open_file_is_absorbed_not_excused(monkeypatch):
    """The same broken clock, with a recording open. It must still NOT be treated as a fall-back — but
    the protection that applies is absorption, not re-anchoring, and the file must not rewind."""
    clk = _Clock(dt.datetime(2026, 7, 1, 22, 0, 0), offset_h=-4.0)
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    before = capture._now()
    clk.step(-3600.0)
    assert capture._now() >= before, "an hour-long backward step must not rewind an open recording"


# ── §A1 · the absorbed shift has a LIFETIME ───────────────────────────────────────────────────────
# Every test above holds ONE file open across ONE transition, which is the whole of what the original
# implementation was ever driven through — and it passes with the defect live. What follows drives the
# thing the unit actually does: run for months under `Restart=always`, across a transition, into
# LATER nights. A fold-correct epoch clock is required to state that honestly, because the question
# "what is the civil time a week after the fall-back?" cannot be answered by a hand-nudged wall clock.


class _ZonedClock:
    """A real UTC instant + a real IANA zone. `wall` is derived, never set — so the autumn fold, the
    spring gap and the post-transition offset are the zone database's answers, not the test's.

    Also carries `writers_open`, because in this suite "is a file open?" is a clock input."""

    def __init__(self, epoch: float, zone: str, writers_open: int = 1):
        from zoneinfo import ZoneInfo
        self._ZoneInfo = ZoneInfo
        self.epoch = epoch
        self.zone = ZoneInfo(zone)
        self.mono = 1000.0
        self.writers_open = writers_open

    @property
    def wall(self) -> dt.datetime:
        """Local civil time as `datetime.now()` returns it: naive, fold-correct."""
        return dt.datetime.fromtimestamp(self.epoch, tz=self.zone).replace(tzinfo=None)

    @property
    def offset(self) -> dt.timedelta:
        off = dt.datetime.fromtimestamp(self.epoch, tz=self.zone).utcoffset()
        # `utcoffset()` is Optional in the stubs because a NAIVE datetime returns None. This one
        # cannot be naive: `self.zone` is a ZoneInfo built in __init__ and never None, so the
        # annotation is already correct and mypy simply cannot prove it. The assert states that
        # invariant — and would fire if someone ever made the zone optional — rather than widening
        # the return type and pushing an impossible None onto every caller.
        assert off is not None
        return off

    def advance(self, secs: float) -> None:
        """Real time passing: the instant and the monotonic counter move together."""
        self.epoch += secs
        self.mono += secs

    def set_zone(self, zone: str) -> None:
        """`timedatectl set-timezone` — the instant is unchanged, its civil label is not."""
        self.zone = self._ZoneInfo(zone)


def _install_zoned(monkeypatch, clk: _ZonedClock) -> None:
    monkeypatch.setattr(capture, "_time", types.SimpleNamespace(monotonic=lambda: clk.mono))
    monkeypatch.setattr(capture, "_dt", types.SimpleNamespace(
        datetime=types.SimpleNamespace(now=lambda: clk.wall), timedelta=dt.timedelta))
    monkeypatch.setattr(capture, "_utcoffset", lambda when: clk.offset)
    monkeypatch.setattr(capture, "_anchor_wall", None)
    monkeypatch.setattr(capture, "_anchor_mono", 0.0)
    monkeypatch.setattr(capture, "_anchor_utcoff", dt.timedelta(0))
    monkeypatch.setattr(capture, "_civil_shift", 0.0)
    monkeypatch.setattr(capture, "open_sample_writers", lambda: clk.writers_open)


# 2026-11-01 01:30 EDT — half an hour before America/New_York falls back to EST.
_NY_FALLBACK_EVE = dt.datetime(2026, 11, 1, 5, 30, tzinfo=dt.timezone.utc).timestamp()


def test_a_later_night_is_stamped_in_civil_time_after_a_transition(monkeypatch):
    """THE §A1 regression. One autumn fall-back used to shift EVERY subsequent night by an hour —
    the Phone column, the filename stamp and night_dir() alike — because the absorbed shift lived in a
    module global and the unit never restarts. Fails against the pre-fix code at +3600 s on day 1."""
    clk = _ZonedClock(_NY_FALLBACK_EVE, "America/New_York")
    _install_zoned(monkeypatch, clk)
    capture._now()
    clk.advance(3600)                       # through the fall-back, file still open
    absorbed = capture._now()
    assert absorbed == dt.datetime(2026, 11, 1, 2, 30), "the open recording must not rewind"
    assert clk.wall == dt.datetime(2026, 11, 1, 1, 30), "the zone did fall back"

    clk.writers_open = 0                    # the session ends at dawn
    capture._now()                          # the absorbed frame expires here

    elapsed = 0
    for days in (1, 7, 30, 120):            # every later night, out past the spring transition
        clk.advance(86400 * (days - elapsed))
        elapsed = days
        clk.writers_open = 1                # the next night starts recording
        stamp = capture._now()
        assert stamp == clk.wall, f"+{days}d: stamp {stamp} != civil {clk.wall}"
        clk.writers_open = 0                # and ends
        capture._now()


def test_a_deliberate_zone_change_reanchors_instead_of_being_absorbed(monkeypatch):
    """The second, worse trigger: a zone move is indistinguishable from a DST relabelling by offset
    alone, so `_now()` absorbed it while /api/clock/tz answered ok and reported the NEW zone."""
    clk = _ZonedClock(_NY_FALLBACK_EVE, "America/New_York")
    _install_zoned(monkeypatch, clk)
    capture._now()
    clk.advance(60)
    clk.set_zone("America/Chicago")         # what /api/clock/tz performs
    capture.reset_clock_anchor("timezone set to America/Chicago")
    assert capture._now() == clk.wall
    # And it stays right. The box idles between nights, so Chicago's OWN fall-back (02:00 CDT on the
    # same date) is followed rather than absorbed — had the file stayed open across it, absorbing it
    # would be correct, which is why this leg models the real duty cycle instead of a 10-day recording.
    clk.writers_open = 0
    for _ in range(10):
        clk.advance(86400)
        assert capture._now() == clk.wall


def test_a_relabelling_with_no_file_open_is_followed_not_absorbed(monkeypatch):
    """Rule 1. With nothing being recorded there is no artefact to protect, so absorbing would bank an
    hour of error for free. (An idle box across a transition is the common case — most nights the box
    is awake and not capturing at 02:00.)"""
    clk = _ZonedClock(_NY_FALLBACK_EVE, "America/New_York", writers_open=0)
    _install_zoned(monkeypatch, clk)
    capture._now()
    clk.advance(3600)
    assert capture._now() == clk.wall == dt.datetime(2026, 11, 1, 1, 30)
    assert capture._civil_shift == 0.0, "nothing was open — nothing should have been absorbed"


def test_the_absorbed_shift_expires_when_the_last_file_closes(monkeypatch):
    """Rule 2, in isolation: the shift survives exactly as long as a file is open, and no longer."""
    clk = _ZonedClock(_NY_FALLBACK_EVE, "America/New_York")
    _install_zoned(monkeypatch, clk)
    capture._now()
    clk.advance(3600)
    capture._now()
    assert capture._civil_shift == -3600.0, "an open recording must still absorb the relabelling"
    clk.writers_open = 0
    assert capture._now() == clk.wall
    assert capture._civil_shift == 0.0


def test_expiry_does_not_fire_while_any_file_is_still_open(monkeypatch):
    """The control. If the expiry keyed on something looser than the open count — a night roll, a
    timer — it would rewind a still-open recording, which is the failure the absorption exists to
    prevent. Two devices, one ending early: the survivor's file must not move."""
    clk = _ZonedClock(_NY_FALLBACK_EVE, "America/New_York", writers_open=2)
    _install_zoned(monkeypatch, clk)
    capture._now()
    clk.advance(3600)
    before = capture._now()
    clk.writers_open = 1                    # one device drops; the other is still writing
    clk.advance(30)
    after = capture._now()
    assert after == before + dt.timedelta(seconds=30), "a still-open recording rewound"
    assert capture._civil_shift == -3600.0


def test_utcoffset_tracks_a_real_dst_transition(monkeypatch):
    # Covers the seam the tests above patch out: `_utcoffset` must report the offset in force AT the
    # given instant, which is what makes the fall-back distinguishable from an NTP step at all.
    import os
    import time as real_time
    if not hasattr(real_time, "tzset"):     # Windows: no TZ support in libc
        return
    old = os.environ.get("TZ")
    try:
        os.environ["TZ"] = "America/New_York"
        real_time.tzset()
        summer = capture._utcoffset(dt.datetime(2026, 7, 1, 12, 0, 0))
        winter = capture._utcoffset(dt.datetime(2026, 12, 1, 12, 0, 0))
        assert summer == dt.timedelta(hours=-4)
        assert winter == dt.timedelta(hours=-5)
        assert (winter - summer).total_seconds() == -3600.0
    finally:
        if old is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old
        real_time.tzset()


# ── the absorbed offset is REPORTED, not silently traded ─────────────────────────────────────────────
# CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-II §3. Absorbing a backward step (or a DST relabelling) keeps an
# open recording monotonic, which is the right call — a rewind breaks the strictly-increasing guarantee
# every parser depends on. But the cost is that every stamp after it is off by the absorbed amount for
# the rest of the session, and until this existed NOTHING said so. A night whose absolute time is
# knowingly wrong is precisely the fact an operator needs before aligning it against another device.

def test_the_steady_state_reports_no_absorbed_shift(monkeypatch):
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    capture._now()
    assert capture.absorbed_shift_sec() == 0.0, "nothing absorbed ⇒ absolute time is trustworthy"


def test_an_absorbed_backward_step_is_reported_with_its_size(monkeypatch):
    """The number matters, not just the flag: it is how far off the night's absolute time is."""
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)                      # a writer is open
    capture._now()
    clk.tick(10.0)
    clk.step(-30.0)
    capture._now()
    assert capture.absorbed_shift_sec() == pytest.approx(-30.0, abs=0.01), \
        "the session is 30 s behind civil time and must say so"


def test_an_absorbed_DST_relabelling_is_reported_too(monkeypatch):
    """Same surface for the other absorber — the operator's question is "how wrong is this night?",
    not "which mechanism made it wrong"."""
    clk = _Clock(dt.datetime(2026, 11, 1, 1, 30, 0), offset_h=-4.0)
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(60.0)
    clk.step(-3600.0, offset_h=-5.0)                # fall back: wall AND zone move together
    capture._now()
    assert capture.absorbed_shift_sec() == pytest.approx(-3600.0, abs=0.01)


def test_re_anchoring_clears_the_reported_shift(monkeypatch):
    """§A1 rule 2 — the absorbed shift expires with the artefact it protects. If the report outlived
    the absorption it would be worse than absent: a stale non-zero says a fresh session is off when it
    is not."""
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    clk.step(-30.0)
    capture._now()
    assert capture.absorbed_shift_sec() != 0.0
    capture.reset_clock_anchor("operator set the timezone")
    assert capture.absorbed_shift_sec() == 0.0, "a re-anchor discards the shift, so the report must too"


def test_the_absorbed_shift_REACHES_status_json(monkeypatch):
    """The accessor being right is not the point — the operator reading it is.

    Deleting the line that publishes `capture_absorbed_sec` survived every test above, which is the same
    silent-trade shape this whole item is about: the value was computed correctly and went nowhere. This
    drives `host_clock_poller` for one cycle and asserts the fact lands on the surface `/api/state`
    serves (`webmon.py` passes `status.get("host_clock")` straight through)."""
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    # A FRACTIONAL step on purpose: rounding the report to whole seconds would turn a sub-second
    # absorbed shift into "no shift at all", which is the same silent trade in miniature.
    clk.step(-30.25)
    capture._now()                                  # absorbed: the session is now 30.25 s behind

    async def _fake_read_state():
        return {"trust": "ntp", "absolute_ok": True, "reason": "chrony"}
    monkeypatch.setattr(capture.host_clock, "read_state", _fake_read_state)

    n = {"i": 0}

    async def _fake_sleep(_s):
        n["i"] += 1
        capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", _fake_sleep)
    capture._STOP.clear()
    try:
        asyncio.run(capture.host_clock_poller({"time": {"provenance_poll_sec": 0}}, None))
    finally:
        capture._STOP.set()

    hc = capture.STATUS.get("host_clock") or {}
    assert "capture_absorbed_sec" in hc, "the absorbed offset never reached status.json"
    assert hc["capture_absorbed_sec"] == pytest.approx(-30.25, abs=0.01), hc
    assert hc["capture_absorbed_sec"] != round(hc["capture_absorbed_sec"]), \
        "sub-second resolution is load-bearing — a rounded report hides a small absorbed shift entirely"
    assert hc.get("trust") == "ntp", "and it must ride ALONGSIDE the host facts, not replace them"
