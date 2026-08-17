# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""`allan` — clock stability as a curve.

Known-answer tests against SYNTHESISED series whose noise type is known by construction, because the
whole value of this module is that the slope names a mechanism. A test that only checked "it returns a
number" would pass against a classifier that cannot tell drift from jitter — which is the one thing it
exists to do, so the separation is asserted explicitly.
"""
from __future__ import annotations

import pytest
import random

import allan

N = 20000
TAU0 = 1.0


def _white_pm(seed=7):
    """Phase itself is white → ADEV ~ tau^-1."""
    rng = random.Random(seed)
    return [rng.gauss(0, 1) for _ in range(N)]


def _white_fm(seed=7):
    """White FREQUENCY → phase is its integral, a random walk → ADEV ~ tau^-1/2."""
    rng = random.Random(seed)
    x = [0.0]
    for _ in range(N):
        x.append(x[-1] + rng.gauss(0, 1))
    return x


def _rw_fm(seed=7):
    """Frequency is itself a random walk → phase is a double integral → ADEV ~ tau^+1/2."""
    rng = random.Random(seed)
    f, x = 0.0, [0.0]
    for _ in range(N):
        f += rng.gauss(0, 0.01)
        x.append(x[-1] + f)
    return x


def _drift():
    """A constant frequency ramp → quadratic phase → ADEV ~ tau^+1."""
    return [0.5 * 1e-4 * (i ** 2) for i in range(N)]


def test_each_noise_type_recovers_its_own_slope():
    """The four canonical exponents, each within 0.1 of theory. Measured: -1.000 / -0.545 / +0.462 /
    +1.000 against -1 / -0.5 / +0.5 / +1."""
    for series, want in ((_white_pm(), -1.0), (_white_fm(), -0.5), (_rw_fm(), 0.5), (_drift(), 1.0)):
        sl = allan.slope(allan.adev(series, TAU0))
        assert abs(sl - want) < 0.1, f"slope {sl} for an expected {want}"


def test_the_classifier_separates_all_four():
    """ANTI-VACUITY. A classifier that returned one label for everything would satisfy any single-series
    test; what matters is that the four map to four DIFFERENT names."""
    names = [allan.classify(allan.slope(allan.adev(s, TAU0)))["noise"]
             for s in (_white_pm(), _white_fm(), _rw_fm(), _drift())]
    assert len(set(names)) == 4, names
    assert names == ["white/flicker-phase", "white-frequency", "random-walk-frequency", "drift"]


def test_a_constant_offset_and_a_constant_rate_are_invisible():
    """The second difference kills both by construction, and that is the point: the 875.7 ms inter-device
    constant and the -20.86 ppm rate are separately measured and removable, so ADEV must measure only
    what is LEFT. If a rate leaked in here it would masquerade as drift."""
    base = _white_fm()
    offset = [v + 875.7 for v in base]
    ramp = [base[i] + 0.02086 * i for i in range(len(base))]   # a pure rate, in the same units
    a = allan.adev(base, TAU0)
    for variant in (offset, ramp):
        b = allan.adev(variant, TAU0)
        assert len(a) == len(b)
        for p, q in zip(a, b):
            assert abs(p["adev"] - q["adev"]) < 1e-6 * max(1.0, p["adev"]), (p, q)


def test_optimal_tau_is_the_longest_when_noise_falls_and_the_shortest_when_it_rises():
    """`optimal_tau` is the averaging window a measurement should use, so its direction must follow the
    slope: falling noise (white PM/FM) rewards long averaging, rising noise (random walk, drift) punishes
    it. Getting this backwards would recommend averaging straight through a drift."""
    fall = allan.stability(_white_fm(), TAU0)
    rise = allan.stability(_drift(), TAU0)
    assert fall["optimal_tau"] == fall["tau_max"], fall
    assert rise["optimal_tau"] == rise["tau_min"], rise


def test_refusals_return_no_curve_rather_than_a_thin_one():
    """A tau with a handful of terms has a confidence interval wider than the answer — reporting it is
    the failure this module exists to stop."""
    assert allan.adev([], 1.0) == []
    assert allan.adev([1.0, 2.0], 1.0) == []
    assert allan.adev([1.0] * 100, 0) == []
    assert allan.adev([1.0] * 100, -1) == []
    assert allan.slope([]) is None
    assert allan.slope([{"tau": 1, "adev": 1}, {"tau": 2, "adev": 1}]) is None, "two points are not a slope"
    assert allan.classify(None) is None
    r = allan.stability([1.0] * 30, 1.0)
    assert r["ok"] is False and r["reason"] == "too-few-taus"


def test_slope_needs_spread_in_tau():
    """All taus equal ⇒ no slope is defined; the denominator would be zero."""
    assert allan.slope([{"tau": 4, "adev": 1}, {"tau": 4, "adev": 2}, {"tau": 4, "adev": 3}]) is None


def test_non_finite_samples_are_dropped_not_defaulted():
    """A fabricated 0 in a phase series would read as a large excursion and inflate every tau."""
    good = _white_fm()
    dirty = good[:100] + [float("nan"), float("inf"), None] + good[100:]
    assert len(allan.adev(dirty, TAU0)) == len(allan.adev(good, TAU0))


def test_stability_reports_the_curve_and_the_classification_together():
    """A slope without the curve cannot be argued with, and the curve is what a later threshold would be
    set from — so both ship."""
    r = allan.stability(_white_fm(), TAU0)
    assert r["ok"] and r["taus"] >= 3
    assert r["tau_min"] < r["tau_max"]
    assert len(r["curve"]) == r["taus"]
    assert r["classification"]["noise"] == "white-frequency"
    assert all(p["n"] >= 8 for p in r["curve"]), "a tau with too few terms must not be reported"


def test_explicit_taus_are_honoured_and_impossible_ones_skipped():
    """A caller may name its own averaging times — but a tau below one sample interval, or one so long
    the series cannot supply `_MIN_TERMS` second differences, is DROPPED rather than reported thin. A
    thin tau is a number with a confidence interval wider than itself."""
    series = _white_fm()
    pts = allan.adev(series, TAU0, taus=[0.4, 1.0, 4.0, 1e9])
    got = [p["tau"] for p in pts]
    assert 0.4 not in got, "a tau below one sample interval rounds to m=0 and must be skipped"
    assert 1e9 not in got, "a tau longer than the series must be skipped, not reported"
    assert got == [1.0, 4.0], got
    assert all(p["n"] >= 8 for p in pts)


# ─── EXACT pins. The tolerance-based tests above assert the SHAPE of the answer; 39 arithmetic
#     mutations survived them (terms = n-3m, t = m/tau0, /1001.0, len(pairs)-2, …) because a slope
#     within 0.1 of theory is unchanged by a small arithmetic slip. These pin the VALUE, against a
#     second implementation written straight from the definition — the one thing a mutated copy of
#     the first cannot agree with.

def _reference_adev(x, tau0, m):
    """Overlapping ADEV at one m, written directly from the textbook formula and nothing else:
        sigma_y(tau) = sqrt( 1/(2(N-2m)tau^2) * SUM (x[i+2m] - 2x[i+m] + x[i])^2 ),  tau = m*tau0
    Deliberately independent of `allan.py` — same definition, different code."""
    n = len(x)
    terms = n - 2 * m
    acc = 0.0
    for i in range(terms):
        d = x[i + 2 * m] - 2.0 * x[i + m] + x[i]
        acc += d * d
    tau = m * tau0
    return (acc / (2.0 * terms)) ** 0.5 / tau


def test_adev_matches_an_independent_implementation_exactly():
    """Every tau, to 1e-12. Kills the arithmetic: a wrong `terms`, a `m/tau0` for `m*tau0`, a shifted
    second difference — each moves this and none of them moves a slope by 0.1."""
    x = _white_fm()
    pts = allan.adev(x, TAU0)
    assert len(pts) >= 5
    for p in pts:
        m = int(round(p["tau"] / TAU0))
        assert p["n"] == len(x) - 2 * m, f"terms wrong at m={m}: {p['n']}"
        assert p["tau"] == m * TAU0
        assert abs(p["adev"] - _reference_adev(x, TAU0, m)) < 1e-12 * max(1.0, p["adev"]), p


def test_adev_scales_exactly_with_tau0():
    """tau0 enters as a DIVISOR of the phase difference, so halving it doubles every sigma_y and the
    taus halve. A `m/tau0` or a dropped tau0 breaks this identity; a tolerance never sees it."""
    x = _white_fm()
    a = allan.adev(x, 1.0)
    b = allan.adev(x, 0.5)
    assert len(a) == len(b)
    for p, q in zip(a, b):
        assert abs(q["tau"] - p["tau"] / 2) < 1e-12
        assert abs(q["adev"] - p["adev"] * 2) < 1e-9 * p["adev"]


def test_octave_taus_are_exactly_powers_of_two_and_stop_where_the_series_does():
    """The ladder is 1,2,4,8,… tau0 — pinned exactly, since `m = 2`, `m *= 3` and an off-by-one in the
    stop condition all survive a test that only checks 'some taus came back'."""
    x = [0.0] * 1000
    x = _white_fm()[:1000]
    pts = allan.adev(x, 3.0)
    ms = [round(p["tau"] / 3.0) for p in pts]
    assert ms == [2 ** i for i in range(len(ms))], ms
    assert ms[0] == 1, "the ladder must start at one sample interval"
    # the stop is m <= n / (2 * _MIN_SPAN_MULTIPLE): with n=1000 that is m <= 125, so the last is 64
    assert ms[-1] == 64, ms
    assert all(p["n"] >= 8 for p in pts)


def test_slope_is_exact_on_a_log_linear_curve():
    """A curve that IS a power law has an exactly known slope, so the regression is pinned to 1e-12 —
    which catches `sum(ys) * k`, `(xs[i] + mx)`, `(ys[i] + my)` and `den <= 1`."""
    for want in (-1.0, -0.5, 0.0, 0.5, 1.0, 2.75):
        pts = [{"tau": t, "adev": 3.0 * t ** want} for t in (1.0, 2.0, 4.0, 8.0, 16.0)]
        assert abs(allan.slope(pts) - want) < 1e-12, (want, allan.slope(pts))


def test_classify_boundaries_are_half_open_at_the_named_edges():
    """The edges are -0.75/-0.25/0.25/0.75 and the comparison is STRICT `<`, so a slope sitting exactly
    on an edge belongs to the HIGHER class. `<=` would silently move every boundary case."""
    assert allan.classify(-0.75)["noise"] == "white-frequency", "exactly on an edge goes up, not down"
    assert allan.classify(-0.7501)["noise"] == "white/flicker-phase"
    assert allan.classify(0.75)["noise"] == "drift"
    assert allan.classify(0.7499)["noise"] == "random-walk-frequency"
    assert allan.classify(-0.25)["noise"] == "flicker-frequency"
    assert allan.classify(0.25)["noise"] == "random-walk-frequency"


def test_adev_needs_three_samples_not_four_and_rejects_a_zero_tau0():
    """The guard is `n < 3` and `tau0 <= 0`, both exactly. A series of exactly 3 with a valid tau0 is
    ADMITTED (it yields no tau, but the guard is not what stops it), and tau0 = 0 is rejected while a
    tiny positive tau0 is not."""
    assert allan.adev([1.0, 2.0], 1.0) == []
    assert allan.adev([1.0, 2.0, 3.0], 1.0) == [], "3 samples pass the guard but support no tau"
    assert allan.adev(_white_fm(), 1e-9) != [], "a tiny POSITIVE tau0 is valid"
    assert allan.adev(_white_fm(), 0.0) == []
    assert allan.adev(_white_fm(), -1.0) == []


def test_adev_skips_a_too_long_tau_and_keeps_going():
    """`continue`, not `break`: an unsupportable tau in the middle of an explicit list must not
    truncate the ones after it."""
    pts = allan.adev(_white_fm(), TAU0, taus=[1.0, 1e9, 4.0])
    assert [p["tau"] for p in pts] == [1.0, 4.0], pts


def test_stability_needs_three_taus_exactly():
    """`len(pts) < 3` — a two-tau curve has no slope, a three-tau curve does."""
    x = _white_fm()
    assert allan.stability(x, TAU0, )["ok"] is True
    two = allan.adev(x, TAU0, taus=[1.0, 2.0])
    assert len(two) == 2 and allan.slope(two) is None


# ── the boundary refusal (2026-08-13) ──────────────────────────────────────────────────────────────
# `classify` named a noise type from a strict `<` against a POINT ESTIMATE, and rounded the slope in
# the returned record. So -0.7501 and -0.7500 printed identically with OPPOSITE types, and `meaning`
# flipped between "averages away" and "helps as sqrt(N)" — the field a caller branches on. Found while
# promoting the JS twin into clock.js; fixed in both lanes in one changeset so they cannot drift.


def test_boundary_slopes_differ_by_a_digit_the_output_used_to_hide():
    """Without an SE the two sides of an edge classify oppositely — the defect, kept as the control."""
    a = allan.classify(-0.7501)
    b = allan.classify(-0.7500)
    assert a["noise"] == "white/flicker-phase"
    assert b["noise"] == "white-frequency"
    # and the deciding digit is now VISIBLE, because slope is no longer rounded in the data
    assert a["slope"] == -0.7501 and b["slope"] == -0.75


def test_an_edge_inside_1_96_se_refuses_to_name_a_type():
    """The fix: an unsupportable distinction yields None, not a coin flip."""
    c = allan.classify(-0.75, 0.02)
    assert c["noise"] is None, c
    assert c["candidates"] == ["white/flicker-phase", "white-frequency"], c
    assert "not supported" in c["meaning"]


def test_noise_is_None_and_never_a_truthy_sentinel():
    """`'ambiguous'` would pass `if c["noise"]:` — the guard callers actually write — and so would
    reintroduce the bug inside its own fix."""
    c = allan.classify(-0.75, 0.02)
    assert c["noise"] is None
    assert not c["noise"]


def test_a_confident_slope_is_still_named():
    """The refusal must DISCRIMINATE. -1.007 with SE 0.003 is ~90 SEs from the nearest edge; a rule
    that refused here would be useless rather than cautious."""
    c = allan.classify(-1.007, 0.003)
    assert c["noise"] == "white/flicker-phase"
    assert c["candidates"] is None  # present-and-None on success, matching the JS twin


def test_slope_se_is_published_even_when_classification_succeeds():
    """A caller with a wider tolerance must be able to decide for itself, which requires the SE on the
    success path too — not only when the module already gave up."""
    st = allan.stability(_white_pm(), TAU0)
    assert st["slope_se"] is not None and st["slope_se"] > 0
    assert st["classification"]["noise"] is not None
    assert st["classification"]["slope_se"] == st["slope_se"]


def test_slope_is_unrounded_in_the_data():
    """Rounding in the DATA is the root cause: two records printing -0.75 with opposite labels. Round
    at display instead."""
    st = allan.stability(_white_pm(), TAU0)
    assert st["classification"]["slope"] == allan.slope(allan.adev(_white_pm(), TAU0))


def test_slope_se_needs_three_taus():
    """Two points fit any line, so their residual is identically zero and an SE from them would read as
    perfect confidence — the opposite of the truth. None, like `slope`."""
    assert allan.slope_se([{"tau": 1.0, "adev": 1.0}, {"tau": 2.0, "adev": 0.5}]) is None
    assert allan.slope_se([]) is None


def test_slope_se_refuses_a_degenerate_x_spread():
    """All taus equal ⇒ sxx == 0 ⇒ the slope is undefined, not infinite. Reachable only by hand: adev()
    never emits duplicate taus, which is exactly why the guard needs its own test rather than a
    fixture."""
    same = [{"tau": 4.0, "adev": 1.0}, {"tau": 4.0, "adev": 2.0}, {"tau": 4.0, "adev": 3.0}]
    assert allan.slope_se(same) is None


def test_a_straddle_of_the_TOP_edge_offers_drift_as_a_candidate():
    """The +0.75 edge is the open-ended one — drift sits ABOVE the table rather than in it, so the
    candidate list has to reach outside `_NOISE` to name it. A slope just under +0.75 with a wide SE
    cannot be separated from deterministic drift, and saying 'random-walk' there would be a guess."""
    c = allan.classify(0.74, 0.02)
    assert c["noise"] is None, c
    assert "drift" in c["candidates"], c


def test_se_zero_and_se_none_are_a_DECISION_not_a_fall_through():
    """Both skip the refusal, for OPPOSITE reasons, and the record keeps them apart.

    `None` means no SE was supplied — the caller gets the pre-SE contract. `0.0` means the log-log
    points fall exactly on a line, which a noiseless tau^-1 series really does produce; that is the one
    case where the exponent is known exactly, so refusing there would refuse the best-determined input
    there is. Pinned because they are one `if half:` apart and a later reader would otherwise have to
    guess whether the equality was intended.
    """
    a = allan.classify(-0.75, None)
    b = allan.classify(-0.75, 0.0)
    assert a["noise"] == b["noise"] == "white-frequency"
    # …and a reader can still tell which input produced it
    assert a["slope_se"] is None and b["slope_se"] == 0.0


def test_a_perfect_power_law_really_does_yield_zero_se():
    """The reachability that makes the case above worth pinning rather than dismissing."""
    pts = [{"tau": 2**k, "adev": 1.0 / (2**k)} for k in range(6)]
    assert allan.slope(pts) == -1.0
    assert allan.slope_se(pts) == 0.0


def test_n_tau_travels_with_the_classification():
    """A perfect fit on 3 taus and one on 12 both yield se 0.0 and are very different evidence — the SE
    divides by k-2, so three points lie on a line far more easily than twelve. `stability()` publishes
    `taus` at its own level, but a consumer holding only the classification dict could not tell them
    apart. Same shape as the rename problem, one FIELD short rather than one LAYER short."""
    st = allan.stability(_white_pm(), TAU0)
    assert st["classification"]["n_tau"] == st["taus"]
    assert allan.classify(-1.0, 0.0, 3)["n_tau"] == 3
    assert allan.classify(-1.0, 0.0)["n_tau"] is None


def test_the_1_96_multiplier_itself_is_pinned():
    """The whole refusal rests on 1.96, and nothing pinned it — a `2.96` mutant SURVIVED CI.

    The killing case has to sit in the band the two multipliers disagree about. Edge at -0.75, se 0.01:
    1.96*se = 0.0196 and 2.96*se = 0.0296, so a slope 0.025 away is OUTSIDE the real band and INSIDE
    the inflated one. Naming the type here is therefore only correct at 1.96.
    """
    c = allan.classify(-0.775, 0.01)
    assert c["noise"] == "white/flicker-phase", c  # 2.96 would have refused
    # …and the band is real: move just inside it and the refusal fires
    assert allan.classify(-0.765, 0.01)["noise"] is None


# ── the arithmetic itself, not just its shape (mutation survivors, 2026-08-13) ──────────────────────
# The diff-scoped mutation gate killed a dozen mutants in the code above that every existing test
# survived: `k - 2` -> `k + 2`, `len < 3` -> `< 4`, `sxx <= 0` -> `<= 1`, `_NOISE[-1]` -> `_NOISE[-2]`,
# and every `<` -> `<=` on the straddle test. The common gap: the tests asserted that a refusal happened
# and that an SE was positive, never WHICH NUMBER came out. A property that survives rescaling or an
# off-by-one cannot pin arithmetic — the same lesson the three-cornered-hat coefficient taught.


def test_slope_se_is_the_exact_OLS_value_not_merely_positive():
    """Pins `ss / (k - 2) / sxx`. `k + 2` and `k - 3` both survived "se > 0"; only the value kills them
    (and `k - 3` at k=3 divides by zero, which is its own signal)."""
    p3 = [{"tau": 1.0, "adev": 1.0}, {"tau": 2.0, "adev": 0.4}, {"tau": 4.0, "adev": 0.3}]
    assert allan.slope(p3) == pytest.approx(-0.8684827971, abs=1e-9)
    assert allan.slope_se(p3) == pytest.approx(0.2617967648, abs=1e-9)


def test_exactly_three_taus_is_ENOUGH_not_too_few():
    """`len(pts) < 3` -> `<= 3` / `< 4` both survived, because every test used either 2 (refused) or
    many (accepted) and none sat ON the minimum. Three is the least that can show curvature."""
    p3 = [{"tau": 1.0, "adev": 1.0}, {"tau": 2.0, "adev": 0.4}, {"tau": 4.0, "adev": 0.3}]
    assert allan.slope_se(p3) is not None
    assert allan.slope(p3) is not None


def test_a_small_but_nonzero_x_spread_is_still_usable():
    """`sxx <= 0` -> `sxx <= 1` survived: every fixture had a decade-wide tau ladder, so sxx > 1 always.
    A narrow ladder is unusual, not invalid — refusing it would discard a real curve."""
    tiny = [{"tau": 1.0, "adev": 1.0}, {"tau": 1.2, "adev": 0.9}, {"tau": 1.5, "adev": 0.8}]
    se = allan.slope_se(tiny)
    assert se is not None and se == pytest.approx(0.01425291409, abs=1e-9)


def test_drift_is_offered_only_from_the_TOP_edge():
    """`_NOISE[-1]` -> `_NOISE[-2]` / `_NOISE[+1]` survived: they change WHICH edge admits drift as a
    candidate. A CI reaching past +0.25 but not +0.75 must NOT offer drift."""
    c = allan.classify(0.2, 0.02)  # CI [0.16, 0.24] — clears +0.25, nowhere near +0.75
    assert c["noise"] is not None, c  # straddles nothing
    mid = allan.classify(0.24, 0.01)  # CI [0.2204, 0.2596] — straddles +0.25 only
    assert mid["noise"] is None
    assert "drift" not in mid["candidates"], mid
    top = allan.classify(0.74, 0.02)  # CI [0.7008, 0.7792] — straddles +0.75
    assert "drift" in top["candidates"], top


def test_a_CI_ENDING_exactly_on_an_edge_does_not_straddle_it():
    """Every `<` -> `<=` mutant on the straddle test survived, because no fixture landed a CI endpoint
    EXACTLY on a category edge. It is constructible: 1.96 * (0.25/1.96) is exactly 0.25, so a slope of
    0.0 puts both endpoints precisely on -0.25 and +0.25.

    The convention this pins is half-open — touching an edge is not crossing it. That is a real
    decision, not an accident: a CI that merely reaches a boundary has not shown the slope could be on
    the other side of it, and refusing there would refuse every fit whose error happens to end flush.
    """
    se = 0.25 / 1.96  # -> half == 0.25 exactly
    assert 1.96 * se == 0.25
    c = allan.classify(0.0, se)  # CI is exactly [-0.25, +0.25]
    assert c["noise"] is not None, c  # `<=` on either side would refuse here
    # …and a hair wider DOES straddle, so the boundary is where it claims to be
    assert allan.classify(0.0, se * 1.0001)["noise"] is None


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE REST OF THE FAMILY — MDEV / TDEV / HDEV.
#
# The point of each is a SEPARATION the incumbent cannot make, so each is tested by the separation and
# not by "returns a number": MDEV splits white from flicker phase noise where ADEV maps both to tau^-1,
# and HDEV is blind to the linear drift that ADEV reports. A test asserting only shape would pass
# against an implementation that computed ADEV three times.
# ══════════════════════════════════════════════════════════════════════════════════════════════════

import math


def test_mdev_splits_white_phase_from_flicker_where_adev_reports_one_arm():
    """THE headline capability. On white PM, ADEV gives tau^-1 and MDEV gives tau^-3/2 — the gap IS
    the discrimination, and it is why a second curve is computed at all."""
    x = _white_pm()
    assert allan.slope(allan.adev(x, TAU0)) == pytest.approx(-1.0, abs=0.05)
    assert allan.slope(allan.mdev(x, TAU0), "mdev") == pytest.approx(-1.5, abs=0.08)


def test_mdev_and_adev_agree_where_no_split_exists():
    """White FM is tau^-1/2 for BOTH. If MDEV disagreed here it would be measuring something else."""
    x = _white_fm()
    a = allan.slope(allan.adev(x, TAU0))
    m = allan.slope(allan.mdev(x, TAU0), "mdev")
    assert a == pytest.approx(-0.5, abs=0.12)
    assert m == pytest.approx(a, abs=0.12)


def test_hdev_is_blind_to_the_linear_drift_that_adev_reports():
    """HDEV's third difference annihilates a linear frequency drift; ADEV's second difference does
    not. On a PURE drift series ADEV must read +1 while HDEV must not — otherwise HDEV buys nothing
    over ADEV and the O2Ring's -3035 ppm ramp would keep masking the noise underneath it."""
    x = _drift()
    assert allan.slope(allan.adev(x, TAU0)) == pytest.approx(1.0, abs=0.05)
    assert allan.slope(allan.hdev(x, TAU0), "hdev") < 0.0


def test_tdev_is_exactly_mdev_scaled_by_tau_over_sqrt_three():
    x = _white_pm()
    m = allan.mdev(x, TAU0)
    t = allan.tdev(x, TAU0)
    assert [p["tau"] for p in t] == [p["tau"] for p in m]
    assert [p["n"] for p in t] == [p["n"] for p in m]
    for tp, mp in zip(t, m):
        assert tp["tdev"] == pytest.approx(mp["tau"] * mp["mdev"] / math.sqrt(3.0), rel=1e-12)


def test_tdev_of_an_unusable_series_is_empty_not_an_exception():
    assert allan.tdev([1.0, 2.0], TAU0) == []


def _reference_mdev(x, tau0, m):
    """Direct O(N*m) transcription of the definition — deliberately NOT the sliding window, so a
    windowing error cannot hide behind a test that reuses it."""
    n = len(x)
    terms = n - 3 * m + 1
    acc = 0.0
    for j in range(terms):
        s = 0.0
        for i in range(j, j + m):
            s += x[i + 2 * m] - 2.0 * x[i + m] + x[i]
        acc += s * s
    t = m * tau0
    return math.sqrt(acc / (2.0 * terms)) / (m * t)


def _reference_hdev(x, tau0, m):
    n = len(x)
    terms = n - 3 * m
    acc = 0.0
    for i in range(terms):
        d = x[i + 3 * m] - 3.0 * x[i + 2 * m] + 3.0 * x[i + m] - x[i]
        acc += d * d
    t = m * tau0
    return math.sqrt(acc / (6.0 * terms)) / t


def test_mdev_sliding_window_equals_the_direct_definition():
    """The O(N) inner sum is an optimisation, and an optimisation that changes the answer is a bug."""
    rng = random.Random(11)
    x = [rng.gauss(0, 1) for _ in range(400)]
    for m in (1, 2, 4, 8, 16):
        got = allan.mdev(x, TAU0, [m * TAU0])
        assert got[0]["mdev"] == pytest.approx(_reference_mdev(x, TAU0, m), rel=1e-9)


def test_hdev_matches_the_direct_definition():
    rng = random.Random(11)
    x = [rng.gauss(0, 1) for _ in range(400)]
    for m in (1, 2, 4, 8, 16):
        got = allan.hdev(x, TAU0, [m * TAU0])
        assert got[0]["hdev"] == pytest.approx(_reference_hdev(x, TAU0, m), rel=1e-12)


def test_each_estimator_reports_its_OWN_term_count():
    """MDEV needs N-3m+1 terms and HDEV N-3m, against ADEV's N-2m. Reusing ADEV's count would offer
    averaging times the other two cannot support — the thin estimate this module refuses to publish."""
    rng = random.Random(3)
    x = [rng.gauss(0, 1) for _ in range(200)]
    n, m = len(x), 8
    assert allan.adev(x, TAU0, [m * TAU0])[0]["n"] == n - 2 * m
    assert allan.mdev(x, TAU0, [m * TAU0])[0]["n"] == n - 3 * m + 1
    assert allan.hdev(x, TAU0, [m * TAU0])[0]["n"] == n - 3 * m


def test_mdev_and_hdev_stop_earlier_than_adev_on_a_short_series():
    """The consequence of the counts above: at a length where ADEV can still report a tau, the two
    third-difference estimators must decline it rather than report one built on too few terms."""
    rng = random.Random(5)
    x = [rng.gauss(0, 1) for _ in range(30)]
    long_tau = [11 * TAU0]
    assert allan.adev(x, TAU0, long_tau) != []
    assert allan.mdev(x, TAU0, long_tau) == []
    assert allan.hdev(x, TAU0, long_tau) == []


@pytest.mark.parametrize("fn", [allan.mdev, allan.hdev])
def test_short_series_and_bad_tau0_return_no_curve(fn):
    rng = random.Random(2)
    x = [rng.gauss(0, 1) for _ in range(64)]
    assert fn([1.0, 2.0, 3.0], TAU0) == []
    assert fn(x, 0) == []
    assert fn(x, -1.0) == []


@pytest.mark.parametrize("fn", [allan.mdev, allan.hdev])
def test_explicit_taus_below_one_sample_are_skipped_not_crashed(fn):
    rng = random.Random(4)
    x = [rng.gauss(0, 1) for _ in range(200)]
    assert fn(x, TAU0, [0.4 * TAU0]) == []
    assert len(fn(x, TAU0, [0.4 * TAU0, 2 * TAU0])) == 1


def test_non_finite_samples_are_dropped_by_every_estimator():
    rng = random.Random(9)
    clean = [rng.gauss(0, 1) for _ in range(200)]
    dirty = list(clean)
    dirty.insert(50, float("nan"))
    dirty.insert(120, None)
    for fn, key in ((allan.mdev, "mdev"), (allan.hdev, "hdev")):
        assert fn(dirty, TAU0, [4 * TAU0])[0][key] == pytest.approx(fn(clean, TAU0, [4 * TAU0])[0][key])


def test_classify_mdev_uses_the_mdev_table_and_reaches_a_DIFFERENT_verdict():
    """-1.4 is white PHASE under MDEV's exponents and the ambiguous phase arm under ADEV's. If the
    tables were shared, an MDEV curve would be labelled flicker phase every time."""
    assert allan.classify_mdev(-1.4)["noise"] == "white-phase"
    assert allan.classify(-1.4)["noise"] == "white/flicker-phase"
    assert allan.classify_mdev(-0.9)["noise"] == "flicker-phase"


def test_classify_mdev_still_names_drift_from_the_open_top():
    assert allan.classify_mdev(1.2)["noise"] == "drift"


def test_identify_resolves_the_arm_adev_cannot_split():
    r = allan.identify(_white_pm(), TAU0)
    assert r["adev"]["noise"] == "white/flicker-phase"
    assert r["mdev"]["noise"] == "white-phase"
    assert r["phase_noise"] == "white-phase"
    assert r["taus"]["adev"] > 0 and r["taus"]["mdev"] > 0


def test_identify_publishes_None_when_the_pair_licenses_no_split():
    """White FM is not on the ambiguous arm at all, so there is nothing to resolve — and the answer
    must be None rather than a truthy sentinel, for the reason `classify` documents."""
    r = allan.identify(_white_fm(), TAU0)
    assert r["adev"]["noise"] != "white/flicker-phase"
    assert r["phase_noise"] is None


def test_identify_on_a_series_too_short_to_classify_refuses_rather_than_guesses():
    r = allan.identify([1.0, 2.0, 3.0, 4.0], TAU0)
    assert r["adev"] is None
    assert r["mdev"] is None
    assert r["phase_noise"] is None
    assert r["taus"] == {"adev": 0, "mdev": 0}


def test_slope_reads_the_requested_key_and_defaults_to_adev():
    pts = [{"tau": 1.0, "adev": 1.0, "mdev": 2.0}, {"tau": 2.0, "adev": 0.5, "mdev": 2.0}, {"tau": 4.0, "adev": 0.25, "mdev": 2.0}]
    assert allan.slope(pts) == pytest.approx(-1.0)
    assert allan.slope(pts, "mdev") == pytest.approx(0.0, abs=1e-12)
    assert allan.slope_se(pts, "mdev") == pytest.approx(0.0, abs=1e-12)


# ── MUTATION-DRIVEN additions. Each of these kills a mutant that the diff-scoped gate found alive on
# the lines above, i.e. a line whose edit NO existing assertion could observe. Written after the gate
# named them, not before — which is the honest order to record.


@pytest.mark.parametrize("fn,key", [(allan.mdev, "mdev"), (allan.hdev, "hdev")])
def test_mdev_and_hdev_scale_exactly_with_tau0(fn, key):
    """Every assertion above used tau0 = 1.0, where `tau/tau0` and `tau*tau0` are the SAME NUMBER and
    so are `m*tau0` and `m/tau0`. Two mutants lived in that blind spot. A deviation is a rate, so
    stretching the sample interval by k divides it by k at the corresponding tau."""
    rng = random.Random(21)
    x = [rng.gauss(0, 1) for _ in range(300)]
    base = fn(x, 1.0, [4.0])[0]
    for k in (0.5, 2.0, 10.0):
        got = fn(x, k, [4.0 * k])[0]
        assert got["tau"] == pytest.approx(4.0 * k)
        assert got["n"] == base["n"]
        assert got[key] == pytest.approx(base[key] / k, rel=1e-12)


def test_hdev_includes_a_tau_with_EXACTLY_the_minimum_terms():
    """`terms < _MIN_TERMS` vs `<=` differ on exactly one input: terms == _MIN_TERMS. n=11, m=1 gives
    n-3m = 8. Inclusive is correct — the constant is the minimum that IS acceptable."""
    rng = random.Random(31)
    x = [rng.gauss(0, 1) for _ in range(11)]
    got = allan.hdev(x, TAU0, [TAU0])
    assert len(got) == 1
    assert got[0]["n"] == allan._MIN_TERMS


def test_hdev_SKIPS_an_unsupportable_tau_and_keeps_going():
    """`continue` vs `break`: an unsupported tau must not abandon the rest of the ladder. Ordered
    worst-first so a `break` would return nothing at all."""
    rng = random.Random(32)
    x = [rng.gauss(0, 1) for _ in range(30)]
    got = allan.hdev(x, TAU0, [9 * TAU0, TAU0])
    assert [p["tau"] for p in got] == [TAU0]


def test_classify_mdev_forwards_the_se_and_so_can_still_REFUSE():
    """`classify_mdev` dropping `se` was invisible because no test passed one. Without the SE a slope
    on an MDEV edge is named; with it, the refusal must survive the delegation."""
    named = allan.classify_mdev(-1.25)
    assert named["noise"] is not None
    refused = allan.classify_mdev(-1.25, 0.20, 6)
    assert refused["noise"] is None
    assert refused["candidates"]


def test_classify_mdev_forwards_n_tau():
    assert allan.classify_mdev(-0.9, None, 7)["n_tau"] == 7


def test_identify_forwards_the_se_and_the_tau_COUNT_into_both_records():
    """Four mutants dropped `slope_se(a)` or `len(a)` from identify's classify calls and no assertion
    noticed, because only `noise` was ever read. The published record must carry both, or a caller
    cannot tell a confident classification from a bare one."""
    r = allan.identify(_white_pm(), TAU0)
    for lane in ("adev", "mdev"):
        assert r[lane]["slope_se"] is not None, lane
        assert r[lane]["slope_se"] > 0, lane
        assert r[lane]["n_tau"] == r["taus"][lane], lane


# ── SECOND mutation pass. The gate went 28 -> 16; these close the rest. Three of them kill mutants the
# module's own comment called "not worth a constructed double-exact fixture" — a short search over
# (slope, se) found exact-float killers for all three, so the fixture is three lines, not a project.


def test_mdev_includes_a_tau_with_EXACTLY_the_minimum_terms():
    """The mdev twin of the hdev case above — killed there, missed here on the first pass.
    mdev terms = n-3m+1, so n=10, m=1 gives exactly 8."""
    rng = random.Random(43)
    x = [rng.gauss(0, 1) for _ in range(10)]
    got = allan.mdev(x, TAU0, [TAU0])
    assert len(got) == 1
    assert got[0]["n"] == allan._MIN_TERMS


def test_mdev_SKIPS_an_unsupportable_tau_and_keeps_going():
    rng = random.Random(44)
    x = [rng.gauss(0, 1) for _ in range(30)]
    got = allan.mdev(x, TAU0, [9 * TAU0, TAU0])
    assert [p["tau"] for p in got] == [TAU0]


def test_the_ladder_INCLUDES_the_m_whose_term_count_is_exactly_the_minimum():
    """`>= _MIN_TERMS` vs `>`: at n=10, m=1 the ADEV term count is exactly 8. Inclusive is correct —
    _MIN_TERMS is the smallest count that IS acceptable, not the first that is not."""
    assert allan._octave_taus(10, 1.0) == [1.0]
    rng = random.Random(45)
    x = [rng.gauss(0, 1) for _ in range(10)]
    assert len(allan.adev(x, 1.0)) == 1


def test_the_ladder_INCLUDES_the_m_sitting_exactly_ON_the_span_cap():
    """`m <= n/(2*_MIN_SPAN_MULTIPLE)` vs `<`, and the 2.0 itself. At n=16 the cap is exactly 2, so
    m=2 must be included; tightening either the comparison or the constant drops it."""
    assert allan._octave_taus(16, 1.0) == [1.0, 2.0]
    rng = random.Random(46)
    x = [rng.gauss(0, 1) for _ in range(16)]
    assert [p["tau"] for p in allan.adev(x, 1.0)] == [1.0, 2.0]


def test_a_CI_ending_EXACTLY_on_the_top_edge_does_not_offer_drift():
    """`sl + half > _NOISE[-1][0]` vs `>=`. Constructed so the interval genuinely straddles an inner
    edge (so the refusal path is entered) AND its upper end lands exactly on the top edge."""
    sl, se = 0.4952, 0.13
    assert sl + 1.96 * se == allan._NOISE[-1][0]  # the fixture's premise, asserted not assumed
    c = allan.classify(sl, se, 5)
    assert c["noise"] is None
    assert allan._DRIFT[0] not in c["candidates"]


def test_a_candidate_edge_touched_EXACTLY_from_below_is_not_listed():
    """`sl - half < e` vs `<=`: an edge sitting exactly at the interval's lower end is NOT inside it."""
    c = allan.classify(-0.499904, 0.1276, 5)
    assert c["noise"] is None
    assert c["candidates"] == ["white-frequency", "flicker-frequency"]


def test_a_candidate_band_touched_EXACTLY_from_above_is_not_listed():
    """`sl + half > lo` vs `>=`: a band whose lower bound equals the interval's upper end is empty."""
    c = allan.classify(-0.500096, 0.1276, 5)
    assert c["noise"] is None
    assert c["candidates"] == ["white/flicker-phase", "white-frequency"]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# WIRING — the resolution has to reach the ONE consumer that runs.
#
# `identify()` and `tdev()` were correct, tested and changelogged while having ZERO production call
# sites: `stability()` is what `nightqc` calls, and it used ADEV alone. So every real night recorded
# `white/flicker-phase` — one label whose two halves mean opposite things for how much a longer window
# buys — even though the module could already split it. These assert the join, not the estimators.
# ══════════════════════════════════════════════════════════════════════════════════════════════════


def _flicker_pm(seed=11, rows=16):
    """Voss-McCartney pink noise placed directly in PHASE → flicker PM: ADEV ~ tau^-1 (the SAME arm as
    white PM) but MDEV ~ tau^-1, where white PM is tau^-3/2. This is the series the suite lacked."""
    rng = random.Random(seed)
    vals = [rng.gauss(0, 1) for _ in range(rows)]
    out = []
    for i in range(N):
        for k in range(rows):
            if i % (1 << k) == 0:
                vals[k] = rng.gauss(0, 1)
        out.append(sum(vals))
    return out


def test_identify_names_FLICKER_phase_too_and_not_only_white():
    """ANTI-VACUITY for the split itself. Every existing `identify` test uses white PM, so an
    implementation that answered "white-phase" for anything on the ambiguous arm would pass all of
    them. Flicker PM must land on the same ADEV arm and come back with the OTHER name."""
    r = allan.identify(_flicker_pm(), TAU0)
    assert r["adev"]["noise"] == "white/flicker-phase"      # ADEV cannot tell it from white PM
    assert r["phase_noise"] == "flicker-phase"              # …MDEV can
    assert allan.identify(_white_pm(), TAU0)["phase_noise"] == "white-phase"


def test_stability_publishes_the_resolved_phase_type_not_only_the_ambiguous_one():
    """THE WIRING. `classification` still reports ADEV's joint arm; `phase_noise` resolves it."""
    s = allan.stability(_white_pm(), TAU0)
    assert s["classification"]["noise"] == "white/flicker-phase"
    assert s["phase_noise"] == "white-phase"
    assert s["mdev_classification"]["noise"] == "white-phase"


def test_stability_resolves_the_two_arms_to_DIFFERENT_names():
    """The separation, asserted through the production entry point rather than through `identify`."""
    assert allan.stability(_white_pm(), TAU0)["phase_noise"] == "white-phase"
    assert allan.stability(_flicker_pm(), TAU0)["phase_noise"] == "flicker-phase"


def test_stability_publishes_no_phase_type_when_adev_is_not_on_the_ambiguous_arm():
    s = allan.stability(_white_fm(), TAU0)
    assert s["classification"]["noise"] == "white-frequency"
    assert s["phase_noise"] is None


def test_stability_reports_no_tdev_unless_a_tau_is_NAMED():
    """There is deliberately no default tau: reading each stream at its own optimal tau inverted the
    real-corpus ordering, so an unnamed tau must yield None rather than a per-stream number."""
    assert allan.stability(_white_pm(), TAU0)["tdev"] is None


def test_stability_reports_tdev_at_exactly_the_tau_it_was_asked_for():
    s = allan.stability(_white_pm(), TAU0, 300.0)
    assert s["tdev"]["tau"] == 300.0
    assert s["tdev"]["tdev"] > 0 and s["tdev"]["n"] > 0
    # …and it is TDEV, not MDEV: sigma_x = tau/sqrt(3) * Mod sigma_y
    md = allan.mdev(_white_pm(), TAU0, [300.0])[0]["mdev"]
    assert s["tdev"]["tdev"] == pytest.approx(300.0 * md / math.sqrt(3.0), rel=1e-12)


def test_stability_reports_no_tdev_when_the_series_cannot_SUPPORT_the_named_tau():
    """A tau the data cannot carry yields None — never a thin estimate, and never a zero that would
    read as "the time error is zero"."""
    s = allan.stability(_white_pm(), TAU0, 1e9)
    assert s["tdev"] is None


def test_stability_keeps_every_key_it_published_before():
    """Back-compat: the new fields are ADDITIVE. A consumer written against the old record still works."""
    s = allan.stability(_white_pm(), TAU0)
    for k in ("ok", "taus", "tau_min", "tau_max", "adev_min", "optimal_tau", "at_longest",
              "classification", "slope_se", "curve"):
        assert k in s, k


def test_identify_reuses_a_supplied_adev_curve_instead_of_recomputing_it():
    """`stability` already holds the ADEV curve, so it hands it on: one MDEV pass, not a second ADEV.
    The supplied and recomputed forms must agree exactly, or the saving would change the answer."""
    x = _white_pm()
    pts = allan.adev(x, TAU0)
    assert allan.identify(x, TAU0, pts) == allan.identify(x, TAU0)


def test_a_too_short_series_still_refuses_before_reaching_the_new_fields():
    s = allan.stability([1.0, 2.0, 3.0, 4.0], TAU0, 300.0)
    assert s["ok"] is False and s["reason"] == "too-few-taus"
    assert "phase_noise" not in s and "tdev" not in s


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# GROSLAMBERT COVARIANCE — measuring the instrument noise instead of inheriting it.
#
# Every ADEV/TDEV this module reports on an `arrival - device` series is an UPPER BOUND, because the
# series carries BLE transport on top of the oscillator and squaring one series cannot separate them.
# GCov multiplies two series: the shared clock survives, independent per-channel noise averages away.
# So these tests are about a SEPARATION, not a number — the headline one plants a known clock under
# known independent noise and asserts ADEV is fooled where GCov is not.
# ══════════════════════════════════════════════════════════════════════════════════════════════════


def _shared_clock_two_channels(seed=5, noise=3.0):
    """One white-FM clock observed twice, each observation carrying INDEPENDENT white measurement
    noise — the structure of two streams captured from one device over one link."""
    rng = random.Random(seed)
    clock, v = [0.0], 0.0
    for _ in range(N - 1):
        v += rng.gauss(0, 1.0)
        clock.append(v)
    ch1 = [c + rng.gauss(0, noise) for c in clock]
    ch2 = [c + rng.gauss(0, noise) for c in clock]
    return clock, ch1, ch2


def test_gcov_of_a_series_with_itself_is_EXACTLY_adev_squared():
    """The estimator's own regression test: same normalisation, one factor replaced by the series
    itself. Exact to floating point, not approximate — anything else is an arithmetic error."""
    rng = random.Random(3)
    x = [rng.gauss(0, 1) for _ in range(4000)]
    a = allan.adev(x, TAU0)
    g = allan.gcov(x, x, TAU0)
    assert [p["tau"] for p in a] == [p["tau"] for p in g]
    for pa, pg in zip(a, g):
        assert pg["gcov"] == pytest.approx(pa["adev"] ** 2, rel=1e-12)


def test_gcov_rejects_the_measurement_noise_that_adev_CANNOT():
    """THE headline capability, and the reason this is worth having.

    One channel's ADEV sees clock + its own noise and cannot separate them; at short tau the noise
    dominates completely. GCov of the two channels recovers the clock. Measured: at tau0 the single
    channel reads ~5.4x the true clock while GCov lands within a few percent.
    """
    clock, ch1, ch2 = _shared_clock_two_channels()
    true = allan.adev(clock, TAU0)[0]["adev"]
    one = allan.adev(ch1, TAU0)[0]["adev"]
    g = allan.gcov(ch1, ch2, TAU0)[0]["gdev"]
    assert one > 3.0 * true, f"ADEV should be badly inflated by the planted noise, got {one} vs {true}"
    assert g == pytest.approx(true, rel=0.10), f"GCov should recover the clock, got {g} vs {true}"


def test_gcov_of_two_INDEPENDENT_series_collapses_toward_zero():
    """ANTI-VACUITY. If GCov returned something like a variance regardless of its second argument, the
    test above would pass for the wrong reason. Two series sharing NOTHING must give ~0, not ~ADEV."""
    rng = random.Random(9)
    a = [rng.gauss(0, 1) for _ in range(N)]
    b = [rng.gauss(0, 1) for _ in range(N)]
    g = allan.gcov(a, b, TAU0)[0]
    solo = allan.adev(a, TAU0)[0]["adev"]
    assert abs(g["gdev"]) < 0.2 * solo, f"{g['gdev']} is not small against {solo}"


def test_gcov_may_be_NEGATIVE_and_is_returned_unclamped():
    """A covariance is not a variance. Vernotte & Lantz measure P(estimate < 0) as high as 47.5 % when a
    clock is masked by less-stable partners, so negative is an ordinary outcome meaning "below the noise
    of this comparison" — clamping it to zero would report a floor that was never measured."""
    rng = random.Random(4)
    x = [rng.gauss(0, 1) for _ in range(4000)]
    anti = [-v for v in x]
    g = allan.gcov(x, anti, TAU0)[0]
    a = allan.adev(x, TAU0)[0]["adev"]
    assert g["gcov"] == pytest.approx(-(a ** 2), rel=1e-12)
    assert g["gcov"] < 0 and g["gdev"] < 0


def test_gdev_is_the_SIGNED_root_so_it_can_share_an_axis_with_adev():
    clock, ch1, ch2 = _shared_clock_two_channels()
    for p in allan.gcov(ch1, ch2, TAU0):
        assert p["gdev"] == pytest.approx(math.copysign(math.sqrt(abs(p["gcov"])), p["gcov"]), rel=1e-12)


def test_gcov_REFUSES_unequal_lengths_rather_than_zipping_to_the_shorter():
    """Two streams of different length are not on one grid. Truncating would compare different instants
    while returning a perfectly well-formed number."""
    rng = random.Random(2)
    a = [rng.gauss(0, 1) for _ in range(4000)]
    assert allan.gcov(a, a[:-1], TAU0) == []


def test_a_nan_in_ONE_series_cannot_misalign_the_pair():
    """The trap `_clean_pair` exists for. Cleaning separately drops index i from one series only, which
    shifts every later sample of that series against the other by one — a covariance between different
    instants, with nothing raised. Dropping the position from BOTH is the only correct answer, and the
    result must equal simply omitting that position from both up front."""
    rng = random.Random(6)
    a = [rng.gauss(0, 1) for _ in range(4000)]
    b = [rng.gauss(0, 1) for _ in range(4000)]
    holed = list(a)
    holed[1500] = float("nan")
    expect = allan.gcov(a[:1500] + a[1501:], b[:1500] + b[1501:], TAU0)
    assert allan.gcov(holed, b, TAU0) == expect
    # …and that is NOT what cleaning the two separately would have produced
    assert allan.gcov(holed, b, TAU0) != allan.gcov(a, b, TAU0)


def test_gcov_refuses_a_series_too_short_or_a_zero_tau0():
    assert allan.gcov([1.0, 2.0], [1.0, 2.0], TAU0) == []
    assert allan.gcov([1.0, 2.0, 3.0, 4.0], [1.0, 2.0, 3.0, 4.0], 0) == []


def test_gcov_honours_explicit_taus_and_skips_impossible_ones():
    rng = random.Random(8)
    a = [rng.gauss(0, 1) for _ in range(4000)]
    b = [rng.gauss(0, 1) for _ in range(4000)]
    got = allan.gcov(a, b, TAU0, [2.0, 0.4, 1e9])
    assert [p["tau"] for p in got] == [2.0]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# LAG-1 NOISE IDENTIFICATION (Riley & Greenhall 2004) — a second opinion that fits no slope.
# `classify` reads a fitted log-log slope, so near a boundary it must REFUSE. This identifies the power
# law analytically from the lag-1 autocorrelation, so it has no boundary to sit near.
# ══════════════════════════════════════════════════════════════════════════════════════════════════


def _flicker_fm(seed=13):
    """Flicker FM: integrate pink noise. alpha = -1."""
    p, v, out = _flicker_pm(seed), 0.0, []
    for q in p:
        v += q
        out.append(v)
    return out


def test_lag1_recovers_the_WHOLE_power_law_family():
    """THE known-answer test, and the reason this is worth having: `allan.py` had no external reference
    for its noise naming. AllanTools implements the same identification, so these five are checkable
    rather than re-derived. Each series is synthesised to a known alpha and must come back as it."""
    cases = ((_white_pm(), 2, 'white-phase'), (_flicker_pm(), 1, 'flicker-phase'),
             (_white_fm(), 0, 'white-frequency'), (_flicker_fm(), -1, 'flicker-frequency'),
             (_rw_fm(), -2, 'random-walk-frequency'))
    for series, alpha, name in cases:
        got = allan.noise_id(series)
        assert got is not None, name
        assert got['alpha'] == alpha, f"{name}: expected alpha {alpha}, got {got}"
        assert got['noise'] == name, got


def test_lag1_ANSWERS_where_the_slope_classifier_must_refuse():
    """The operational payoff. `classify` refuses when 1.96*se straddles a boundary — correctly, because
    a fitted slope cannot support the call there. An estimator that fits no slope has no boundary, so it
    still answers. Both are published; disagreement is information."""
    refused = allan.classify(-0.75, 0.02)          # dead on an edge, CI straddling it
    assert refused['noise'] is None, refused        # the incumbent declines, by design
    got = allan.noise_id(_white_pm())
    assert got['noise'] == 'white-phase'            # the lag-1 identifier does not have to


def test_the_two_opinions_AGREE_on_an_unambiguous_series():
    """ANTI-VACUITY. An identifier that answered something unrelated to the slope classifier would be
    a second number, not a second opinion."""
    for series, expect in ((_white_fm(), 'white-frequency'), (_rw_fm(), 'random-walk-frequency')):
        st = allan.stability(series, TAU0)
        assert st['classification']['noise'] == expect
        assert st['lag1_noise']['noise'] == expect


def test_stability_publishes_the_second_opinion_beside_the_first():
    st = allan.stability(_white_pm(), TAU0)
    assert 'classification' in st and 'lag1_noise' in st
    assert st['lag1_noise']['noise'] == 'white-phase'
    # ADEV maps white PM and flicker PM to one arm; the lag-1 identifier separates them without MDEV.
    assert st['classification']['noise'] == 'white/flicker-phase'


def test_a_series_too_short_to_identify_returns_None_rather_than_a_guess():
    assert allan.noise_id([1.0, 2.0, 3.0]) is None
    assert allan.noise_id([]) is None


def test_it_gives_up_rather_than_differencing_a_series_into_nothing():
    """Each difference eats a sample. A short, strongly correlated series would decorrelate only after
    more differences than it has samples for — None, not an answer from four points."""
    # A cubic stays correlated through two differences: 34 -> 33 -> 32 (still a linear ramp, rho ~ 0.5)
    # -> 31, below the 32-sample floor. So it runs out before it decorrelates, and must say so.
    cubic = [float(i) ** 3 for i in range(34)]
    assert allan.noise_id(cubic, dmax=99) is None
    # …while the same shape with room to spare does identify.
    assert allan.noise_id([float(i) ** 3 for i in range(4096)], dmax=99) is not None


def test_alpha_is_clamped_to_the_five_named_laws():
    """Outside [-2, +2] the series is not one of the five this names; inventing a sixth label would be
    naming something it did not measure."""
    for series in (_white_pm(), _flicker_pm(), _white_fm(), _flicker_fm(), _rw_fm(), _drift()):
        got = allan.noise_id(series)
        if got is not None:
            assert -2 <= got['alpha'] <= 2, got
            assert got['noise'] in allan._ALPHA_NAMES.values()


def test_the_slope_classifier_and_its_TABLE_are_untouched_by_this_addition():
    """The three-lane parity gate (#1334) holds `_NOISE` equal across clock.js / ppgdex-dsp.js / here.
    This addition must not move it, or the lanes would be running different algorithms."""
    assert allan._NOISE[0][1] == 'white/flicker-phase'
    assert [e[0] for e in allan._NOISE] == [-0.75, -0.25, 0.25, 0.75]
    assert allan.classify(-1.0)['noise'] == 'white/flicker-phase'


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# MTIE — the PEAK counterpart to TDEV's RMS (ITU-T G.810). Needed because `timing_uncertainty`
# summarised delivery jitter as IQR/1.349, which assumes a Gaussian tail, and the corpus has excess
# kurtosis +1901. At that shape there is no stable variance to summarise; MTIE needs no distribution.
# ══════════════════════════════════════════════════════════════════════════════════════════════════


def _naive_mtie(x, m):
    """The definition, directly: worst peak-to-peak inside any window of m+1 samples."""
    w = m + 1
    return max(max(x[i:i + w]) - min(x[i:i + w]) for i in range(len(x) - w + 1))


def test_mtie_of_a_ramp_is_EXACTLY_slope_times_tau():
    """A steady rate walks the phase linearly, so the worst window is any window: slope * tau, exactly.
    This also pins the caveat that MTIE — unlike ADEV — is NOT blind to a constant frequency offset."""
    ramp = [3.0 * i for i in range(600)]
    for m in (1, 4, 16, 64):
        got = allan.mtie(ramp, TAU0, [float(m)])[0]["mtie"]
        assert got == pytest.approx(3.0 * m, abs=1e-9), f"tau={m}: {got}"


def test_a_planted_step_is_recovered_exactly():
    step = [0.0] * 300 + [42.0] * 300
    assert allan.mtie(step, TAU0, [8.0])[0]["mtie"] == pytest.approx(42.0, abs=1e-9)


def test_a_constant_series_has_no_time_interval_error():
    assert allan.mtie([7.0] * 500, TAU0, [16.0])[0]["mtie"] == 0.0


def test_the_BINARY_DECOMPOSITION_equals_the_definition():
    """Bregni & Maccabruni's fast form must give byte-identical answers to the O(N*W) definition, or the
    speed is bought with a different statistic. Seven taus, including non-powers-of-two."""
    rng = random.Random(5)
    x = [rng.gauss(0, 1) for _ in range(2000)]
    for m in (1, 3, 7, 16, 33, 64, 129):
        assert allan.mtie(x, TAU0, [float(m)])[0]["mtie"] == pytest.approx(_naive_mtie(x, m), abs=1e-12)


def test_mtie_is_monotonically_non_decreasing_in_tau():
    """A longer window CONTAINS every shorter one, so it cannot report less. That is what makes it a
    bound rather than an average, and a decreasing point would mean the window logic is wrong."""
    rng = random.Random(9)
    x = [rng.gauss(0, 1) for _ in range(2000)]
    curve = allan.mtie(x, TAU0)
    assert len(curve) >= 3
    for i in range(len(curve) - 1):
        assert curve[i]["mtie"] <= curve[i + 1]["mtie"] + 1e-12


def test_flat_separates_ONE_STALL_from_accumulating_drift():
    """The diagnostic that changes what you would do. A single excursion fills every window, so short
    and long agree; a random walk grows with tau. Measured: spike 500/500 flat, walk 3.7 -> 44.1."""
    spike = [0.0] * 1500 + [500.0] + [0.0] * 1499
    assert allan.stability(spike, TAU0)["mtie"]["flat"] is True
    rng = random.Random(3)
    v, walk = 0.0, []
    for _ in range(3000):
        v += rng.gauss(0, 1)
        walk.append(v)
    m = allan.stability(walk, TAU0)["mtie"]
    assert m["flat"] is False
    assert m["ms"] > m["ms_short"] * 5


def test_mtie_refuses_what_it_cannot_measure():
    assert allan.mtie([1.0], TAU0) == []
    assert allan.mtie([1.0, 2.0, 3.0], 0) == []
    assert allan.mtie([1.0, 2.0, 3.0], TAU0, [1e9]) == []
    assert allan._mtie_summary([]) is None


def test_stability_publishes_the_peak_view_beside_the_rms_one():
    """Both, never one: on the corpus they disagree by ~70x (85 ms RMS-style vs a 5757 ms worst case),
    and G.810 specifies both because they answer different questions."""
    st = allan.stability(_white_fm(), TAU0)
    assert st["mtie"] is not None and st["mtie"]["ms"] > 0
    assert "classification" in st and "curve" in st
