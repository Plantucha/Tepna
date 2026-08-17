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


def _finite(v):
    """One definition of admissible, shared by the single- and paired-series cleaners below."""
    return v is not None and v == v and abs(v) != float("inf")


def _clean(phase):
    """Finite samples only, as floats. Shared so every estimator rejects the same inputs — a family
    where one member silently accepted a NaN would report a curve the others could not reproduce."""
    return [float(v) for v in phase if _finite(v)]


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


def _clean_pair(phase_x, phase_y):
    """Positions finite in BOTH series, as `(xs, ys)`.

    Cleaning the two separately would silently MISALIGN them, which is the one error this estimator
    cannot survive: `_clean` DROPS a non-finite sample, so a single NaN at index i in one series shifts
    every later sample of that series by one against the other, and the covariance is then taken
    between two different instants. It would not raise, and the result would look like a real number.
    """
    xs, ys = [], []
    for a, b in zip(phase_x, phase_y):
        if _finite(a) and _finite(b):
            xs.append(float(a))
            ys.append(float(b))
    return xs, ys


def gcov(phase_x, phase_y, tau0, taus=None):
    """Groslambert covariance — the AVAR of what two comparison series SHARE, rejecting what they don't.

    (Fest, Groslambert & Gagnepain 1983; Vernotte & Lantz, IEEE TUFFC 2018, Eq. 2.)

    AVAR squares one series, so it reports signal + that series' own measurement noise and cannot tell
    them apart. GCov multiplies TWO series instead: whatever they share survives the average, and
    whatever is independent between them is zero-mean and averages away. Vernotte & Lantz state the
    property directly — *"GCov is not polluted by the measurement noises since all cross-covariances are
    zero-mean"* — and that the two approaches are strictly equivalent when the counter noise is
    negligible. So the GAP between `adev` and `gcov` is a measurement OF the instrument noise.

    That is the open question here. `arrival - device` carries BLE transport on top of the oscillator, so
    every ADEV/TDEV this module reports on such a series is an UPPER BOUND on the clock. Two streams
    captured from the same device over the same link share that device's clock and carry independent
    per-packet transport noise, so GCov of the pair estimates the clock comparison with the transport
    removed.

        GCov(tau) = 1 / (2 (N-2m) tau^2) * SUM_i dx_i * dy_i,   dx_i = x[i+2m] - 2 x[i+m] + x[i]

    identical to `adev`'s normalisation with one factor replaced by the second series — so `gcov(x, x)`
    IS `adev(x)**2`, exactly, and that identity is the estimator's own regression test.

    ⚠️ **A covariance is not a variance and MAY BE NEGATIVE.** It is returned signed and unclamped. The
    paper measures P(estimate < 0) as high as 47.5 % when a clock is masked by less-stable partners, so a
    negative value here is an ordinary outcome meaning "below the noise of this comparison", NOT a bug and
    NOT zero. `gdev` is the signed root, `sign(g) * sqrt(|g|)`, published so a caller can compare it with
    `adev` on one axis; where it is negative it is not a deviation and must not be read as one.

    ⚠️ **THE INDEPENDENCE ASSUMPTION IS THE WHOLE ESTIMATOR, and it is the caller's to justify.** Two
    streams sharing one BLE connection may have their arrival jitter correlated by the connection event
    that delivered both, and any such correlation is retained rather than rejected — GCov cannot
    distinguish shared clock from shared measurement noise. It is a floor on the transport contribution,
    not a proof of one.

    Both series must be on the SAME grid with the same `tau0`. Unequal lengths REFUSE (`[]`) rather than
    zip to the shorter: two streams of different length are not aligned, and truncating one would compare
    different instants while looking like a result.
    """
    if len(phase_x) != len(phase_y):
        return []
    x, y = _clean_pair(phase_x, phase_y)
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
            dx = x[i + 2 * m] - 2.0 * x[i + m] + x[i]
            dy = y[i + 2 * m] - 2.0 * y[i + m] + y[i]
            acc += dx * dy
        t = m * tau0
        g = acc / (2.0 * terms) / (t * t)
        out.append({"tau": t, "gcov": g, "gdev": math.copysign(math.sqrt(abs(g)), g), "n": terms})
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


# ── MTIE — MAXIMUM TIME INTERVAL ERROR ──────────────────────────────────────────────────────────────
# TDEV (already here) is an RMS measure. MTIE is its PEAK counterpart, and ITU-T G.810 defines BOTH
# because one number cannot do both jobs: RMS answers "how much does it typically vary", MTIE answers
# "how far can it get, worst case, over this long".
#
# WHY IT IS NEEDED HERE, measured rather than assumed. `nightqc.timing_uncertainty` summarises delivery
# jitter as IQR/1.349, which assumes a Gaussian tail. The real corpus is nowhere near Gaussian — excess
# kurtosis +1901 (H10 acc), +1400 (H10 ecg), +124 (Verity ppg), against 0 for a normal. At that shape
# there is no stable variance to summarise, and the repo already makes exactly this argument for
# preferring ADEV over standard deviation. MTIE asks a question that needs no distribution at all.
#
# ⚠️ AN EARLIER ATTEMPT AT THIS PROBLEM WAS REJECTED BY THE DATA. Dual-Dirac RJ/DJ decomposition
# (INTERDISCIPLINARY-LITERATURE §7) models jitter as a BOUNDED deterministic part plus an unbounded
# random one, and BLE's connection interval looks like textbook bounded DJ. It does not fit: fitted DJ
# came out NEGATIVE on most real streams, and the kurtosis above says why — a dual-Dirac is flat-topped
# (negative excess kurtosis), these are single violently heavy-tailed peaks. The 7.5 ms interval bound
# is real but negligible beside delays measured in hundreds of ms. So the bounded/unbounded split was
# not shipped, and MTIE — which assumes neither — was.
#
# S. Bregni & S. Maccabruni, "Fast Computation of Maximum Time Interval Error by Binary Decomposition",
# IEEE Trans. Instrumentation and Measurement 49(6), Dec 2000; ITU-T G.810 (08/96) for the definition.
#
# The naive form is O(N*W) per window and a night is ~30 000 samples, so this uses the binary
# decomposition Bregni describes: a sparse table of range max/min over dyadic blocks, built once in
# O(N log N), after which every window is two O(1) lookups.


def _sparse_tables(x):
    """Dyadic range-max and range-min tables. `up[k][i]` covers `x[i : i+2**k]`."""
    n = len(x)
    ups, dns = [list(x)], [list(x)]
    k = 1
    while (1 << k) <= n:
        half = 1 << (k - 1)
        prev_u, prev_d = ups[-1], dns[-1]
        span = n - (1 << k) + 1
        ups.append([max(prev_u[i], prev_u[i + half]) for i in range(span)])
        dns.append([min(prev_d[i], prev_d[i + half]) for i in range(span)])
        k += 1
    return ups, dns


def mtie(phase, tau0, taus=None):
    """Maximum Time Interval Error of a PHASE series — the peak-to-peak spread inside the WORST window.

        MTIE(tau) = max over all windows of length tau of ( max(x) - min(x) ) within that window

    Returns `[{tau, mtie, n}]` ascending, in the same unit as `phase`. Monotonically non-decreasing in
    tau by construction — a longer window contains every shorter one — which is what makes it a BOUND
    rather than an average, and why its plot only ever rises.

    ⚠️ **IT IS A PEAK, SO IT NEVER AVERAGES AWAY AND ONE OUTLIER SETS IT.** That is the point, not a
    defect: it answers "how far could this have drifted over tau", and a single 5-second stall is a real
    thing that happened. Do not compare an MTIE against an RMS figure like TDEV and call one wrong —
    G.810 specifies both because they answer different questions.

    ⚠️ Unlike ADEV/TDEV it is NOT insensitive to a constant frequency offset: a steady rate error walks
    the phase, and MTIE reports that walk. On a series carrying a known offset, remove it first or read
    the result as "including the rate", never as noise.
    """
    x = _clean(phase)
    n = len(x)
    if n < 2 or not tau0 or tau0 <= 0:
        return []
    if taus is None:
        taus = _octave_taus(n, tau0)
    ups, dns = _sparse_tables(x)
    out = []
    for tau in taus:
        m = int(round(tau / tau0))
        if m < 1 or m + 1 > n:
            continue
        w = m + 1                       # a tau of m intervals spans m+1 samples
        # Largest dyadic block fitting the window. NO GUARD ON `k` BELOW: `w <= n` is enforced above,
        # so k = floor(log2(w)) <= floor(log2(n)) = len(ups) - 1 and the level always exists. A defensive
        # `if k >= len(ups)` here is unreachable, and this file removes unreachable arms rather than
        # testing them (see _NOISE's note on the open-ended top).
        blk = 1 << (w.bit_length() - 1)
        hi, lo = ups[w.bit_length() - 1], dns[w.bit_length() - 1]
        worst = 0.0
        for i in range(n - w + 1):
            j = i + w - blk             # two overlapping blocks cover the window exactly
            span = max(hi[i], hi[j]) - min(lo[i], lo[j])
            if span > worst:
                worst = span
        out.append({"tau": m * tau0, "mtie": worst, "n": n - w + 1})
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


# ── LAG-1 NOISE IDENTIFICATION (Riley & Greenhall 2004) ─────────────────────────────────────────────
# `classify` names a noise type from the SLOPE of a fitted log-log line, which is why it needs a
# `1.96*se` refusal band near a boundary and why a full Riley EDF treatment is circular (EDF is a
# function of the noise type you are trying to determine). This identifies the power law ANALYTICALLY,
# from the lag-1 autocorrelation, at any averaging factor, WITHOUT fitting a slope — so it has no
# boundary to sit near and no circularity to break.
#
# W. J. Riley (Symmetricom) & C. A. Greenhall (JPL), "Power law noise identification using the lag 1
# autocorrelation", Proc. 18th European Frequency and Time Forum, Guildford, 5-7 April 2004.
# Extended to overlapping samples by Zhou, Greenhall & Howe (2011).
#
# ⚠️ PUBLISHED BESIDE `classify`, NOT INSTEAD OF IT — deliberately. `#1334` pinned THREE implementations
# of the slope-threshold rule (`clock.js CK_ALLAN_NOISE`, `ppgdex-dsp.js ALLAN_NOISE`, `_NOISE` here)
# with a gate asserting the tables are equal. Replacing only the Python one would put the lanes on
# genuinely DIFFERENT ALGORITHMS rather than the same algorithm with different rounding — a divergence
# a table-equality gate structurally cannot express. `_NOISE` and `classify` are untouched here; this is
# a second, independent opinion a reader can compare against the first.
#
# ⚠️ TWO STATISTICS SHARE THE WORDS "lag-1 autocorrelation" AND THEY ARE NOT THE SAME.
# `METROLOGY-METHOD-ADOPTION` §5 celebrates a two-line lag-1 check that asks *is this series correlated
# at all* — a plain correlation test. This asks *which power law is this*. Same words, different
# question; citing the former as evidence for the latter would be wrong.
_ALPHA_NAMES = {
    2: "white-phase",
    1: "flicker-phase",
    0: "white-frequency",
    -1: "flicker-frequency",
    -2: "random-walk-frequency",
}


def _lag1_acf(x):
    """Lag-1 autocorrelation of a mean-removed series; 0 when the series has no variance."""
    n = len(x)
    m = sum(x) / n
    den = sum((v - m) ** 2 for v in x)
    if den <= 0:
        return 0.0
    num = sum((x[i] - m) * (x[i + 1] - m) for i in range(n - 1))
    return num / den


def noise_id(phase, dmax=3):
    """Identify the dominant power law from a PHASE series, analytically. `None` when too short.

    The algorithm difference the series until its lag-1 autocorrelation shows it has become
    uncorrelated, counting the differences:

        rho = r1 / (1 + r1);   difference while rho >= 0.25 (up to `dmax` times)
        alpha = round(-2*(rho + d) + 2)          # the +2 is because this is PHASE, not frequency

    KNOWN-ANSWER VALIDATED across the whole family — white PM +2, flicker PM +1, white FM 0, flicker FM
    -1, random-walk FM -2, each recovered from synthesised series of the corresponding type. That
    matters more than the derivation: AllanTools implements the same identification, so this has a real
    reference rather than a re-derivation, which is what `allan.py` was otherwise short of.

    Returns `{alpha, noise, differences, rho}`. `alpha` is clamped to [-2, +2]: outside that range the
    series is not one of the five power laws this names, and a sixth label would be invented rather
    than measured.
    """
    x = _clean(phase)
    if len(x) < 32:
        return None                      # differencing eats samples; a short series identifies nothing
    d = 0
    while True:
        r1 = _lag1_acf(x)
        rho = r1 / (1.0 + r1) if r1 != -1.0 else -1e9
        if rho < 0.25 or d >= dmax:
            raw = -2.0 * (rho + d) + 2.0
            alpha = int(round(raw))
            alpha = 2 if alpha > 2 else (-2 if alpha < -2 else alpha)
            return {"alpha": alpha, "noise": _ALPHA_NAMES[alpha],
                    "differences": d, "rho": round(rho, 4)}
        nxt = [x[i + 1] - x[i] for i in range(len(x) - 1)]
        if len(nxt) < 32:
            return None                  # ran out of samples before it decorrelated
        x = nxt
        d += 1


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
            # ✅ THE THREE SURVIVORS THIS COMMENT USED TO EXCUSE ARE NOW KILLED (2026-08-14).
            # It previously said the `<`/`>` strictness here (`sl - half <= e`, `sl + half >= lo`, and
            # `sl + half >= noise[-1][0]` below) needed "a CI that straddles an edge AND touches a
            # candidate boundary at exact float equality simultaneously", and judged that not worth a
            # constructed fixture. That was true about the requirement and wrong about the cost: a short
            # search over (slope, se) finds exact-float pairs satisfying both at once, and the fixtures
            # are three lines each — `sl=0.4952, se=0.13` puts the interval end exactly on the top edge
            # while genuinely straddling an inner one; `sl=-0.499904` and `sl=-0.500096` at se=0.1276
            # touch a candidate boundary exactly from below and from above.
            # The lesson is the reusable part: "unkillable" was an estimate of EFFORT, not a property of
            # the code, and it was never re-tested after being written down. Before excusing a survivor,
            # run the search — it is cheaper than the paragraph explaining why you did not.
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


def identify(phase, tau0, adev_points=None):
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

    `adev_points` — an ADEV curve already computed FOR THIS SERIES AND THIS tau0, supplied to avoid
    computing it twice. LAST and optional, so every existing caller is unchanged. It is not validated
    against `phase`: a curve from a different series would silently mis-pair the two classifications,
    so it is only ever passed by a caller that just computed it from the same inputs (see `stability`).
    """
    a = adev(phase, tau0) if adev_points is None else adev_points
    md = mdev(phase, tau0)
    a_cls = classify(slope(a), slope_se(a), len(a))
    m_cls = classify_mdev(slope(md, "mdev"), slope_se(md, "mdev"), len(md))
    resolved = None
    if a_cls and m_cls and a_cls["noise"] == _PHASE_ADEV_NAME and m_cls["noise"] in _PHASE_MDEV_NAMES:
        resolved = m_cls["noise"]
    return {"adev": a_cls, "mdev": m_cls, "phase_noise": resolved, "taus": {"adev": len(a), "mdev": len(md)}}


def _mtie_summary(curve):
    """Compact MTIE facts for a record: the worst case over the longest window it supports, and whether
    that worst case is a single excursion (flat across tau) or accumulates. None on an empty curve."""
    if not curve:
        return None
    lo, hi = curve[0], curve[-1]
    return {
        "tau": hi["tau"],
        "ms": round(hi["mtie"], 3),
        "tau_short": lo["tau"],
        "ms_short": round(lo["mtie"], 3),
        # >0.9 means the shortest window already contains nearly the whole excursion: one event, not
        # drift. Reported rather than judged — no threshold gates anything on it.
        "flat": bool(hi["mtie"] > 0 and (lo["mtie"] / hi["mtie"]) > 0.9),
    }


def stability(phase, tau0, tdev_tau=None):
    """The whole answer for one series: the curve, its slope, the noise type, and the BEST averaging time.

    `optimal_tau` is the tau minimising sigma_y — the averaging window a measurement built on this clock
    should actually use. That is the principled replacement for a window length chosen by intuition, and
    it is the number this module exists to produce. On a purely white-frequency clock it is simply the
    longest tau measured, and saying so is more honest than implying a minimum was found.

    PHASE NOISE IS RESOLVED HERE, not left ambiguous. `classification` comes from ADEV, which maps white
    PM and flicker PM onto the SAME tau^-1 arm — so on a wearable link it answers `white/flicker-phase`
    for nearly everything (26 of 27 corpus streams) and that one label carries two opposite operational
    meanings: white PM averages away as tau^-3/2, flicker PM only as tau^-1. `phase_noise` publishes the
    MDEV-resolved answer via `identify`, or None when the pair does not license a split. The ADEV curve
    is computed ONCE and handed on, so adding this costs one MDEV pass rather than a second ADEV.

    `tdev_tau` — the averaging time, in the same unit as `tau0`, at which to report TIME deviation.
    THERE IS DELIBERATELY NO DEFAULT, and omitting it publishes no TDEV rather than picking one per
    stream. Reading each stream at its own optimal/longest tau INVERTS the ordering: measured on the
    real corpus, H10 3.4 ms vs Verity 0.85 ms read per-stream, which flips to H10 ~2.0 vs Verity ppg
    ~3.5 at a common tau. A TDEV whose tau was chosen by the data is not comparable to another one, so
    the caller must name the tau it wants to compare at.

    ⚠️ `tdev` here is an UPPER BOUND on the clock's own contribution: this phase series is arrival-minus-
    device, so it carries BLE transport as well as the oscillator. And two streams from one recording
    are not independent corroboration — they shared that night's link conditions.
    """
    pts = adev(phase, tau0)
    if len(pts) < 3:
        return {"ok": False, "reason": "too-few-taus", "taus": len(pts)}
    sl = slope(pts)
    se = slope_se(pts)
    best = min(pts, key=lambda p: p["adev"])
    ident = identify(phase, tau0, pts)
    td = None
    if tdev_tau:
        got = tdev(phase, tau0, [tdev_tau])
        td = got[0] if got else None
    return {
        "ok": True,
        "taus": len(pts),
        "tau_min": pts[0]["tau"],
        "tau_max": pts[-1]["tau"],
        "adev_min": best["adev"],
        "optimal_tau": best["tau"],
        "at_longest": pts[-1]["adev"],
        "classification": classify(sl, se, len(pts)),
        # A SECOND, INDEPENDENT OPINION on the same question (Riley & Greenhall 2004). It fits no slope,
        # so it has no boundary to refuse near — where `classification` declines because the CI straddles
        # an edge, this still answers. Published beside rather than instead: see `noise_id`'s note on the
        # three-lane parity gate. Disagreement between the two is INFORMATION, not an error.
        "lag1_noise": noise_id(phase),
        # THE PEAK VIEW, beside the RMS one. `adev`/`tdev` say how much this typically varies; MTIE says
        # how far it got. On the real corpus those disagree by ~70x (H10: 85 ms RMS-style against a 5757
        # ms worst case), and G.810 specifies both for exactly that reason.
        # `flat` compares the shortest and longest window: when a single excursion dominates every
        # window the two are nearly equal, which says the worst case is ONE STALL rather than drift that
        # accumulates with tau. That distinction changes what you would do about it.
        "mtie": _mtie_summary(mtie(phase, tau0)),
        # The MDEV-resolved phase type, or None. None rather than a string for the reason `classify`
        # documents at length: a truthy sentinel passes `if s["phase_noise"]:`, the guard callers write.
        "phase_noise": ident["phase_noise"],
        "mdev_classification": ident["mdev"],
        # None when no `tdev_tau` was asked for, AND None when the series cannot support the tau that
        # was. Those are different situations reaching the same value, and neither may be read as
        # "the time error is zero" — a caller must branch on the key being None, not compare it.
        "tdev": td,
        # Published UNCONDITIONALLY, including when the type IS named — a caller with a wider tolerance
        # can then decide for itself rather than being forced to accept the default above.
        "slope_se": se,
        "curve": [{"tau": round(p["tau"], 4), "adev": p["adev"], "n": p["n"]} for p in pts],
    }
