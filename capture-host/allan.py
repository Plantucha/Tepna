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

# TDEV is Mod sigma_y scaled by tau/sqrt(3); computed once rather than per point.
_SQRT3 = math.sqrt(3.0)


def _clean(phase):
    """Finite samples only, as floats. Shared so every estimator rejects the same inputs — a family
    where one member silently accepted a NaN would report a curve the others could not reproduce."""
    return [float(v) for v in phase if v is not None and v == v and abs(v) != float("inf")]


# ── TERM COUNTS, one per estimator ────────────────────────────────────────────────────────────────
# Each estimator consumes a different amount of the series per tau, so each needs its own count. This
# is NOT bookkeeping: `_octave_taus` decides which taus to report from it, and reusing ADEV's count for
# MDEV/HDEV would offer averaging times those estimators cannot support — publishing exactly the thin,
# wide-CI number this module's docstring says it exists to refuse.
def _terms_adev(n, m):
    return n - 2 * m


def _terms_mdev(n, m):
    return n - 3 * m + 1


def _terms_hdev(n, m):
    return n - 3 * m


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
    x = _clean(phase)
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
        terms = _terms_adev(n, m)
        if terms < _MIN_TERMS:
            continue
        acc = 0.0
        for i in range(terms):
            d = x[i + 2 * m] - 2.0 * x[i + m] + x[i]
            acc += d * d
        t = m * tau0
        out.append({"tau": t, "adev": math.sqrt(acc / (2.0 * terms)) / t, "n": terms})
    return out


def _octave_taus(n, tau0, terms_at=None):
    """Octave-spaced averaging times — the conventional sampling of the curve, and enough to read a
    slope from. Stops where fewer than `_MIN_SPAN_MULTIPLE` independent spans remain.

    `terms_at(n, m)` is the estimator's own term count, defaulting to ADEV's. Passing it is what keeps
    each estimator from being offered a tau it cannot support (see the term-count block above)."""
    if terms_at is None:
        terms_at = _terms_adev
    out = []
    m = 1
    while terms_at(n, m) >= _MIN_TERMS and m <= n / (2.0 * _MIN_SPAN_MULTIPLE):
        out.append(m * tau0)
        m *= 2
    return out


def mdev(phase, tau0, taus=None):
    """Overlapping MODIFIED Allan deviation of a phase series (Allan & Barnes 1981; Riley SP 1065).

        Mod sigma_y^2(tau) = 1 / (2 m^2 tau^2 (N-3m+1))
                             * SUM_j [ SUM_{i=j}^{j+m-1} (x[i+2m] - 2 x[i+m] + x[i]) ]^2

    WHY THIS EXISTS ALONGSIDE `adev`, in one sentence: the inner average over m second-differences
    applies a software bandwidth that scales with tau, which SEPARATES WHITE PHASE NOISE FROM FLICKER
    PHASE NOISE — a distinction ADEV structurally cannot make, because both give it tau^-1. That is the
    entire reason to compute a second curve, and `identify()` is where the two are read together.

    ⚠️ Its slopes are NOT ADEV's. White PM is tau^-3/2 here against tau^-1 there. Classify an MDEV
    slope with `classify_mdev`; feeding it to `classify` names white PM as flicker PM every time.

    The inner sum is carried as a SLIDING WINDOW over the second differences. Written directly it is
    O(N*m) per tau and so O(N^2) over an octave ladder, which on a 25 000-sample night is minutes.
    """
    x = _clean(phase)
    n = len(x)
    if n < 4 or not tau0 or tau0 <= 0:
        return []
    if taus is None:
        taus = _octave_taus(n, tau0, _terms_mdev)
    out = []
    for tau in taus:
        m = int(round(tau / tau0))
        if m < 1:
            continue
        terms = _terms_mdev(n, m)
        if terms < _MIN_TERMS:
            continue
        d = [x[i + 2 * m] - 2.0 * x[i + m] + x[i] for i in range(n - 2 * m)]
        s = math.fsum(d[:m])
        acc = s * s
        for j in range(1, terms):
            s += d[j + m - 1] - d[j - 1]
            acc += s * s
        t = m * tau0
        out.append({"tau": t, "mdev": math.sqrt(acc / (2.0 * terms)) / (m * t), "n": terms})
    return out


def tdev(phase, tau0, taus=None):
    """TIME deviation — sigma_x(tau) = tau/sqrt(3) * Mod sigma_y(tau) (Allan, Weiss & Jespersen 1991).

    THE POINT: this is in TIME UNITS, not fractional frequency. ADEV answers "how stable is the
    oscillator"; TDEV answers "how much timing error does this clock contribute at this averaging
    time", which is the quantity an uncertainty budget actually needs and the one PAT is missing.

    Returns `[{tau, tdev, n}]` in the same unit as the input phase series (ms here).
    """
    return [{"tau": p["tau"], "tdev": p["tau"] * p["mdev"] / _SQRT3, "n": p["n"]} for p in mdev(phase, tau0, taus)]


def hdev(phase, tau0, taus=None):
    """Overlapping HADAMARD deviation (Baugh 1971; Hutsell 1995; Riley SP 1065).

        H sigma_y^2(tau) = 1 / (6 tau^2 (N-3m)) * SUM_i (x[i+3m] - 3 x[i+2m] + 3 x[i+m] - x[i])^2

    The THIRD difference, so it is insensitive to a linear frequency drift where ADEV's second
    difference is not. That is not academic here: the O2Ring's real error is large and non-linear
    (-3035 ppm decaying to -1622 ppm), and ADEV on a drifting clock reports the drift rather than the
    noise underneath it. Use this when `classify` returns `drift` and you need what is left.
    """
    x = _clean(phase)
    n = len(x)
    if n < 4 or not tau0 or tau0 <= 0:
        return []
    if taus is None:
        taus = _octave_taus(n, tau0, _terms_hdev)
    out = []
    for tau in taus:
        m = int(round(tau / tau0))
        if m < 1:
            continue
        terms = _terms_hdev(n, m)
        if terms < _MIN_TERMS:
            continue
        acc = 0.0
        for i in range(terms):
            d = x[i + 3 * m] - 3.0 * x[i + 2 * m] + 3.0 * x[i + m] - x[i]
            acc += d * d
        t = m * tau0
        out.append({"tau": t, "hdev": math.sqrt(acc / (6.0 * terms)) / t, "n": terms})
    return out


def slope(points, key="adev"):
    """Log-log slope of sigma_y(tau), by least squares. None when fewer than three taus.

    The slope IS the noise identification, so it is reported as a number and classified separately —
    a caller that wants to argue with the boundaries can read the slope itself.

    `key` selects which deviation column to fit, so the same estimator serves `adev`/`mdev`/`hdev`
    curves. It is LAST and optional, so every pre-existing caller is unchanged by construction.
    """
    pts = [p for p in (points or []) if p.get(key, 0) > 0 and p.get("tau", 0) > 0]
    if len(pts) < 3:
        return None
    xs = [math.log10(p["tau"]) for p in pts]
    ys = [math.log10(p[key]) for p in pts]
    k = len(xs)
    mx = sum(xs) / k
    my = sum(ys) / k
    den = sum((v - mx) ** 2 for v in xs)
    if den <= 0:
        return None
    return sum((xs[i] - mx) * (ys[i] - my) for i in range(k)) / den


def slope_se(points, key="adev"):
    """Standard error of the log-log slope, or None when fewer than three taus.

    LOWER BOUND, not an estimate: overlapping ADEV points are correlated (adjacent taus reuse most of
    the same samples) while this OLS residual assumes independence. It is used to decide whether a
    noise TYPE is supportable, where being conservative is the safe direction.
    """
    pts = [p for p in (points or []) if p.get(key, 0) > 0 and p.get("tau", 0) > 0]
    if len(pts) < 3:
        return None
    xs = [math.log10(p["tau"]) for p in pts]
    ys = [math.log10(p[key]) for p in pts]
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

# MDEV's canonical exponents, which are NOT ADEV's — and the difference IS why MDEV is computed.
# ADEV collapses white PM and flicker PM onto one tau^-1 arm and can never separate them; MDEV puts
# white PM at tau^-3/2, so the pair of slopes resolves what either alone cannot.
#
#   noise            ADEV      MDEV
#   white PM         tau^-1    tau^-3/2   <- the split
#   flicker PM       tau^-1    tau^-1     <-
#   white FM         tau^-1/2  tau^-1/2
#   flicker FM       tau^0     tau^0
#   random-walk FM   tau^+1/2  tau^+1/2
#
# Edges are the midpoints between adjacent exponents, as in `_NOISE`, so nothing is favoured; drift is
# the open-ended top and stays outside the table for the same reason it does there.
_NOISE_MDEV = (
    (-1.25, "white-phase", "jitter, uncorrelated sample to sample — averages away fastest"),
    (-0.75, "flicker-phase", "correlated jitter — averages away, but slower than white phase"),
    (-0.25, "white-frequency", "benign; averaging helps as sqrt(N)"),
    (0.25, "flicker-frequency", "A FLOOR — more averaging buys nothing"),
    (0.75, "random-walk-frequency", "wanders; a longer fit is worse than a short one"),
)


def classify(sl, se=None, n_tau=None, table=None):
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
    # `table` is optional and LAST, so every pre-existing caller keeps ADEV's table by construction.
    # An MDEV slope MUST be passed `_NOISE_MDEV` (use `classify_mdev`) — see the table's comment.
    noise = table or _NOISE
    name, meaning = _DRIFT
    for edge, nm, mn in noise:
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
        edges = [e for e, _, _ in noise]
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
            for e, nm, _ in noise:
                if sl - half < e and sl + half > lo:
                    cands.append(nm)
                lo = e
            if sl + half > noise[-1][0]:
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


def classify_mdev(sl, se=None, n_tau=None):
    """`classify` against MDEV's exponents rather than ADEV's.

    Exists so the caller cannot get this wrong by omission: passing an MDEV slope to bare `classify`
    is silently wrong (it names white PM as flicker PM), and a wrong label there is invisible because
    both are plausible answers for a wearable link.
    """
    return classify(sl, se, n_tau, _NOISE_MDEV)


# The one ADEV arm that is genuinely two noise types wearing one name, and the two MDEV names that
# split it. Derived from the tables rather than retyped, so a table edit cannot desynchronise them.
_PHASE_ADEV_NAME = _NOISE[0][1]
_PHASE_MDEV_NAMES = (_NOISE_MDEV[0][1], _NOISE_MDEV[1][1])


def identify(phase, tau0):
    """Read the ADEV and MDEV curves TOGETHER — the only way to name phase noise.

    ADEV maps BOTH white phase noise and flicker phase noise onto tau^-1, so its `white/flicker-phase`
    verdict is not one answer, it is two answers that ADEV cannot distinguish. MDEV separates them
    (tau^-3/2 vs tau^-1). This computes both curves and, only when ADEV has landed on that ambiguous
    arm AND MDEV has landed on one of the two it splits into, publishes the resolution as
    `phase_noise`.

    `phase_noise` is None whenever the pair does not license a split — including when either curve is
    too short to classify, or when either classifier REFUSED near a boundary. None rather than a
    string, for the reason `classify` documents: a truthy sentinel passes `if r["phase_noise"]:`,
    which is the guard callers actually write.

    Why it matters operationally: white phase noise averages away as tau^-3/2, flicker phase noise
    only as tau^-1. Told they are the same, you would under-estimate how much a longer window buys.
    """
    a = adev(phase, tau0)
    md = mdev(phase, tau0)
    a_cls = classify(slope(a), slope_se(a), len(a))
    m_cls = classify_mdev(slope(md, "mdev"), slope_se(md, "mdev"), len(md))
    resolved = None
    if a_cls and m_cls and a_cls["noise"] == _PHASE_ADEV_NAME and m_cls["noise"] in _PHASE_MDEV_NAMES:
        resolved = m_cls["noise"]
    return {"adev": a_cls, "mdev": m_cls, "phase_noise": resolved, "taus": {"adev": len(a), "mdev": len(md)}}


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
