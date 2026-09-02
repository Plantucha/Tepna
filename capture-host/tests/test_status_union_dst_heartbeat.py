# tepna-capture — tests/test_status_union_dst_heartbeat.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# DEEP-AUDIT-VI's one CONTESTED finding, and the test its disposition asked for.
#
# The claim: status_loop stamps `heartbeat_ms` from `_now()` — the civil-anchored frame that
# deliberately ABSORBS a DST relabelling while a recording is open (§A1) — while
# `status_union.instance_health` ages it against real `time.time()`. The dissenting lens declined to
# confirm it because the original repro SET the module anchors to the state the absorb branch
# produces; it never drove a transition. So this file drives one.
#
# What is faked here is ONLY the clock source: `datetime.now()` and `monotonic()`. The zone is a real
# tz-database zone, the offsets come from real `astimezone()`, the naive→epoch conversion is real
# `datetime.timestamp()`, and `_now()` reaches its absorb branch by its own arithmetic. That matters
# more than it sounds: the sibling `clock` fixture in test_capture_clock_and_health.py stubs
# `capture._utcoffset`, which makes it structurally unable to exercise this defect — the whole failure
# lives in how a naive stamp in one offset frame converts to an epoch under another.
#
# MEASURED 2026-09-02, driving both transitions with a writer open (see the table in
# DEEP-AUDIT-VI-FOLLOWUPS §1.7):
#   fall-back      — a daemon WEDGED for 30 min reads {'state':'live','age_ms':0} at every age from
#                    +1 min to +5 h. The heartbeat sits an hour in the FUTURE and `max(0, …)` clamps
#                    the age, so the up-but-wedged case this layer exists to catch is invisible.
#   spring-forward — a HEALTHY daemon reads {'state':'stale','age_ms':3600000} — but only from ~61 min
#                    past the transition. For the first hour it reads correctly, because the absorbed
#                    stamp is still inside the NONEXISTENT hour and Python resolves a gap time through
#                    the pre-transition offset, which is exactly the frame absorption preserved. The
#                    audit said "for the rest of the recording"; the onset is an hour later than that.

import datetime as dt
import os
import time as _time

import pytest

import capture
import status_union
import writers

# Real America/New_York transitions. Spring-forward 2026-03-08: 02:00 EST → 03:00 EDT (01:59 + 90 s of
# real time reads 03:00:30). Fall-back 2026-11-01: 02:00 EDT → 01:00 EST (01:59 + 90 s reads 01:00:30).
SPRING = (dt.datetime(2026, 3, 8, 1, 59, 0), dt.datetime(2026, 3, 8, 3, 0, 30), +3600.0)
FALL = (dt.datetime(2026, 11, 1, 1, 59, 0), dt.datetime(2026, 11, 1, 1, 0, 30), -3600.0)
REAL_ELAPSED_S = 90.0          # actual seconds between the two readings, either way


@pytest.fixture
def zone(monkeypatch):
    """A real DST zone, and a clock we drive. Restores TZ so no other test inherits it."""
    prev = os.environ.get("TZ")
    os.environ["TZ"] = "America/New_York"
    _time.tzset()
    state = {"wall": None, "mono": 1000.0}

    class FakeDatetime(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return state["wall"] if tz is None else state["wall"].astimezone(tz)

    # Only `now` is replaced — timedelta and the real astimezone()/timestamp() stay.
    monkeypatch.setattr(capture, "_dt", type("_d", (), {"datetime": FakeDatetime,
                                                        "timedelta": dt.timedelta}))
    monkeypatch.setattr(capture._time, "monotonic", lambda: state["mono"])
    # Real epoch of the simulated wall clock — what time.time() would return on that box at that
    # instant. The production heartbeat reads this; the union ages against the same value.
    monkeypatch.setattr(capture._time, "time", lambda: state["wall"].astimezone().timestamp())
    monkeypatch.setattr(capture, "_anchor_wall", None)
    monkeypatch.setattr(capture, "_civil_shift", 0.0)
    monkeypatch.setattr(writers, "_open_sample_writers", 1)   # a recording IS open — §A1's precondition
    yield state
    if prev is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = prev
    _time.tzset()


def _drive(state, transition, minutes_after, wedged_for_min=0.0):
    """Anchor before the transition, cross it, run on `minutes_after`, then age the heartbeat exactly
    as status_loop stamps it and status_union reads it. Returns (stamp, civil_shift, health)."""
    before, after, _ = transition
    state["wall"], state["mono"] = before, 1000.0
    capture._now()                                   # anchor in the pre-transition frame
    state["wall"], state["mono"] = after, 1000.0 + REAL_ELAPSED_S
    capture._now()                                   # the transition — absorb branch fires here
    extra = minutes_after * 60.0
    state["wall"] = after + dt.timedelta(seconds=extra)
    state["mono"] = 1000.0 + REAL_ELAPSED_S + extra
    stamp = capture._now()

    # The heartbeat status_loop published on its LAST pass: for a wedged daemon that was
    # `wedged_for_min` ago, so rewind the clock, take the real production stamp, and put the clock
    # back. `capture.heartbeat_ms()` is called, never re-implemented — a copy of the formula in the
    # test would agree with the code no matter which clock the code reads.
    at_publish = state["wall"] - dt.timedelta(minutes=wedged_for_min)
    resume, state["wall"] = state["wall"], at_publish
    hb_ms = capture.heartbeat_ms()
    state["wall"] = resume
    health = status_union.instance_health(
        {"heartbeat_ms": hb_ms},
        now_ms=int(state["wall"].astimezone().timestamp() * 1000),
        stale_after_ms=status_union.STALE_AFTER_MS)
    return stamp, capture._civil_shift, health


def test_a_wedged_daemon_is_never_reported_live_across_fall_back(zone):
    """The dangerous leg. A daemon that stopped publishing 30 minutes ago must read stale — that is the
    'up-but-wedged looks most like health' case status_union exists to catch."""
    for minutes in (1, 61, 120, 300):
        _, shift, health = _drive(zone, FALL, minutes, wedged_for_min=30)
        assert health["state"] == "stale", (
            f"{minutes} min past fall-back: a 30-min-dead daemon read {health} — an absorbed "
            f"civil shift of {shift:+.0f}s put its heartbeat in the future and max(0, …) clamped the age")


def test_a_healthy_daemon_is_never_reported_stale_across_spring_forward(zone):
    """The false-alarm leg. `degraded` is True whenever any instance is not live, so a whole night of
    spurious staleness is a whole night of a page that says something is wrong when nothing is."""
    for minutes in (1, 61, 120, 300):
        _, shift, health = _drive(zone, SPRING, minutes)
        assert health["state"] == "live", (
            f"{minutes} min past spring-forward: a live daemon read {health} with shift {shift:+.0f}s")


def test_liveness_survives_the_transition_in_both_directions_and_still_ages(zone):
    """The heartbeat must not become unfalsifiable in the other direction: it still has to go stale
    when the daemon genuinely stops. Pins both verdicts under one transition each."""
    for transition, label in ((SPRING, "spring-forward"), (FALL, "fall-back")):
        _, _, healthy = _drive(zone, transition, 120)
        _, _, dead = _drive(zone, transition, 120, wedged_for_min=45)
        assert healthy["state"] == "live", f"{label}: a publishing daemon must read live"
        assert dead["state"] == "stale", f"{label}: a 45-min-dead daemon must read stale"
        assert dead["age_ms"] >= 45 * 60 * 1000 - 1000, (
            f"{label}: the age an operator acts on must be the real one, got {dead['age_ms']}")


def test_the_absorb_branch_still_protects_an_open_recording(zone):
    """The fix must not disturb what §A1 is for. Across the transition the RECORDING's stamps stay in
    the session's original offset frame and advance by real elapsed time only — the heartbeat's clock
    is a separate question from the sample stamps' clock, and that is the whole point."""
    for (before, after, expected_shift), label in ((SPRING, "spring-forward"), (FALL, "fall-back")):
        capture._anchor_wall, capture._civil_shift = None, 0.0   # a fresh session per transition:
        # without this the March anchor survives into November and _now() sees an 8-month "step".
        zone["wall"], zone["mono"] = before, 1000.0
        t0 = capture._now()
        zone["wall"], zone["mono"] = after, 1000.0 + REAL_ELAPSED_S
        t1 = capture._now()
        assert capture._civil_shift == pytest.approx(expected_shift), (
            f"{label}: the relabelling must be absorbed, not applied")
        assert (t1 - t0).total_seconds() == pytest.approx(REAL_ELAPSED_S), (
            f"{label}: stamps must advance by real elapsed time, not by the wall-clock jump")
        assert t1 > t0, f"{label}: an open recording's stamps must never rewind"
