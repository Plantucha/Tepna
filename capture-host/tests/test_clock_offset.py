# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""`clock_offset` — offset and skew from one-sided delay measurements.

The estimators are published ones (Moon et al.'s LP, Paxson's minimum-of-subsets), so these tests are
about the two things a paper does not give you: that the implementation actually recovers a PLANTED
answer, and that the certificate refuses the cases where each estimator is known to break.
"""
from __future__ import annotations

import random

import clock_offset as co
import pytest
from writers import PmdArrivalLogWriter


def _plant(off_ms, ppm, n=4000, span=28800.0, jitter_ms=30.0, quant_ms=None, seed=7, outlier=None):
    """A one-sided delay cloud around a known line, exactly as the physics produces it.

    The noise is EXPONENTIAL, never symmetric: a packet can be late and cannot be early, and an
    estimator tuned against symmetric noise would look fine here and fail on the real thing.
    """
    rng = random.Random(seed)
    pts = []
    for i in range(n):
        t = span * i / (n - 1)
        d = off_ms + ppm * 1e-6 * 1000.0 * t + rng.expovariate(1.0 / jitter_ms)
        if quant_ms:                      # a whole-second device counter: reported <= true, so delay >= true
            d += (quant_ms - (t * 1000.0) % quant_ms) % quant_ms
        pts.append((t, d))
    if outlier is not None:
        pts[n // 3] = (pts[n // 3][0], outlier)
    return pts


def _truth(off_ms, ppm, pts):
    """The planted line evaluated where the estimator quotes it — the centroid of t."""
    return off_ms + ppm * 1e-6 * 1000.0 * (sum(t for t, _ in pts) / len(pts))


# ─── recovery: the planted answer comes back ────────────────────────────────────────────────────

def test_recovers_a_planted_offset_and_skew():
    pts = _plant(400.0, 20.0)
    r = co.estimate(pts)
    assert r["ok"] and r["certified"]
    assert r["slope_ppm"] == pytest.approx(20.0, abs=0.1)
    assert r["offset_ms"] == pytest.approx(_truth(400.0, 20.0, pts), abs=1.0)


def test_offset_is_quoted_at_the_centroid_not_at_zero():
    """A centroid value read as a t=0 offset is wrong by the whole span's drift — 288 ms here.

    So `t_ref_sec` must ship alongside it. This is the field that stops a consumer reconstructing the
    wrong line, and it is exactly the misreading the module's own first cut invited.
    """
    pts = _plant(400.0, 20.0)
    r = co.estimate(pts)
    assert r["t_ref_sec"] == pytest.approx(14400.0, abs=60.0)
    assert r["offset_ms"] == pytest.approx(688.0, abs=1.0)      # 400 + 20 ppm * 14400 s
    assert r["offset_ms"] - 400.0 > 250.0, "the drift term must not have been silently dropped"


def test_recovers_the_offset_through_a_one_second_quantised_counter():
    """THE RING CASE, and the reason this module exists.

    `PAT-PACKET-ARRIVAL` §6 says the ring's offset "must be FITTED, not min-filtered" because a minimum
    over a quantised counter returns the quantum. Quantisation is one-sided POSITIVE just like
    buffering, so the lower envelope is that fit and needs no ring-specific code path.
    """
    pts = _plant(250.0, 40.0, quant_ms=1000.0, jitter_ms=5.0)
    r = co.estimate(pts)
    assert r["ok"] and r["certified"]
    assert r["offset_ms"] == pytest.approx(_truth(250.0, 40.0, pts), abs=10.0)
    assert r["slope_ppm"] == pytest.approx(40.0, abs=0.5)


def test_the_quantum_alone_does_not_contaminate_a_minimum():
    """⚠️ PINS A CORRECTION TO `PAT-PACKET-ARRIVAL` §6, which said the ring must be fitted because "a
    minimum over a quantised counter returns the quantum". IT DOES NOT.

    Quantisation shifts each delay up by a residual that depends on where the frame lands between ticks,
    and across a recording that residual comes near enough to 0 that the minimum still finds the edge.
    Measured over 270 zero-skew configurations (n, span and jitter varied, non-degenerate phase), the
    WORST error was 31.5 ms — 3.2% of the 1000 ms quantum, not the quantum. So quantisation is not the
    reason to fit, and this test exists so nobody restores that reasoning.
    """
    pts = _plant(250.0, 0.0, quant_ms=1000.0, jitter_ms=5.0)
    est, _ = PmdArrivalLogWriter.floor_ms([d for _, d in pts])
    assert est - 250.0 < 100.0, f"a quantum-sized error would be ~1000 ms; got {est - 250.0:.1f}"


def test_the_real_reason_to_fit_the_ring_is_skew_not_quantisation():
    """`PAT-PACKET-ARRIVAL` §6 measures the ring's counter at 1-55 ppm against the host. Over an 8 h
    night 55 ppm is 1.6 s of drift, so a single flat number is wrong by roughly half of it whatever
    the quantisation does — measured here at -705 ms, against PAT's 10 ms budget."""
    pts = _plant(250.0, 55.0, quant_ms=1000.0, jitter_ms=5.0)
    tr = _truth(250.0, 55.0, pts)
    flat, _ = PmdArrivalLogWriter.floor_ms([d for _, d in pts])
    assert abs(flat - tr) > 500.0, f"a flat estimate should be far out on a 55 ppm night, got {flat}"
    assert co.estimate(pts)["offset_ms"] == pytest.approx(tr, abs=10.0)


# ─── the certificate: it exists because each estimator breaks somewhere ──────────────────────────

def test_one_early_outlier_drags_the_envelope_and_the_certificate_catches_it():
    """The envelope constrains the line below EVERY point, so a single early packet redefines it.

    Paxson's median-of-minima does not move. That disagreement is the whole reason both are computed,
    and `offset_ms` must come back None rather than handing over the dragged number.
    """
    pts = _plant(400.0, 20.0, outlier=-500.0)
    tr = _truth(400.0, 20.0, pts)
    r = co.estimate(pts)
    assert r["ok"] is True, "an outlier is a bad estimate, not a bad input"
    assert r["certified"] is False
    assert r["offset_ms"] is None, "an uncertified night must not publish a plausible-looking float"
    assert abs(r["offset_envelope_ms"] - tr) > 100.0, "the envelope should have been dragged"
    assert abs(r["offset_paxson_ms"] - tr) < 10.0, "Paxson should have held"


def test_both_estimators_stay_visible_when_uncertified():
    """Diagnosis needs the pair. Publishing only the certified number would hide WHY it failed."""
    r = co.estimate(_plant(400.0, 20.0, outlier=-500.0))
    assert isinstance(r["offset_envelope_ms"], float) and isinstance(r["offset_paxson_ms"], float)
    assert r["agree_ms"] > co.AGREE_MAX_MS


def test_a_clean_night_is_certified():
    assert co.estimate(_plant(400.0, 20.0))["certified"] is True


# ─── refusals: no estimate, never a silent zero ─────────────────────────────────────────────────

def test_refuses_too_few_points():
    r = co.estimate([(float(i), 1.0) for i in range(co.MIN_POINTS - 1)])
    assert r == {"ok": False, "reason": "too-few", "n": co.MIN_POINTS - 1}
    assert "offset_ms" not in r, "a refusal must not carry a readable offset"


def test_refuses_when_every_point_shares_one_t():
    r = co.estimate([(0.0, float(i)) for i in range(200)])
    assert r["ok"] is False and r["reason"] == "no-span"


def test_refuses_an_implausible_skew():
    """Past 5% these two columns are not the two clocks we think they are — a misparse, a unit
    mismatch, a shifted column. Correcting by that much fabricates a timebase (Clock Contract §7)."""
    r = co.estimate([(t / 10.0, t * 1000.0) for t in range(200)])
    assert r["ok"] is False and r["reason"] == "implausible-skew"
    assert abs(r["slope_ppm"]) > co.MAX_PPM


def test_refuses_when_no_two_subset_minima_have_distinct_t():
    """Paxson can fail while the envelope succeeds: if every subset's minimum lands on the same t
    there is no slope to take a median of. The pair must refuse together, not half-report."""
    pts = [(0.0, 0.0)] * 99 + [(100.0, 1e6)]          # the lone late point is never a subset minimum
    r = co.estimate(pts)
    assert r["ok"] is False and r["reason"] == "no-span"


def test_drops_non_finite_and_unparseable_pairs_rather_than_defaulting():
    """A fabricated 0 here would sit at the bottom of the cloud and silently BECOME the envelope.

    The junk is INTERLEAVED, not appended. With it all at the end, `continue` and `break` behave
    identically and the mutant that stops cleaning at the first bad pair survives — which it did.
    """
    good = _plant(400.0, 0.0, n=200, span=3000.0)
    junk = [(float("nan"), 1.0), (1.0, float("nan")), (float("inf"), 1.0),
            (1.0, float("-inf")), ("x", 1.0), (None, 1.0), (1.0, object())]
    mixed = []
    for i, p in enumerate(good):
        mixed.append(p)
        if i < len(junk):
            mixed.append(junk[i])          # a bad pair between two good ones, seven times over
    r = co.estimate(mixed)
    assert r["n"] == 200, f"junk leaked in, or cleaning stopped early: n={r['n']}"
    assert r["offset_ms"] == pytest.approx(400.0, abs=5.0)


# ─── the boundaries, each pinned with an EXACTLY-on-the-line fixture ─────────────────────────────

def test_span_is_measured_across_the_whole_recording():
    """`pts[-1] - pts[0]`, not an endpoint one sample in, and DIFFERENCED rather than summed.

    The axis is deliberately offset off zero. Every other fixture here starts at t = 0, where
    `pts[-1] - pts[0]` and `pts[-1] + pts[0]` are the same number — so a summed span survived every
    one of them, exactly as a zero-origin hull fixture hid the sign in the turn test. A fixture whose
    origin is 0 cannot see an error in a term multiplied by that origin.

    Pinned exactly: `span_sec` is what `skew_quotable` is decided on, and a near-miss span reads as a
    perfectly good number.
    """
    base = _plant(400.0, 20.0, n=4000, span=28800.0)
    r = co.estimate([(t + 5000.0, d) for t, d in base])
    assert r["span_sec"] == 28800.0
    assert r["t_ref_sec"] == pytest.approx(19400.0, abs=1.0)


def test_the_slope_is_reported_in_ppm_not_a_number_near_it():
    """A 0.1 % error in the ms/s -> ppm conversion is invisible against a loose tolerance, and ppm is
    quoted to two decimals. Planted at 200 ppm so a 0.1 % slip is 0.2 — far outside this bound."""
    r = co.estimate(_plant(400.0, 200.0))
    assert r["slope_ppm"] == pytest.approx(200.0, abs=0.05)


def test_a_skew_of_exactly_max_ppm_is_accepted_not_refused():
    """`MAX_PPM` is an EXCLUSIVE bound: 5 % is the largest rate still believed, not the first refused.

    A perfectly linear 50 ms/s ramp is exactly 50000 ppm, so `>` accepts and `>=` refuses — and a
    silently-shifted bound would make the refusal fire one crystal earlier than documented.
    """
    r = co.estimate([(float(t), 50.0 * t) for t in range(200)])
    assert r["ok"] is True and r["slope_ppm"] == 50000.0


def test_agreement_of_exactly_the_budget_still_certifies():
    """`AGREE_MAX_MS` is INCLUSIVE: agreement AT the budget passes, since the budget is the
    requirement rather than the first failure.

    Constructed to land on it exactly. A flat cloud with one deep point at t=0: Paxson's
    median-of-minima ignores a single outlier among 20 subset minima, so its line is exactly d = 0,
    while the envelope is dragged onto the lone hull edge (0,-20) -> (T,0), whose value at the
    centroid is exactly -10. `agree` is then bit-exactly 10.0 (verified at n = 100, 200 and 400).
    """
    pts = [(0.0, -20.0)] + [(float(t), 0.0) for t in range(1, 200)]
    r = co.estimate(pts)
    assert r["agree_ms"] == 10.0
    assert r["certified"] is True, "agreement exactly at the budget must certify"


# ─── the span gate: the offset still ships, only the RATE is withheld ────────────────────────────

def test_short_span_withholds_the_rate_but_keeps_the_offset():
    """A ppm off too short a baseline is the error the Clock Contract calls out by name — the same H10
    reads -20.3 ppm over 373 min and -65.8 over 10.9. But the offset is what the envelope measured and
    stays usable, so `skew_quotable` is separate from `ok` rather than sinking the whole estimate."""
    r = co.estimate(_plant(400.0, 20.0, n=500, span=600.0))
    assert r["ok"] and r["skew_quotable"] is False
    assert r["offset_ms"] == pytest.approx(406.0, abs=5.0)


def test_long_span_quotes_the_rate():
    assert co.estimate(_plant(400.0, 20.0))["skew_quotable"] is True


# ─── the pieces, directly ───────────────────────────────────────────────────────────────────────

def test_the_answer_does_not_depend_on_where_the_caller_starts_t():
    """`lower_envelope` is only bounded for t >= 0, so `estimate` shifts rather than trusting the caller.

    Without the shift a negative-t axis still returns a line below all the points — it is just no longer
    the LP's optimum, and nothing says so. Same offset, same slope, from three different origins; only
    `t_ref_sec` moves, and it moves into whatever coordinates the caller used.
    """
    base = _plant(400.0, 20.0)
    got = [co.estimate([(t + shift, d) for t, d in base]) for shift in (0.0, 1.786e9, -30000.0)]
    for r in got[1:]:
        assert r["offset_ms"] == pytest.approx(got[0]["offset_ms"], abs=0.5)
        assert r["slope_ppm"] == pytest.approx(got[0]["slope_ppm"], abs=0.05)
    assert got[2]["t_ref_sec"] == pytest.approx(got[0]["t_ref_sec"] - 30000.0, abs=1.0)


def test_lower_hull_drops_points_above_the_hull():
    assert co._lower_hull([(0.0, 0.0), (1.0, 1.0), (2.0, 0.0)]) == [(0.0, 0.0), (2.0, 0.0)]
    assert co._lower_hull([(0.0, 0.0), (1.0, -1.0), (2.0, 0.0)]) == [(0.0, 0.0), (1.0, -1.0), (2.0, 0.0)]


# ─── the hull turn test, pinned at each of its three degrees of freedom ──────────────────────────
# Every one of these was a SURVIVING MUTANT under tests that already had 100% branch coverage. The
# turn test has a sign, a comparison and a threshold, and reaching the line proves none of them.

def test_hull_drops_collinear_interior_points():
    """`cross > 0` POPS a collinear point (cross == 0); `>=` would keep it.

    Not academic — a perfectly linear delay ramp is the noise-free case this estimator is built for,
    and the hull walk sees cross == 0 at every interior point of it.
    """
    assert co._lower_hull([(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]) == [(0.0, 0.0), (2.0, 2.0)]


def test_hull_keeps_a_turn_of_exactly_one():
    """Pins the THRESHOLD at 0 rather than at some small positive number.

    `(0,0) (1,0) (2,1)` has cross exactly 1, so `> 0` keeps the middle vertex and `> 1` drops it.
    """
    assert co._lower_hull([(0.0, 0.0), (1.0, 0.0), (2.0, 1.0)]) == [(0.0, 0.0), (1.0, 0.0), (2.0, 1.0)]


def test_hull_turn_test_is_measured_from_the_origin_vertex():
    """Pins the SIGN of the `p[0] - ox` term. The other hull fixtures all start at x == 0, where
    `p[0] - ox` and `p[0] + ox` are the same number — so they cannot see this at all."""
    assert co._lower_hull([(10.0, 0.0), (11.0, 1.0), (12.0, 0.0)]) == [(10.0, 0.0), (12.0, 0.0)]


def test_lower_envelope_accepts_a_two_vertex_hull():
    """Two vertices is the MINIMUM that determines a line, and the common case: a clean ramp hulls to
    its two endpoints. `len(hull) < 2` must admit it; `<= 2` or `< 3` would refuse every such night."""
    assert co.lower_envelope([(0.0, 0.0), (1.0, 1.0)]) == (1.0, 0.0)


def test_floor_by_t_keeps_the_minimum_at_each_t():
    assert co._floor_by_t([(0.0, 5.0), (0.0, 2.0), (0.0, 9.0), (1.0, 3.0)]) == [(0.0, 2.0), (1.0, 3.0)]


def test_duplicate_t_still_weights_the_objective():
    """Only the minimum at a t can be an active constraint, but the duplicates still WEIGHT that t in
    the LP objective. Dropping them would change which hull edge wins, so `n_total`/`sum_t` are taken
    over the original set — this pins that they are actually threaded through."""
    pts = sorted([(0.0, 0.0), (10.0, -1.0)] + [(20.0, 0.0)] * 50)
    weighted = co.lower_envelope(pts)                              # sum_t dominated by the late point
    unweighted = co.lower_envelope(pts, n_total=3, sum_t=30.0)     # as if the duplicates were collapsed
    assert weighted != unweighted, "the duplicates did not reach the objective"


def test_lower_envelope_returns_none_without_two_distinct_t():
    assert co.lower_envelope([(1.0, 1.0), (1.0, 2.0)]) is None


def test_paxson_returns_none_when_it_cannot_form_a_slope():
    assert co.paxson([(1.0, 1.0)]) is None


def test_median_handles_both_parities():
    assert co._median([3.0, 1.0, 2.0]) == 2.0
    assert co._median([4.0, 1.0, 3.0, 2.0]) == 2.5


def _paxson_fixture():
    """20 subsets of 10, each with ONE unambiguous minimum, on a SAWTOOTH WITH DRIFT.

    The shape is load-bearing and three earlier ones were rejected for being blind, each in a way that
    looked fine until the mutant was applied:

    * a straight line makes every pairwise slope identical, so the pair set cannot matter;
    * a SYMMETRIC parabola puts the median at 0 for every pair set — the same blindness, new shape;
    * any MONOTONE curve leaves the subset minima unchanged when the partition window is widened,
      because min(subset i, subset i+1) is still subset i's minimum. That one silently hid the
      chunk-stride mutant, and a fixture that cannot see a mutant is not evidence about it.

    Non-monotone so widening the window picks a different minimum; drifting so the pair set matters.
    """
    pts = []
    for i in range(20):
        vmin = round(i * 0.6 + (0.0, -8.0, 4.0)[i % 3] + (10.0 if i > 13 else 0.0), 6)
        for k in range(10):
            pts.append((float(10 * i + k), vmin if k == 5 else vmin + 100.0))
    return pts


def test_paxson_partitions_by_count_and_takes_each_subset_minimum():
    """Known answer, pinned exactly — it fixes the CHUNKING (which points form each subset), the PAIR
    SET (which minima are differenced against which) and the slope ARITHMETIC in one assertion.

    Margins are real, not float noise: widening the chunk stride and dropping/adding adjacent pairs
    move the slope by 0.006-0.013 here, against a 1-ulp difference on the monotone fixture this
    replaced. A kill that rests on the last bit of a float is not a kill worth having.
    """
    a, b = co.paxson(_paxson_fixture())
    assert (a, b) == (0.10999999999999999, -2.8)


def test_paxson_slope_divides_by_the_time_difference():
    """Guards the two arithmetic confusions in the denominator — `t_j + t_i` for `t_j - t_i`, and a
    DELAY read where a time belongs. Both leave the code running and merely wrong: they move the
    slope to 0.044 and 0.063 against the true 0.110, which no tolerance on a fitted line would
    notice, because a wrong-but-plausible slope still produces a wrong-but-plausible offset."""
    a, _ = co.paxson(_paxson_fixture())
    assert a == pytest.approx(0.110, abs=1e-6)
    assert abs(a - 0.0442) > 0.01, "the denominator summed the times instead of differencing them"
    assert abs(a - 0.0634) > 0.01, "the denominator differenced a time against a delay"


def test_paxson_skips_a_pair_of_minima_that_share_a_timestamp():
    """The `mins[j][0] != mins[i][0]` guard exists to stop a zero denominator, and NOTHING ELSE reaches
    that divide — so reading either index off the wrong axis is an unguarded division by zero.

    Twenty points and twenty subsets means one point per subset, so every point is its own minimum;
    two of them share a t. The real guard skips that pair. Both index confusions raise here instead,
    which is why this is a crash test rather than a value test.
    """
    pts = ([(5.0, -1.0)] + [(float(i), 100.0) for i in range(1, 10)]
           + [(5.0, -2.0)] + [(float(i), 100.0) for i in range(11, 20)])
    assert co.paxson(pts) == (0.0, 100.0)


def test_paxson_is_robust_where_least_squares_would_not_be():
    """The median-of-minima is the point of Paxson's estimator; a mean would follow the outlier."""
    pts = _plant(400.0, 0.0, outlier=-5000.0)
    a, b = co.paxson(pts)
    assert a * (sum(t for t, _ in pts) / len(pts)) + b == pytest.approx(400.0, abs=10.0)


# ─── the shipped alternative it is replacing ────────────────────────────────────────────────────

def test_floor_ms_has_no_time_model_and_a_skewed_night_exposes_it():
    """Measured on a real 8 h H10 capture, `floor_ms` sat 242 ms from the fitted value against PAT's
    10 ms budget — because it returns one number for a quantity that moved across the recording.
    This reproduces that gap on planted data so a regression cannot quietly restore the old behaviour."""
    pts = _plant(400.0, 20.0)
    fitted = co.estimate(pts)["offset_ms"]
    flat, _ = PmdArrivalLogWriter.floor_ms([d for _, d in pts])
    assert abs(fitted - flat) > 100.0, "the two must not agree on a skewed night"
    assert fitted == pytest.approx(_truth(400.0, 20.0, pts), abs=1.0), "and the fitted one is the right one"
