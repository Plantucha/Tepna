# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Offset and skew between two clocks, from ONE-SIDED delay measurements.

`PAT-PACKET-ARRIVAL` §4 records `(host arrival, device timestamp)` per packet so the per-connection BLE
offset becomes measurable. This module is the estimator that spends those pairs. It implements two
PUBLISHED estimators rather than a third hand-rolled one, because the hand-rolled one already failed
here twice — `floor_ms` in `writers.py` is a bare low quantile, and the per-sample attempt it replaced
produced a confident answer from a smeared edge.

THE STRUCTURE BEING EXPLOITED. Every error term between the two columns is one-sided POSITIVE:

  * BLE buffering — a packet can be late, never early;
  * counter quantisation — the O2Ring reports whole seconds, so the value it reports is at or below the
    true device time, which makes the measured delay at or ABOVE the true delay.

Two different physical causes, one sign. So the true relationship is the LOWER ENVELOPE of the delay
cloud, and both estimators below find that envelope. One estimator therefore serves both legs.

⚠️ CORRECTION TO `PAT-PACKET-ARRIVAL` §6, which justified fitting the ring on the grounds that "a
minimum over a quantised counter returns the quantum". Measured, it does not: the quantisation residual
depends on where each frame falls between ticks, and over a recording it comes near enough to 0 that a
minimum still finds the edge — worst error 31.5 ms over 270 zero-skew configurations, i.e. 3.2% of the
1000 ms quantum, not the quantum.

THE ACTUAL REASON TO FIT, on every device and not just the ring, is that a minimum has NO TIME MODEL.
It returns one number for a quantity that moves across the recording, so it is wrong by roughly half
the span's drift. Measured on a real 8 h H10 capture that is 242 ms; on the ring at the 55 ppm §6
reports, 705 ms. PAT's budget is 10 ms.

  * `lower_envelope` — Moon et al., *Estimation and Removal of Clock Skew from Network Delay
    Measurements* (UMass CS-1998-043): the line lying below all points, as close as possible. Stated as
    a linear program; solved here EXACTLY and without a solver, see that function.
  * `paxson` — Paxson's estimator: partition into subsets, take each subset's MINIMUM, then a robust
    (Theil-Sen) slope through those minima.

THEY ARE KEPT AS TWO BECAUSE EACH FAILS WHERE THE OTHER DOES NOT, AND THE DISAGREEMENT IS THE ERROR BAR.

  * The envelope is exact but NOT robust: it constrains the line to lie below EVERY point, so a single
    anomalously early packet — a scheduling artifact, a chrony step — redefines the whole fit. Measured
    on planted data, one point 500 ms early moved it by 818 ms while Paxson moved by 1.0 ms.
  * Paxson is robust but not always precise: over 9600 planted configurations its worst error was
    614 ms, in the hard corner (few points, heavy jitter AND quantisation together).

So neither is trustworthy alone, and picking a winner internally would need a threshold that the sweep
above shows cannot be derived. Instead BOTH are computed and a single `offset_ms` is published ONLY
where they agree. Measured over 19200 configurations, half carrying a planted early outlier: of those
certified, LP error was p99 6.08 ms and worst 15.93 ms, and **not one** outlier-carrying configuration
was ever certified. Certification rate is 48% across the whole sweep including brutal corners, and 77%
in the regime a real night occupies (n>=2000 over 8 h, jitter <=30 ms).

⚠️ Agreement within `AGREE_MAX_MS` is a CORRELATE of accuracy, not a bound on it — the worst certified
error above is 15.93 ms against a 10 ms agreement. Quote it that way.

Deliberately dependency-free: this box runs three packages (bleak, PyYAML, aiohttp) and has no
numpy/scipy. `ruptures`/`scipy.optimize` would each solve a piece of this and neither is worth the
install on a Pi-class capture host.
"""

# The refusal thresholds. Each mirrors an existing house constant rather than inventing a number.
MIN_POINTS = 100          # as `writers.PmdArrivalLogWriter.floor_ms` — too few to have an edge at all
SPAN_MIN_SEC = 2400.0     # as `ecgdex-dsp.js` span-gates its fs correction: a rate needs a baseline
MAX_PPM = 50000.0         # as `CK_AXIS_MAX_PPM` (Clock Contract §7) — beyond 5% these are not two clocks
PAXSON_SUBSETS = 20       # with MIN_POINTS=100 that is >=5 points per subset minimum
AGREE_MAX_MS = 10.0       # the precision PAT needs. NOT a claim about what the estimators achieve.


def _clean(points):
    """`(t_sec, delay_ms)` pairs: finite only, sorted by t.

    Nothing is defaulted. A non-finite member drops the pair rather than becoming a 0 — same rule as
    `hostAxis`'s anchors and as the sidecar's blank-never-zero columns.
    """
    out = []
    for t, d in points:
        try:
            tf, df = float(t), float(d)
        except (TypeError, ValueError):
            continue   # a pair that will not parse cannot constrain a FIT; the estimator reports
                       # the n it actually used, so dropping it narrows the claim, not the truth
        if tf == tf and df == df and abs(tf) != float("inf") and abs(df) != float("inf"):
            out.append((tf, df))
    out.sort()
    return out


def _floor_by_t(pts):
    """One point per distinct t, carrying that t's MINIMUM delay.

    Only the minimum at each t can ever be an active constraint of the envelope, so the others cannot
    change WHERE the line lies. They do still change the objective (they weight that t), which is why
    the caller keeps `n` and `sum_t` over the ORIGINAL set and passes them in separately.
    """
    out = []
    for t, d in pts:                      # pts is sorted, so equal t are adjacent
        if out and out[-1][0] == t:
            if d < out[-1][1]:
                out[-1] = (t, d)
        else:
            out.append((t, d))
    return out


def _lower_hull(pts):
    """Lower convex hull of `pts` (sorted, distinct t) by Andrew's monotone chain."""
    hull: list[tuple[float, float]] = []
    for p in pts:
        while len(hull) >= 2:
            (ox, oy), (ax, ay) = hull[-2], hull[-1]
            # cross > 0 is a counter-clockwise turn, which the lower hull keeps
            if (ax - ox) * (p[1] - oy) - (ay - oy) * (p[0] - ox) > 0:
                break
            hull.pop()
        hull.append(p)
    return hull


def lower_envelope(pts, n_total=None, sum_t=None):
    """Moon et al.: the line `d = a*t + b` lying below every point, as close as possible.

    As an LP: maximize `a*sum(t) + N*b` subject to `a*t_i + b <= d_i` for all i (equivalently, minimize
    the summed residual `sum(d_i - a*t_i - b)`, which is that objective plus the constant `sum(d)`).

    IT NEEDS NO SOLVER. The feasible set is an intersection of half-planes in the two unknowns, and the
    objective's gradient has both components non-negative, so the optimum sits at a VERTEX — two
    constraints active — i.e. a line through two of the points that lies below all the rest. Those pairs
    are exactly the edges of the points' LOWER CONVEX HULL, so the whole LP reduces to a hull walk plus
    one pass over its edges. Exact, O(n) on already-sorted input, no dependency, nothing to tune.

    NO PRECONDITION ON THE ORIGIN OF t. An earlier draft of this docstring claimed `t >= 0` was required
    for boundedness and `estimate` shifted to satisfy it. Measured, the shift changed nothing: the summed
    residual is a property of the LINE, and a line's residuals do not depend on where the coordinate
    origin sits, so the hull-edge argmin is origin-independent. Verified across shifts of 0, +1.786e9 and
    -1e6 — identical slope to nine decimals, identical line. The shift was deleted.

    Returns `(a_ms_per_sec, b_ms)` or None if every point shares one t (no line is determined).
    """
    hull = _lower_hull(_floor_by_t(pts))
    if len(hull) < 2:
        return None
    n = len(pts) if n_total is None else n_total
    st = sum(t for t, _ in pts) if sum_t is None else sum_t
    best = None
    for i in range(len(hull) - 1):
        (t1, d1), (t2, d2) = hull[i], hull[i + 1]
        a = (d2 - d1) / (t2 - t1)
        b = d1 - a * t1
        obj = a * st + n * b
        if best is None or obj > best[0]:
            best = (obj, a, b)
    return (best[1], best[2])


def _median(vals):
    s = sorted(vals)
    m = len(s) // 2
    return s[m] if len(s) % 2 else 0.5 * (s[m - 1] + s[m])


def paxson(pts, n_subsets=PAXSON_SUBSETS):
    """Paxson's estimator: per-subset minima, then a Theil-Sen slope through them.

    The subsets are contiguous in time and equal in COUNT (not in duration), so a stretch that delivered
    more packets does not get more say in the slope than one that delivered fewer.

    Theil-Sen — the median of all pairwise slopes — rather than least squares, for the same reason the
    Clock Contract's `hostAxis` uses a running median and not a fit: one anomalous minimum (a scheduling
    artifact, a chrony step) moves a least-squares line and nothing says so.

    Returns `(a_ms_per_sec, b_ms)` or None where fewer than two subsets have distinct t.
    """
    k = max(2, min(n_subsets, len(pts)))
    mins = []
    for i in range(k):
        lo = (i * len(pts)) // k
        hi = ((i + 1) * len(pts)) // k
        chunk = pts[lo:hi]
        if not chunk:
            continue                       # an empty stripe when k > len(pts) cannot contribute a minimum
        mins.append(min(chunk, key=lambda p: p[1]))
    slopes = [
        (mins[j][1] - mins[i][1]) / (mins[j][0] - mins[i][0])
        for i in range(len(mins))
        for j in range(i + 1, len(mins))
        if mins[j][0] != mins[i][0]
    ]
    if not slopes:
        return None
    a = _median(slopes)
    return (a, _median([d - a * t for t, d in mins]))


def estimate(points):
    """Offset and skew from `(t_sec, delay_ms)` pairs, by both estimators, with their disagreement.

    A refusal returns `{"ok": False, "reason", "n"}` and NO estimate — the `hostAxis` contract, and for
    its reason: a caller must not be able to read a silent zero out of a measurement that was declined.

    On success every offset is quoted at `t_ref_sec`, the MEAN of t, not at t=0. The intercept of a
    fitted line is its most leveraged point; the centroid is its best-determined one, and the two differ
    by the whole span times the slope error. Both estimators are quoted at the same t so `agree_ms`
    compares like with like, and `t_ref_sec` ships so a consumer can reconstruct the line rather than
    mistaking a centroid value for the offset at the start of the recording.

    `offset_ms` is the certified number and is **None** wherever the two estimators disagree. That is the
    point of computing two: neither is trustworthy alone (see the module docstring), so an uncertified
    night must not be able to hand a consumer a plausible-looking float. The per-estimator values stay
    visible for diagnosis.

    `skew_quotable` is separate from `ok` on purpose. Below `SPAN_MIN_SEC` the offset is still usable —
    it is what the envelope measured — while the ppm is a rate quoted off too short a baseline, which is
    the error the Clock Contract calls out by name (the same H10 reads -20.3 ppm over 373 min and -65.8
    over 10.9). So the offset ships and the rate is marked, rather than the whole estimate being lost.
    """
    pts = _clean(points)
    n = len(pts)
    if n < MIN_POINTS:
        return {"ok": False, "reason": "too-few", "n": n}

    # No shift and no separate span guard, both deleted after the mutation gate showed them inert:
    #   * shifting t to 0 changed NOTHING. The summed residual is a property of the LINE, not of the
    #     coordinate origin, so the hull-edge argmin is origin-independent by construction — verified
    #     over shifts of 0, +1.786e9 and -1e6, identical slope to 9 decimals and identical line.
    #   * `if span <= 0` was unreachable as a distinct outcome: all-equal t collapses to one point in
    #     `_floor_by_t`, so the hull has < 2 vertices and the `env is None` arm below returns the same
    #     `no-span` refusal. Two guards for one condition, and the mutant that deleted either survived.
    span = pts[-1][0] - pts[0][0]
    t_ref = sum(t for t, _ in pts) / n
    env = lower_envelope(pts)
    pax = paxson(pts)
    if env is None or pax is None:
        return {"ok": False, "reason": "no-span", "n": n}

    ppm = env[0] * 1000.0                  # ms per s -> parts per million
    if abs(ppm) > MAX_PPM:
        # Past 5% these two columns are not the two clocks we think they are — a misparse, a unit
        # mismatch, a shifted column. Correcting by that much fabricates a timebase. Refuse, as
        # `hostAxis` does, rather than clamping into a plausible-looking number.
        return {"ok": False, "reason": "implausible-skew", "n": n, "slope_ppm": round(ppm, 1)}

    off_env = env[0] * t_ref + env[1]
    off_pax = pax[0] * t_ref + pax[1]
    agree = abs(off_env - off_pax)
    certified = bool(agree <= AGREE_MAX_MS)
    return {
        "ok": True,
        "n": n,
        "span_sec": round(span, 1),
        "t_ref_sec": round(t_ref, 1),
        # The certified answer, or None. Never a number that only one estimator stands behind.
        "offset_ms": round(off_env, 3) if certified else None,
        "offset_envelope_ms": round(off_env, 3),
        "offset_paxson_ms": round(off_pax, 3),
        "agree_ms": round(agree, 3),
        "certified": certified,
        # The envelope's slope: it uses every point, where Paxson's uses only the subset minima.
        "slope_ppm": round(ppm, 2),
        "skew_quotable": bool(span >= SPAN_MIN_SEC),
    }
