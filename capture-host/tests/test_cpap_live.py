# tepna-capture — tests/test_cpap_live.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`cpap_live` — is therapy running now, and has it ended long enough to harvest?

Both answers come from the shadow detector's `fg_state`, and both have the same trap: `therapy` is
None (not False) whenever the detector cannot see the machine — which is the COMMON case, since the
poll defers for the whole of a live stream."""

import cpap_live as L

MIN = 60_000


# ── freshness: the age is a fact, not an assumption ─────────────────────────────────────────────

def test_the_stale_threshold_is_DERIVED_from_the_detector_poll_interval():
    """Not a felt number: three consecutive missed polls, so "unknown" means "older than the
    mechanism's own promise". Move the poll interval and the threshold moves with it."""
    assert L.stale_after_s(30.0) == 90.0
    assert L.stale_after_s(10.0) == 30.0
    assert L.stale_after_s(30.0, multiple=2) == 60.0
    # a nonsensical interval falls back rather than producing a zero/negative window
    for bad in (0, -5, None, "x"):
        assert L.stale_after_s(bad) == 90.0


def test_age_is_computed_from_ONE_clock_domain_and_never_reads_from_the_future():
    """Both operands are the box's own clock; a browser aging a foreign stamp subtracts two clocks.
    A clock step between publish and serve yields 0, not a negative duration."""
    assert L.detector_age_s(100_000, 40_000) == 60.0
    assert L.detector_age_s(100_000, 140_000) == 0.0     # stamp from the "future" -> 0, not -40
    assert L.detector_age_s(100_000, None) is None
    assert L.detector_age_s(None, 40_000) is None
    assert L.detector_age_s(100_000, "nope") is None


def test_a_FRESH_reading_reports_the_state_and_its_age():
    v = L.live_view({"fg_state": "Therapy", "therapy": True, "detector_host_ms": 100_000}, 130_000, 30.0)
    assert v["state"] == "Therapy" and v["therapy"] is True
    assert v["age_s"] == 30.0 and v["fresh"] is True
    assert v["stale_after_s"] == 90.0


def test_a_STALE_reading_degrades_to_unknown_and_STILL_reports_its_age():
    """🔴 The anti-fabrication requirement. A reading older than the detector's promise is not
    evidence about NOW, so the state is "unknown" — not the last value frozen in place. And the age is
    returned either way, so the page shows freshness as a fact the reader sees rather than an
    assumption the layout implies."""
    v = L.live_view({"fg_state": "Therapy", "therapy": True, "detector_host_ms": 0}, 200_000, 30.0)
    assert v["state"] == "unknown", "a 200 s old reading was reported as current"
    assert v["therapy"] is None, "a stale True must not survive as True"
    assert v["age_s"] == 200.0, "the age must be reported even when stale"
    assert v["fresh"] is False


def test_an_UNREACHABLE_detector_is_unknown_not_standby():
    """§2.6: `therapy` is None when the machine cannot be seen, and None must never render as "not in
    therapy". The stream deferral makes this the common case, not an edge one."""
    v = L.live_view({"fg_state": None, "therapy": None, "detector_host_ms": 100_000}, 110_000, 30.0)
    assert v["state"] == "unknown" and v["therapy"] is None
    assert v["age_s"] == 10.0, "the reading is recent even though its content is 'cannot see'"


def test_standby_is_reported_as_standby_when_fresh():
    v = L.live_view({"fg_state": "Standby", "therapy": False, "detector_host_ms": 100_000}, 110_000, 30.0)
    assert v["state"] == "Standby" and v["therapy"] is False and v["fresh"] is True


def test_a_missing_or_malformed_cpap_block_is_unknown_not_a_crash():
    for c in (None, {}, "not a dict", {"therapy": True}):
        v = L.live_view(c, 100_000, 30.0)
        assert v["state"] == "unknown" and v["age_s"] is None and v["fresh"] is False


# ── the therapy-end trigger ─────────────────────────────────────────────────────────────────────

def test_None_IS_NOT_AN_END_and_cannot_start_the_clock():
    """🔴 THE DEFECT THIS GUARDS. The detector defers for the whole of a live stream, so `therapy` is
    None throughout. If None started the end clock, a harvest would fire in the MIDDLE of therapy —
    a 2.4 GHz transfer beside a sleeping body, the exact contention the daily window exists to avoid."""
    w = L.observe(L.EndWatch(), True, 0)              # in therapy
    for t in range(1, 40):                            # ...then 39 unreachable polls
        w = L.observe(w, None, t * MIN)
    assert w.ended_at_ms is None, "ignorance started the end clock"
    assert L.harvest_due(w, 40 * MIN)[0] is False


def test_None_DOES_NOT_CANCEL_an_end_clock_already_running():
    """The mirror case: once a real `therapy=False` has started the clock, going unreachable must not
    reset it, or a detector that drops out mid-debounce would postpone the harvest forever."""
    w = L.observe(L.observe(L.EndWatch(), True, 0), False, MIN)
    started = w.ended_at_ms
    w = L.observe(w, None, 3 * MIN)
    assert w.ended_at_ms == started
    assert L.harvest_due(w, 12 * MIN, debounce_s=600)[0] is True


def test_the_MASK_OFF_FLAP_does_not_fire_a_harvest():
    """The machine drops to standby and returns as the mask is refitted. An edge-trigger would already
    have harvested; the debounce is what makes the trigger safe at all."""
    w = L.observe(L.EndWatch(), True, 0)
    w = L.observe(w, False, 1 * MIN)                  # mask off
    assert L.harvest_due(w, 3 * MIN, debounce_s=600)[0] is False, "fired inside the debounce"
    w = L.observe(w, True, 4 * MIN)                   # back on
    assert w.ended_at_ms is None, "a resumed therapy did not cancel the pending end"
    assert L.harvest_due(w, 30 * MIN, debounce_s=600)[0] is False


def test_a_REAL_end_fires_once_the_debounce_holds_and_only_ONCE():
    w = L.observe(L.EndWatch(), True, 0)
    w = L.observe(w, False, 10 * MIN)
    due, why = L.harvest_due(w, 21 * MIN, debounce_s=600)
    assert due is True and "held for" in why
    w.fired_for = w.ended_at_ms                       # the caller records the fire
    assert L.harvest_due(w, 30 * MIN, debounce_s=600)[0] is False, "re-fired on the next poll"


def test_a_NEW_therapy_period_re_arms_the_trigger_after_a_previous_fire():
    w = L.EndWatch(seen_therapy=True, ended_at_ms=1000, fired_for=1000)
    w = L.observe(w, True, 2 * MIN)                   # a second session starts
    w = L.observe(w, False, 20 * MIN)                 # and ends
    assert w.ended_at_ms == 20 * MIN
    assert L.harvest_due(w, 31 * MIN, debounce_s=600)[0] is True


def test_a_box_that_BOOTS_INTO_STANDBY_has_not_ended_anything():
    """Without this, every restart outside a session would look like a therapy end and harvest."""
    w = L.EndWatch()
    for t in range(10):
        w = L.observe(w, False, t * MIN)
    assert w.ended_at_ms is None and L.harvest_due(w, 20 * MIN)[0] is False


def test_harvest_due_refuses_rather_than_guesses_on_unusable_stamps():
    w = L.EndWatch(seen_therapy=True, ended_at_ms="bad")
    due, why = L.harvest_due(w, 100)
    assert due is False and "unusable" in why
    assert L.harvest_due(L.EndWatch(), 100)[1] == "no therapy end observed"


def test_a_CONTINUING_non_therapy_run_keeps_its_original_start_not_the_latest_reading():
    """Kills the "restart the clock on every False" reading of `observe`. Each subsequent standby poll
    must leave `ended_at_ms` alone — otherwise the debounce never elapses, because the clock resets
    every 30 s and the harvest that this trigger exists to schedule would never fire at all."""
    w = L.observe(L.observe(L.EndWatch(), True, 0), False, 5 * MIN)
    assert w.ended_at_ms == 5 * MIN
    for t in (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16):
        w = L.observe(w, False, t * MIN)
        assert w.ended_at_ms == 5 * MIN, f"the end clock restarted at minute {t}"
    assert L.harvest_due(w, 16 * MIN, debounce_s=600)[0] is True
