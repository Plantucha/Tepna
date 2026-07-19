# tepna-capture — tests/test_capture_clock_and_health.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# capture._now() — the CLOCK_MONOTONIC-anchored wall clock every sample is stamped with — and
# classify_adapter_health, the pure decision the BLE watchdog turns on.
#
# _now() makes a THREE-WAY distinction that is exact rather than heuristic, and getting it wrong is
# invisible until it ruins a night:
#
#   normal drift  -> return the monotonic prediction (the fast path, runs at 130 Hz)
#   DST relabel   -> the zone's UTC offset moved by the SAME amount as the apparent drift. Absorb it and
#                    keep counting in the session's ORIGINAL offset. Re-anchoring here would rewind the
#                    file a full hour MID-NIGHT, colliding with the hour it already wrote — the Clock
#                    Contract's "overnight 22:00→06:00 = ~8 h monotonic" check fails on exactly one night
#                    a year, which is the definition of a bug nobody catches in testing.
#   NTP step      -> the clock moved with the offset UNCHANGED. Re-anchor.
#
# Driven by replacing capture._dt / capture._time / capture._utcoffset, so no real clock is touched and
# a DST transition can be exercised in a second.

import datetime as dt
import types

import pytest

import capture


class _Clock:
    """A controllable stand-in for the wall clock, the monotonic clock and the zone offset."""

    def __init__(self, wall: dt.datetime, mono: float = 1000.0, offset_hours: float = -4):
        self.wall, self.mono = wall, mono
        self.offset = dt.timedelta(hours=offset_hours)

    def advance(self, seconds: float):
        """Time passes normally — both clocks move together."""
        self.wall += dt.timedelta(seconds=seconds)
        self.mono += seconds

    def step_wall(self, seconds: float):
        """The WALL clock jumps without the monotonic clock — an NTP correction."""
        self.wall += dt.timedelta(seconds=seconds)

    def dst_transition(self, seconds: float):
        """Civil relabelling: the wall clock jumps AND the zone offset moves by the same amount."""
        self.wall += dt.timedelta(seconds=seconds)
        self.offset += dt.timedelta(seconds=seconds)


@pytest.fixture
def clock(monkeypatch):
    c = _Clock(dt.datetime(2026, 11, 1, 1, 30, 0))

    class FakeDatetime(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return c.wall

    monkeypatch.setattr(capture, "_dt", types.SimpleNamespace(
        datetime=FakeDatetime, timedelta=dt.timedelta))
    monkeypatch.setattr(capture, "_time", types.SimpleNamespace(monotonic=lambda: c.mono))
    monkeypatch.setattr(capture, "_utcoffset", lambda _when: c.offset)
    # module-level anchor state must not leak between tests
    monkeypatch.setattr(capture, "_anchor_wall", None)
    monkeypatch.setattr(capture, "_anchor_mono", 0.0)
    monkeypatch.setattr(capture, "_anchor_utcoff", dt.timedelta(0))
    monkeypatch.setattr(capture, "_civil_shift", 0.0)
    return c


# ── the fast path ───────────────────────────────────────────────────────────────────────────────────
def test_first_call_anchors_and_returns_civil_time(clock):
    assert capture._now() == clock.wall
    assert capture._anchor_wall is not None, "the first call must pin the anchor"


def test_steady_state_tracks_the_monotonic_clock(clock):
    capture._now()
    clock.advance(10)
    assert capture._now() == clock.wall
    clock.advance(3600)
    assert capture._now() == clock.wall


def test_sub_threshold_wobble_is_ignored_and_the_prediction_wins(clock):
    """The wall clock jitters by less than the step threshold; stamps must keep coming off the monotonic
    prediction rather than following the noise."""
    capture._now()
    clock.advance(60)
    clock.step_wall(1.0)                      # under _STEP_THRESH_S
    got = capture._now()
    assert got == clock.wall - dt.timedelta(seconds=1.0), "prediction, not the wobbling wall clock"


# ── NTP steps ───────────────────────────────────────────────────────────────────────────────────────
def test_a_forward_ntp_step_re_anchors(clock):
    capture._now()
    clock.advance(60)
    clock.step_wall(30)                        # NTP correction, offset unchanged
    assert capture._now() == clock.wall
    clock.advance(5)
    assert capture._now() == clock.wall, "after re-anchoring it tracks the corrected clock"


def test_a_backward_ntp_step_re_anchors(clock):
    capture._now()
    clock.advance(60)
    clock.step_wall(-30)
    assert capture._now() == clock.wall


# ── DST: the case this whole path exists for ────────────────────────────────────────────────────────
def test_a_fall_back_transition_does_NOT_rewind_the_stamps(clock):
    """THE bug. At 02:00 on the autumn transition the civil clock goes back an hour. Re-anchoring would
    rewind capture stamps into an hour already written. Stamps must keep counting monotonically in the
    session's original offset instead."""
    t0 = capture._now()
    clock.advance(1800)                        # 30 min of real recording
    before = capture._now()
    clock.dst_transition(-3600)                # 02:00 -> 01:00, offset -4h -> -5h
    at_transition = capture._now()
    # No monotonic time passed across the relabelling, so the stamp must not move AT ALL — in particular
    # it must not rewind by the width of the transition, which is what re-anchoring would do.
    assert at_transition >= before, "stamps went BACKWARDS across a DST fall-back"
    assert (at_transition - before).total_seconds() == pytest.approx(0, abs=1), \
        "the hour is civil relabelling, not elapsed time — it must not appear in the stamps"
    # and recording continues to advance normally on the far side
    clock.advance(60)
    after = capture._now()
    assert (after - at_transition).total_seconds() == pytest.approx(60, abs=1)
    assert (after - t0).total_seconds() == pytest.approx(1860, abs=1), \
        "total elapsed must be real recording time, not real time minus the transition"


def test_a_spring_forward_transition_does_not_jump_the_stamps(clock):
    capture._now()
    clock.advance(600)
    before = capture._now()
    clock.dst_transition(3600)                 # 01:00 -> 03:00, offset -5h -> -4h
    after = capture._now()
    assert (after - before).total_seconds() == pytest.approx(0, abs=1), \
        "a spring-forward must not insert a fabricated hour of recording"


def test_stamps_stay_monotonic_across_a_transition_for_a_whole_night(clock):
    """The Clock Contract's own check: overnight 22:00→06:00 must be ~8 h monotonic, on the one night a
    year that contains a transition."""
    stamps = [capture._now()]
    for minute in range(8 * 60):
        clock.advance(60)
        if minute == 240:                      # 4 h in, fall back
            clock.dst_transition(-3600)
        stamps.append(capture._now())
    assert all(b > a for a, b in zip(stamps, stamps[1:])), "stamps must be strictly increasing"
    elapsed = (stamps[-1] - stamps[0]).total_seconds()
    assert elapsed == pytest.approx(8 * 3600, abs=5), f"~8 h expected, got {elapsed / 3600:.2f} h"


def test_an_ntp_step_after_a_transition_re_anchors_inside_the_original_offset_frame(clock):
    """The compound case the _civil_shift carry-forward exists for: once a transition has been absorbed,
    a genuine NTP correction must re-anchor WITHIN the session's original frame. Dropping back to plain
    civil time here would rewind the file by the width of the transition."""
    capture._now()
    clock.advance(600)
    clock.dst_transition(-3600)
    after_dst = capture._now()
    assert capture._civil_shift == pytest.approx(-3600, abs=1)
    clock.advance(300)
    clock.step_wall(20)                        # NTP correction, offset unchanged
    after_ntp = capture._now()
    assert after_ntp > after_dst, "stamps went backwards when NTP landed after a transition"
    assert capture._civil_shift == pytest.approx(-3600, abs=1), "the absorbed shift must carry forward"
    clock.advance(60)
    assert capture._now() > after_ntp


def test_civil_shift_is_recorded_only_once_per_transition(clock):
    capture._now()
    clock.advance(60)
    clock.dst_transition(-3600)
    capture._now()
    first = capture._civil_shift
    for _ in range(5):
        clock.advance(60)
        capture._now()
    assert capture._civil_shift == first, "a settled transition must not be re-absorbed every call"


# ── classify_adapter_health ─────────────────────────────────────────────────────────────────────────
def test_nothing_worn_is_benign_not_wedged():
    """The distinction the whole watchdog turns on. Yanking the adapter because the user took a sensor
    off is worse than the problem it would be 'fixing'."""
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "not found"},
        {"name": "Ring", "address": "B", "connected": False, "last_error": None},
    ])
    assert h["wedged"] is False and h["reasons"] == [] and h["phantom"] == []


def test_in_progress_is_an_unambiguous_wedge():
    """A not-worn device fails cleanly with 'not found'; InProgress is adapter-level contention and can
    never be a not-worn state."""
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False,
         "last_error": "BleakDBusError('org.bluez.Error.InProgress', ...)"}])
    assert h["wedged"] is True and "H10: InProgress" in h["reasons"]
    assert h["phantom"] == [], "InProgress needs no targeted disconnect"


def test_a_phantom_link_is_wedged_and_names_the_address():
    """BlueZ says Connected while we say not — a stale link nobody can re-grab, because a 'connected'
    device stops advertising. The address is what the recovery ladder disconnects."""
    h = capture.classify_adapter_health([
        {"name": "Ring", "address": "D1:98:62:7C:92:B3", "connected": False, "bluez_connected": True}])
    assert h["wedged"] is True and h["phantom"] == ["D1:98:62:7C:92:B3"]
    assert "phantom BlueZ link" in h["reasons"][0]


def test_a_healthy_connected_device_is_not_a_phantom():
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": True, "bluez_connected": True}])
    assert h["wedged"] is False and h["phantom"] == []


def test_several_signals_are_all_reported():
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "InProgress"},
        {"name": "Ring", "address": "B", "connected": False, "bluez_connected": True},
        {"name": "Verity", "address": "C", "connected": True},
    ])
    assert h["wedged"] is True and len(h["reasons"]) == 2 and h["phantom"] == ["B"]


def test_an_empty_device_list_is_not_wedged():
    assert capture.classify_adapter_health([])["wedged"] is False

