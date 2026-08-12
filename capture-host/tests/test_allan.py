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
