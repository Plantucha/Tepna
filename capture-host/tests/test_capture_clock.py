# tepna-capture — monotonic capture-clock tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `_now()` stamps every sample of every night, so its failure mode is silent and total. The Clock
# Contract's "overnight 22:00→06:00 = ~8 h monotonic" check is what these lock down — specifically the
# one night a year a DST fall-back could rewind a recording an hour, which no ordinary test night
# would ever reach.
import datetime as dt
import types

import capture


class _Clock:
    """A driveable wall+monotonic pair. `wall` and `mono` move INDEPENDENTLY — that divergence is the
    entire signal `_now()` reads, so the test must be able to produce it deliberately."""

    def __init__(self, wall: dt.datetime, offset_h: float = 1.0):
        self.wall = wall
        self.mono = 1000.0
        self.offset = dt.timedelta(hours=offset_h)

    def tick(self, secs: float, wall_secs: float | None = None) -> None:
        self.mono += secs
        self.wall += dt.timedelta(seconds=secs if wall_secs is None else wall_secs)

    def step(self, secs: float, offset_h: float | None = None) -> None:
        """A discontinuity: the wall clock moves with no monotonic time passing."""
        self.wall += dt.timedelta(seconds=secs)
        if offset_h is not None:
            self.offset = dt.timedelta(hours=offset_h)


def _install(monkeypatch, clk: _Clock) -> None:
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


def test_backward_ntp_step_reanchors(monkeypatch):
    clk = _Clock(dt.datetime(2026, 11, 1, 22, 0, 0))
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    clk.step(-30.0)                    # a backward correction with no zone change IS a step
    assert capture._now() == dt.datetime(2026, 11, 1, 21, 59, 40)


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
    clk = _Clock(dt.datetime(2026, 7, 1, 22, 0, 0), offset_h=-4.0)
    _install(monkeypatch, clk)
    capture._now()
    clk.tick(10.0)
    clk.step(-3600.0)                  # no offset change
    assert capture._now() == dt.datetime(2026, 7, 1, 21, 0, 10)


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
