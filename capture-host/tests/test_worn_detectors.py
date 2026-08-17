# tepna-capture — tests/test_worn_detectors.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THREE worn detectors and one combiner, because ONE detector with ONE calibration domain left the
rate this box actually runs with no verdict at all — and, worse, no way to tell.

WHY IT EXISTS. `optical_worn` thresholds the ambient LEVEL and correctly refuses outside 55 Hz
(#1171). The box then moved to 176 Hz, so the refusal fired on every negotiation and the detector
went permanently silent. Silence was not the damage. `_set` only ever UPDATES, so the caller's
`if _worn is not None:` left the LAST verdict standing: measured 2026-08-13, the card read
`worn: True` for TEN HOURS while the armband streamed 496 MB into a desk, and the not-worn power drop
— armed at 180 s — could never fire because nothing ever said False.

THE PEGGING INVERTS BETWEEN THE TWO RATES, which is why this is two detectors and not one widened
threshold:

     55 Hz   worn = DARK (|median| ~1e2)    unworn = pegged bright ~3e5, and pegged is QUIET
    176 Hz   worn = PEGGED ~6.5e5 and QUIET unworn = unpegged room light, and that is NOISY

Measured 2026-08-13 over 90 windows of 30 s from 15 real 176 Hz Verity files: ambient SD 32.0–36.7
worn (n=54) against 141.4–30 399.3 desk (n=36). A clean 3.9x gap; the threshold is its geometric
midpoint (72.1 → 72), the same rule that produced the 5000.

⚠️ A THIRD DETECTOR — CARDIAC-BAND POWER — WAS TRIED AND REFUTED. It is the attractive idea
(periodicity is rate-independent, and unlike amplitude it does not conflate "not worn" with "worn
badly"), and on two hand-picked windows it showed a 94x separation. Over 474 corpus windows at 55 Hz,
468 fall in the overlap: worn median 0.026 against unworn 0.013, and the unworn MAXIMUM (1.088)
exceeds the worn maximum (0.882). Even at 176 Hz worn reaches 0.00089 while desk reaches 0.02234.
Do not re-derive it. The refutation is recorded here so the next person spends no corpus time on it.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import telemetry  # noqa: E402

WORN_SD = [1000.0 + (i % 3) * 8.0 for i in range(400)]        # SD ~3.3 — deep under 72
DESK_SD = [1000.0 + (i % 7) * 900.0 for i in range(400)]      # SD ~2200 — far above 72


# ── sd_calibrated_for ───────────────────────────────────────────────────────────────────────────────

def test_an_unknown_rate_is_OUT_of_domain_here_unlike_the_level_detector():
    """The asymmetry is the point and it is deliberate. `calibrated_for` admits `None` because callers
    older than that parameter would otherwise lose worn detection entirely; this detector has no such
    callers, so admitting an unknown rate could only ever run it where it was never measured."""
    assert telemetry.sd_calibrated_for(None) is False
    assert telemetry.calibrated_for(None) is True, "the level detector's concession must not change"


def test_the_calibrated_rate_is_in_domain_and_a_neighbouring_rate_is_not():
    assert telemetry.sd_calibrated_for(176.0) is True
    assert telemetry.sd_calibrated_for(55.0) is False, "55 Hz is the LEVEL detector's domain, not this one"
    assert telemetry.sd_calibrated_for(135.0) is False


def test_the_tolerance_is_inclusive_at_its_edge_and_excludes_just_past_it():
    """Files measure 175.4–176.6, so the tolerance is a measurement wobble, not a rate menu."""
    assert telemetry.sd_calibrated_for(176.0 - telemetry._WORN_SD_FS_TOL_HZ) is True
    assert telemetry.sd_calibrated_for(176.0 + telemetry._WORN_SD_FS_TOL_HZ) is True
    assert telemetry.sd_calibrated_for(176.0 + telemetry._WORN_SD_FS_TOL_HZ + 0.01) is False


# ── ambient_stability_worn ──────────────────────────────────────────────────────────────────────────

def test_a_still_ambient_channel_reads_worn_and_a_noisy_one_reads_not_worn():
    assert telemetry.ambient_stability_worn(WORN_SD, fs=176.0) is True
    assert telemetry.ambient_stability_worn(DESK_SD, fs=176.0) is False


def test_it_REFUSES_rather_than_guesses_outside_its_domain():
    """`None` is not `False`. False drops the link for power; None changes nothing."""
    assert telemetry.ambient_stability_worn(WORN_SD, fs=55.0) is None
    assert telemetry.ambient_stability_worn(WORN_SD, fs=None) is None


def test_too_few_samples_is_no_verdict_not_a_verdict_of_not_worn():
    """A stream that has just opened must not be dropped for having said little."""
    assert telemetry.ambient_stability_worn(WORN_SD[:10], fs=176.0) is None
    assert telemetry.ambient_stability_worn([], fs=176.0) is None


def test_EXACTLY_min_samples_is_ENOUGH_and_one_fewer_is_not():
    """The guard is `< min_samples`, so exactly `min_samples` IS a measurement. Both edges asserted,
    because a test that only feeds 400 samples proves the guard exists and says nothing about where
    it sits — `<` and `<=` are then indistinguishable, and mutating one to the other survives the
    whole suite. Found by the diff-scoped mutation gate on this very branch."""
    n = telemetry._WORN_SD_MIN_SAMPLES
    at_the_edge = [1000.0 + (i % 3) * 8.0 for i in range(n)]
    assert telemetry.ambient_stability_worn(at_the_edge, fs=176.0) is True, (
        f"exactly {n} samples must yield a verdict — the guard refuses FEWER than min_samples")
    assert telemetry.ambient_stability_worn(at_the_edge[:-1], fs=176.0) is None, (
        f"{n - 1} samples must not, or the boundary is off by one in the other direction")


def test_the_FLOOR_of_two_is_the_binding_term_when_a_caller_asks_for_less():
    """`max(2, min_samples)` — two is the floor because a "spread" of one sample is not a spread. A
    caller passing `min_samples=2` must therefore get a verdict from exactly two samples; if the floor
    were 3 it would not. Nothing else in this file distinguishes those, since the default 256 makes
    `max(2, 256)` and `max(3, 256)` the same number."""
    assert telemetry.ambient_stability_worn([1000.0, 1000.0], fs=176.0, min_samples=2) is True
    assert telemetry.ambient_stability_worn([1000.0], fs=176.0, min_samples=1) is None, (
        "one sample can never be a spread, whatever the caller asks for")


def test_None_and_NaN_samples_are_dropped_rather_than_poisoning_the_spread():
    dirty = ([None] * 5) + [float("nan")] * 5 + WORN_SD
    assert telemetry.ambient_stability_worn(dirty, fs=176.0) is True


def test_the_threshold_is_measured_and_the_boundary_is_STRICTLY_below():
    """Pins the constant against silent drift, and the comparison against an off-by-one flip. A value
    exactly AT the threshold is not 'under skin' — the gap it sits in is empty, so the edge is free."""
    assert telemetry._WORN_AMBIENT_SD_MAX == 72.0
    n = telemetry._WORN_SD_MIN_SAMPLES * 2
    at = [0.0 if i % 2 else 144.0 for i in range(n)]          # population SD exactly 72.0
    assert telemetry.ambient_stability_worn(at, fs=176.0) is False
    just_under = [0.0 if i % 2 else 143.9 for i in range(n)]
    assert telemetry.ambient_stability_worn(just_under, fs=176.0) is True


def test_it_uses_the_SPREAD_and_not_the_LEVEL_which_is_the_whole_reason_it_exists():
    """The canary. At 176 Hz a WORN armband's ambient pegs at ~650 000 — squarely inside the 55 Hz
    'unworn' cluster — so any implementation that looked at the magnitude would call it not worn. An
    implementation returning a constant, or reading the level, fails here and passes little else."""
    pegged_and_still = [-650_749.0 + (i % 3) * 8.0 for i in range(400)]
    assert telemetry.ambient_stability_worn(pegged_and_still, fs=176.0) is True
    assert telemetry.optical_worn(pegged_and_still, fs=55.0) is False, (
        "the LEVEL detector calls this same worn armband not-worn — the two regimes are opposite, "
        "which is why both detectors exist")


# ── worn_verdict — the combiner ─────────────────────────────────────────────────────────────────────

def test_no_available_detector_yields_None_and_SAYS_SO():
    verdict, why = telemetry.worn_verdict()
    assert verdict is None
    assert "rate unknown" in why


def test_an_out_of_domain_rate_names_the_rate_so_the_operator_can_act():
    verdict, why = telemetry.worn_verdict(ambient=WORN_SD, fs=135.0)
    assert verdict is None
    assert "135 Hz" in why


def test_each_optical_detector_carries_its_own_rate_and_is_named_in_the_reason():
    v176, why176 = telemetry.worn_verdict(ambient=WORN_SD, fs=176.0)
    assert (v176, "ambient-stability" in why176) == (True, True)
    v55, why55 = telemetry.worn_verdict(ambient=[140.0] * 400, fs=55.0)
    assert (v55, "ambient-level" in why55) == (True, True)


def test_the_device_s_own_contact_bit_votes_and_needs_no_ambient_at_all():
    """PPI contact is a measurement rather than an inference — desk 0/31877, worn 1/20957 on this
    hardware. It is unavailable exactly when SDK mode is on, which is what made the rest necessary."""
    assert telemetry.worn_verdict(ppi_flags=0x06)[0] is True
    assert telemetry.worn_verdict(ppi_flags=0x04)[0] is False
    assert telemetry.worn_verdict(ppi_flags=0x02)[0] is None, "unsupported bit reads 0 — not a verdict"


def test_WORN_WINS_a_disagreement_because_the_two_errors_do_not_cost_the_same():
    """A false NOT-WORN drops a live link mid-night and costs a recording; a false WORN costs a
    charge. So any single 'worn' vote carries. Today the optical domains are disjoint and cannot
    disagree — this pins the rule for the moment a rate calibrates both."""
    verdict, why = telemetry.worn_verdict(ppi_flags=0x06, ambient=DESK_SD, fs=176.0)
    assert verdict is True
    assert "ppi-contact" in why


def test_NOT_WORN_needs_every_opinion_to_agree():
    verdict, why = telemetry.worn_verdict(ppi_flags=0x04, ambient=DESK_SD, fs=176.0)
    assert verdict is False
    assert "ppi-contact" in why and "ambient-stability" in why


def test_an_abstaining_detector_does_not_veto_one_that_can_still_speak():
    """Ambient out of domain plus a live contact bit must still produce a verdict, not None."""
    verdict, why = telemetry.worn_verdict(ppi_flags=0x06, ambient=WORN_SD, fs=135.0)
    assert verdict is True
    assert "ambient" not in why


# ── CHARGING AT FULL — the hole the rising rule cannot reach ────────────────────────────────────────

def test_a_FULL_battery_that_has_not_moved_for_45_min_is_on_a_charger():
    """`capture._read_batt` infers charging from a RISING battery, which is unambiguous and works
    everywhere it can fire. It cannot fire at 100 %: a full cell has nowhere to rise to. Measured
    2026-08-14 — the Verity streamed 80 min at 176 Hz with `battery` pinned at 100 and `charging`
    False throughout, so nothing downstream could tell a dock from a wrist.

    Streaming drains this hardware ~9 %/h (2026-08-10: 100 → 74 % in 3 h at 55 Hz, and 176 Hz costs
    more), so 45 min at full with no movement is ~7 points that did not happen."""
    assert telemetry.full_battery_implies_charging(100, telemetry._BATT_FLAT_CHARGING_S) is True
    assert telemetry.full_battery_implies_charging(100, telemetry._BATT_FLAT_CHARGING_S + 600) is True


def test_a_SHORT_flat_stretch_claims_NOTHING_rather_than_claiming_discharge():
    """Never False. Ten minutes of a steady reading has not proved the device is draining, and
    inventing that verdict would be the mirror of the bug being fixed."""
    assert telemetry.full_battery_implies_charging(100, 600) is None
    assert telemetry.full_battery_implies_charging(100, telemetry._BATT_FLAT_CHARGING_S - 1) is None


def test_it_claims_nothing_BELOW_full_because_the_rising_rule_owns_that_range():
    """Deliberately narrow. Flatness lower down is weak — a slow drain and a coarse reporting step look
    identical — and it does not need to work there: a battery below 100 that goes on charge RISES, and
    the existing rule catches it (measured 2026-07-19, Verity 35 → 61 %)."""
    assert telemetry.full_battery_implies_charging(99, 7200) is None
    assert telemetry.full_battery_implies_charging(35, 86400) is None


def test_junk_readings_are_refused_not_coerced():
    assert telemetry.full_battery_implies_charging(None, 9999) is None
    assert telemetry.full_battery_implies_charging(100, None) is None
    assert telemetry.full_battery_implies_charging("full", 9999) is None
    assert telemetry.full_battery_implies_charging(100, "ages") is None


def test_CHARGING_OVERRULES_a_contact_bit_that_says_worn():
    """⚠️ THE ONE INVERSION OF THE ASYMMETRY, and the reason is that the expensive error is not
    available here. Everywhere else "worn wins" because a false not-worn drops a live link and costs a
    night. A device in a dock is not on a wrist, so that error cannot be made — and on 2026-08-14 the
    contact bit said `worn` for 80 minutes while the strap sat on a charger."""
    verdict, why = telemetry.worn_verdict(ppi_flags=0x06, charging=True)
    assert verdict is False
    assert "charger" in why
    # …and with charging absent or false, the contact bit keeps the decision exactly as before.
    assert telemetry.worn_verdict(ppi_flags=0x06, charging=False)[0] is True
    assert telemetry.worn_verdict(ppi_flags=0x06)[0] is True


def test_charging_decides_even_when_no_other_detector_has_an_opinion():
    """It must not need a quorum: on the charger there may be no ambient window and no contact bit."""
    assert telemetry.worn_verdict(charging=True)[0] is False


# ── pulse prominence — the detector a dock cannot fool ──────────────────────────────────────────────
def _pulse(n=telemetry._PULSE_MIN_SAMPLES, fs=176.0, hz=1.0, amp=100.0, noise=5.0, seed=7):
    import math
    import random
    r = random.Random(seed)
    return [amp * math.sin(2 * math.pi * hz * i / fs) + r.gauss(0, noise) for i in range(n)]


def _noise(n=telemetry._PULSE_MIN_SAMPLES, sd=100.0, seed=11):
    import random
    r = random.Random(seed)
    return [r.gauss(0, sd) for _ in range(n)]


def test_a_clean_pulse_is_worn():
    assert telemetry.pulse_prominence_worn(_pulse(), fs=176.0) is True


def test_pure_noise_is_not_worn():
    assert telemetry.pulse_prominence_worn(_noise(), fs=176.0) is False


def test_prominence_separates_the_two_by_orders_of_magnitude():
    """The threshold is the geometric midpoint of measured populations; this pins the gap it sits in."""
    p = telemetry.pulse_prominence(_pulse(), fs=176.0)
    q = telemetry.pulse_prominence(_noise(), fs=176.0)
    assert p > 100 * q


def test_an_unknown_rate_is_out_of_domain():
    assert telemetry.pulse_prominence_worn(_pulse(), fs=None) is None


def test_below_nyquist_for_the_reference_band_is_refused():
    """Under ~30 Hz the 6-12 Hz reference band folds, so the ratio would compare a band to its own alias."""
    assert telemetry.pulse_prominence_worn(_pulse(), fs=20.0) is None


def test_too_few_samples_is_no_claim():
    assert telemetry.pulse_prominence_worn(_pulse(n=100), fs=176.0) is None


def test_a_flat_signal_yields_no_claim_rather_than_a_division_by_zero():
    assert telemetry.pulse_prominence([5.0] * telemetry._PULSE_MIN_SAMPLES, fs=176.0) is None
    assert telemetry.pulse_prominence_worn([5.0] * telemetry._PULSE_MIN_SAMPLES, fs=176.0) is None


def test_nones_and_nans_are_dropped_not_counted():
    vals = _pulse(n=telemetry._PULSE_MIN_SAMPLES) + [None, float("nan")]
    assert telemetry.pulse_prominence_worn(vals, fs=176.0) is True


def test_it_works_at_BOTH_measured_rates_which_is_why_it_has_no_rate_menu():
    """`sd_calibrated_for` pins ambient-stability to 176 Hz. This detector is rate-independent by
    construction and was measured at 55 and 176 Hz, so an exact-rate gate would reject data it handles."""
    assert telemetry.pulse_prominence_worn(_pulse(fs=55.0, hz=0.9), fs=55.0) is True
    assert telemetry.pulse_prominence_worn(_pulse(fs=176.0, hz=0.9), fs=176.0) is True


# ── the override, and its limit ─────────────────────────────────────────────────────────────────────
def test_a_pulse_OVERRULES_the_ambient_proxies():
    """A dock gives stable ambient (proxy says worn) and no pulse (direct measurement says not).
    The direct one wins — this is the case that streamed noise for 30 min on 2026-08-15."""
    v, why = telemetry.worn_verdict(ambient=WORN_SD, fs=176.0, ppg=_noise())
    assert v is False, why
    assert "pulse-prominence" in why and "ambient" not in why


def test_but_it_may_NOT_overrule_a_contact_bit():
    """A cold, poorly-perfused wrist can genuinely show no pulse, and a false not-worn costs a night.
    `worn_optical` does not own the drop; the contact bit does."""
    v, why = telemetry.worn_verdict(contact=True, ambient=WORN_SD, fs=176.0, ppg=_noise())
    assert v is True, why


def test_without_ppg_the_ambient_votes_stand_unchanged():
    before = telemetry.worn_verdict(ambient=WORN_SD, fs=176.0)
    after = telemetry.worn_verdict(ambient=WORN_SD, fs=176.0, ppg=None)
    assert before == after


def test_an_out_of_domain_pulse_vote_leaves_the_ambient_votes_alone():
    """Abstention must not silently delete the votes it was going to replace."""
    v, why = telemetry.worn_verdict(ambient=WORN_SD, fs=176.0, ppg=_pulse(n=100))
    assert "ambient" in why


# ─── §4.2 evidence-source independence ──────────────────────────────────────────────────────────

def test_every_detector_name_the_combiner_can_emit_is_mapped_to_a_source():
    """THE test that will actually fire. An unmapped detector silently counts as its OWN source, which
    OVER-states independence — the wrong direction. This pins the map to the combiner: add a detector
    without a source and CI says so, rather than an operator reading a reason string that implies two
    pieces of evidence where there is one."""
    import re
    src = open(telemetry.__file__, encoding="utf-8").read()
    body = src[src.index("def worn_verdict("):]
    body = body[: body.index("\ndef ", 1)]
    emitted = set(re.findall(r'votes\.append\(\("([a-z-]+)"', body))
    assert emitted, "the combiner appends no named votes — the scrape is wrong, not the code"
    unmapped = emitted - set(telemetry._WORN_SOURCE)
    assert not unmapped, f"detectors with no evidence source: {sorted(unmapped)}"


def test_detectors_sharing_a_signal_count_as_ONE_source():
    """`ambient-level` and `ambient-stability` are two statistics of one series; `hr-contact-bit` and
    `ppi-contact` are two characteristics of one physical sensor. Agreement between them is not
    corroboration (INTERDISCIPLINARY-LITERATURE-DIAGNOSIS §4.2)."""
    assert telemetry.independent_sources(["ambient-level", "ambient-stability"]) == ["optical-ambient"]
    assert telemetry.independent_sources(["hr-contact-bit", "ppi-contact"]) == ["device-contact"]
    assert telemetry.independent_sources(["ppi-contact", "ambient-level"]) == ["device-contact", "optical-ambient"]
    assert telemetry.independent_sources([]) == []


def test_an_unknown_detector_becomes_its_own_source_rather_than_vanishing():
    """Fails toward over-counting independence, which is why the mapping test above exists — but it must
    not silently DROP an unknown name, or the count would under-state the evidence instead."""
    assert telemetry.independent_sources(["ambient-level", "brand-new"]) == ["brand-new", "optical-ambient"]


def test_the_reason_string_is_unchanged_when_there_is_nothing_to_disambiguate():
    """The common case is one detector. Appending a qualifier there would be noise, and every existing
    consumer of `worn_why` reads that wording."""
    v, why = telemetry.worn_verdict(contact=True)
    assert (v, why) == (True, "worn per hr-contact-bit")


def test_correlated_agreement_is_REPORTED_as_one_source_when_it_occurs():
    """⚠️ NOT REACHABLE FROM PRODUCTION TODAY — capture.py's two call sites are disjoint (one passes
    ppi_flags/ambient/ppg, the other passes contact), so these two never vote together. That makes the
    current safety an ACCIDENT OF CALL-SITE SEPARATION rather than a property. This pins the behaviour
    for the day someone passes both."""
    sup, con = telemetry._PPI_CONTACT_SUPPORTED, telemetry._PPI_CONTACT
    v, why = telemetry.worn_verdict(contact=True, ppi_flags=sup | con)
    assert v is True
    assert "hr-contact-bit, ppi-contact" in why
    assert "1 independent source(s): device-contact" in why
