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
