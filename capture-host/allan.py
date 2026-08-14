# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Allan deviation — clock stability as a CURVE, because a single ppm is not an answer.

THE PROBLEM THIS REPLACES. Three clock analyses in one session reached wrong or unsafe conclusions by
asking "does this drift?" with ad-hoc statistics: SD of block means against sigma/sqrt(N), halves fitted
and compared, a bare ppm. Allan built this estimator precisely because **standard deviation DIVERGES for
these noise types as the sample count grows** (NIST/Riley, Handbook of Frequency Stability Analysis), so
every one of those answers depended on how much data happened to be in hand.

Clock Contract §7 already says "never quote a `ppm` without the span beside it", and notes the H10
reading -20.3 ppm over 373 min against -65.8 over 10.9. That IS a sigma_y(tau) curve reported as two
disconnected anecdotes. This computes the curve.

WHAT THE SLOPE MEANS — the reason this is worth having, since it names a MECHANISM rather than a number:

    sigma_y(tau) ~ tau^-1     white / flicker PHASE      jitter; averages away fast
    sigma_y(tau) ~ tau^-1/2   white FREQUENCY            the benign case; averaging helps as sqrt(N)
    sigma_y(tau) ~ tau^0      flicker frequency          A FLOOR — more averaging buys nothing
    sigma_y(tau) ~ tau^+1/2   random-walk frequency      wanders; a long fit is WORSE than a short one
    sigma_y(tau) ~ tau^+1     deterministic drift        fit and remove it; never average through it

The flat and rising regions are the operationally important ones: they say where averaging stops
helping, which is the question "5-minute windows or the whole night?" asked three times in one session
and never once answered on principle.

INPUT IS A PHASE SERIES. `arrival - device` per packet is a time-error (phase) series in ms, which is
ADEV's native input — nothing new needs capturing.

OVERLAPPING estimator, not the plain one: it uses every available sample triple at each tau rather than
disjoint blocks, which is the standard choice for real data and has far better confidence at long tau
where samples are scarce. Deliberately dependency-free (this box runs three packages, no numpy).
"""

import math

# Below this the second difference has too few terms for the estimate to mean anything. The estimator
# needs N > 2m, and a handful of terms produces a number with a confidence interval wider than the
# answer — the failure mode this module exists to stop.
_MIN_TERMS = 8
# A tau is only reported when the series spans at least this many of them, for the same reason.
_MIN_SPAN_MULTIPLE = 4.0


def adev(phase, tau0, taus=None):
    """Overlapping Allan deviation of a PHASE (time-error) series.

    `phase` — time error per sample, in any one unit (ms here); `tau0` — the sample interval in the SAME
    time unit as the taus you want back. Returns `[{tau, adev, n}]`, ascending, omitting every tau the
    series cannot support rather than reporting a thin one.

    The overlapping estimator, from the second difference of phase:

        sigma_y(tau) = sqrt( 1 / (2 (N-2m) tau^2) * SUM_i (x[i+2m] - 2 x[i+m] + x[i])^2 )

    with tau = m * tau0. The second difference is what makes this insensitive to a constant offset AND
    to a constant rate: only CURVATURE survives it, which is why a bare frequency offset (our 875.7 ms
    inter-device constant, or a -20.86 ppm rate) does not show up here at all. That is the point —
    those are separately measured and removable; this measures what is left.
    """
    x = [float(v) for v in phase if v is not None and v == v and abs(v) != float("inf")]
    n = len(x)
    if n < 3 or not tau0 or tau0 <= 0:
        return []
    if taus is None:
        taus = _octave_taus(n, tau0)
    out = []
    for tau in taus:
        m = int(round(tau / tau0))
        if m < 1:
            continue
        terms = n - 2 * m
        if terms < _MIN_TERMS:
            continue
        acc = 0.0
        for i in range(terms):
            d = x[i + 2 * m] - 2.0 * x[i + m] + x[i]
            acc += d * d
        t = m * tau0
        out.append({"tau": t, "adev": math.sqrt(acc / (2.0 * terms)) / t, "n": terms})
    return out


def _octave_taus(n, tau0):
    """Octave-spaced averaging times — the conventional sampling of the curve, and enough to read a
    slope from. Stops where fewer than `_MIN_SPAN_MULTIPLE` independent spans remain."""
    out = []
    m = 1
    while (n - 2 * m) >= _MIN_TERMS and m <= n / (2.0 * _MIN_SPAN_MULTIPLE):
        out.append(m * tau0)
        m *= 2
    return out


def slope(points):
    """Log-log slope of sigma_y(tau), by least squares. None when fewer than three taus.

    The slope IS the noise identification, so it is reported as a number and classified separately —
    a caller that wants to argue with the boundaries can read the slope itself.
    """
    pts = [p for p in (points or []) if p.get("adev", 0) > 0 and p.get("tau", 0) > 0]
    if len(pts) < 3:
        return None
    xs = [math.log10(p["tau"]) for p in pts]
    ys = [math.log10(p["adev"]) for p in pts]
    k = len(xs)
    mx = sum(xs) / k
    my = sum(ys) / k
    den = sum((v - mx) ** 2 for v in xs)
    if den <= 0:
        return None
    return sum((xs[i] - mx) * (ys[i] - my) for i in range(k)) / den


def slope_se(points):
    """Standard error of the log-log slope, or None when fewer than three taus.

    LOWER BOUND, not an estimate: overlapping ADEV points are correlated (adjacent taus reuse most of
    the same samples) while this OLS residual assumes independence. It is used to decide whether a
    noise TYPE is supportable, where being conservative is the safe direction.
    """
    pts = [p for p in (points or []) if p.get("adev", 0) > 0 and p.get("tau", 0) > 0]
    if len(pts) < 3:
        return None
    xs = [math.log10(p["tau"]) for p in pts]
    ys = [math.log10(p["adev"]) for p in pts]
    k = len(xs)
    mx = sum(xs) / k
    my = sum(ys) / k
    sxx = sum((v - mx) ** 2 for v in xs)
    if sxx <= 0:
        return None
    b = sum((xs[i] - mx) * (ys[i] - my) for i in range(k)) / sxx
    a = my - b * mx
    ss = sum((ys[i] - (a + b * xs[i])) ** 2 for i in range(k))
    return math.sqrt(ss / (k - 2) / sxx)


# Slope midpoints between the canonical exponents (-1, -0.5, 0, +0.5, +1). A measured slope is assigned
# to the nearest canonical value; the boundaries are the midpoints, so nothing is favoured. Drift is the
# open-ended top and so sits OUTSIDE the table rather than carrying a `+inf` edge — an edge no slope can
# fail makes the fall-through unreachable, and an unreachable arm is removed here, never tested.
_NOISE = (
    (-0.75, "white/flicker-phase", "jitter — averages away fast"),
    (-0.25, "white-frequency", "benign; averaging helps as sqrt(N)"),
    (0.25, "flicker-frequency", "A FLOOR — more averaging buys nothing"),
    (0.75, "random-walk-frequency", "wanders; a longer fit is worse than a short one"),
)
_DRIFT = ("drift", "deterministic — fit and remove it, never average through it")


def classify(sl, se=None, n_tau=None):
    """Name the dominant noise type from a log-log slope — or REFUSE to, when the fit cannot support it.

    The boundary test is a strict `<` against a POINT ESTIMATE. Without `se` that assigns a type the
    data may not justify: -0.7501 and -0.7500 fall either side of an edge while printing identically,
    and `meaning` flips between "averages away" and "helps as sqrt(N)" — the field a caller branches on.
    Given `se`, an edge within 1.96*se leaves `noise` as **None** and names the candidates instead.

    None, never a string like "ambiguous": a truthy sentinel passes the guard callers actually write
    (`if c["noise"]:`), which would reintroduce the bug inside its own fix.

    `slope` is returned UNROUNDED. Rounding in the DATA is what made the boundary case invisible — two
    records printing -0.75 with opposite types. Round at display.

    THE SE IS A LOWER BOUND. Overlapping ADEV points are correlated (adjacent taus reuse most of the
    same samples) while OLS assumes independent residuals, so the true uncertainty is wider. Do NOT
    tighten 1.96 to 1 SE believing that is more rigorous; it is less.

    WHY 1.96*SE AND NOT RILEY EDF. Equivalent degrees of freedom is a function of THE NOISE TYPE
    (SP 1065 tabulates df per noise process), so computing a confidence interval in order to DECIDE the
    noise type is circular exactly at a boundary. The honest forms are to iterate (assume a type ->
    EDF -> re-classify) or to test under each candidate; near an edge the iteration is least likely to
    settle, and a classification that does not converge is the same finding as a CI that straddles. So
    this conservative stand-in reaches the same verdict where it matters. Anyone implementing EDF must
    handle that circularity before claiming more precision.
    """
    if sl is None:
        return None
    name, meaning = _DRIFT
    for edge, nm, mn in _NOISE:
        if sl < edge:
            name, meaning = nm, mn
            break
    # se == 0 AND se is None both skip the refusal, and that is a DECISION rather than a fall-through.
    # They are not the same input and the record keeps them apart (`slope_se` is 0.0 vs None), but they
    # reach the same verdict for different reasons, so both reasons are written down:
    #   · None — no SE was supplied. The caller gets the pre-SE contract; refusing would break every
    #     existing caller for a distinction it never asked about.
    #   · 0.0  — the log-log points fall EXACTLY on a line (reachable: a noiseless tau^-1 series returns
    #     exactly 0.0). A perfect fit is a real answer, and refusing to name a type there would be
    #     refusing the one case where the exponent is known exactly.
    # ⚠️ It follows that 0.0 must NOT be read as "measured and perfectly certain" on real data: `ss > 0`
    # always for a capture, so a 0.0 here means a degenerate or synthetic input, and the SE is a LOWER
    # bound in any case. The number is published so a reader can see which they got.
    # `if se` rather than `se is not None and se > 0`: falsy covers BOTH None and 0.0, and `se` is a
    # sqrt so it is never negative. The longer form carried a redundant comparison whose `> 0` → `>= 0`
    # mutant was EQUIVALENT — at se == 0 the product is 0 either way, so nothing could observe it and no
    # test could kill it. A guard that cannot be wrong in a way anyone can see is better deleted.
    half = 1.96 * se if se else 0.0
    if half:
        edges = [e for e, _, _ in _NOISE]
        if any(sl - half < e < sl + half for e in edges):
            # ⚠️ REMAINING MUTATION SURVIVORS, recorded rather than left silent. The `<`/`>` strictness
            # in THIS loop (`sl - half <= e`, `sl + half >= lo`) survives the suite: killing it needs a
            # CI that straddles an edge AND touches a candidate boundary at exact float equality
            # simultaneously. The detection test above IS pinned at exact equality
            # (`test_a_CI_ENDING_exactly_on_an_edge_does_not_straddle_it`); this loop only decides WHICH
            # names are listed once a refusal has already been decided, so a boundary slip here widens
            # or narrows an advisory list, never flips a verdict. Judged not worth a constructed
            # double-exact fixture; `mutation (diff-scoped)` is advisory, not a required check.
            cands, lo = [], float("-inf")
            for e, nm, _ in _NOISE:
                if sl - half < e and sl + half > lo:
                    cands.append(nm)
                lo = e
            if sl + half > _NOISE[-1][0]:
                cands.append(_DRIFT[0])
            return {
                "slope": sl,
                "slope_se": se,
                "n_tau": n_tau,
                "noise": None,
                "candidates": cands,
                "meaning": "the slope sits within 1.96 SE of a category boundary — the noise TYPE is not supported by this fit; branch on `slope`, not on a label",
            }
    # `candidates` present-and-None on the success path too, matching the JS twin in clock.js. A key
    # that appears only on failure forces every caller into `.get()` and makes the two lanes' records
    # differently shaped for no reason — parity is the property the cross-lane gate protects.
    return {"slope": sl, "slope_se": se, "n_tau": n_tau, "noise": name, "candidates": None, "meaning": meaning}


def stability(phase, tau0):
    """The whole answer for one series: the curve, its slope, the noise type, and the BEST averaging time.

    `optimal_tau` is the tau minimising sigma_y — the averaging window a measurement built on this clock
    should actually use. That is the principled replacement for a window length chosen by intuition, and
    it is the number this module exists to produce. On a purely white-frequency clock it is simply the
    longest tau measured, and saying so is more honest than implying a minimum was found.
    """
    pts = adev(phase, tau0)
    if len(pts) < 3:
        return {"ok": False, "reason": "too-few-taus", "taus": len(pts)}
    sl = slope(pts)
    se = slope_se(pts)
    best = min(pts, key=lambda p: p["adev"])
    return {
        "ok": True,
        "taus": len(pts),
        "tau_min": pts[0]["tau"],
        "tau_max": pts[-1]["tau"],
        "adev_min": best["adev"],
        "optimal_tau": best["tau"],
        "at_longest": pts[-1]["adev"],
        "classification": classify(sl, se, len(pts)),
        # Published UNCONDITIONALLY, including when the type IS named — a caller with a wider tolerance
        # can then decide for itself rather than being forced to accept the default above.
        "slope_se": se,
        "curve": [{"tau": round(p["tau"], 4), "adev": p["adev"], "n": p["n"]} for p in pts],
    }
