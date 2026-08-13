# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""`allan` — clock stability as a curve.

Known-answer tests against SYNTHESISED series whose noise type is known by construction, because the
whole value of this module is that the slope names a mechanism. A test that only checked "it returns a
number" would pass against a classifier that cannot tell drift from jitter — which is the one thing it
exists to do, so the separation is asserted explicitly.
"""
from __future__ import annotations

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
