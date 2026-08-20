---
bump: minor
type: added
---

**Every ADEV this module reports on an arrival series is an upper bound, and now we can measure by how
much.**

`arrival - device` carries BLE transport on top of the oscillator. ADEV squares ONE series, so it reports
clock + that stream's own packet-arrival noise and cannot separate them — which is why the honest caveat
on every TDEV here has been "upper bound on the clock's contribution". The caveat was correct and
unquantified.

`allan.gcov` is the **Groslambert covariance** (Fest, Groslambert & Gagnepain 1983; Vernotte & Lantz,
IEEE TUFFC 2018, Eq. 2). It multiplies TWO series instead of squaring one: whatever they share survives
the average, whatever is independent is zero-mean and averages away. Vernotte & Lantz state the property
directly — *"GCov is not polluted by the measurement noises since all cross-covariances are zero-mean"* —
and that the two are strictly equivalent when the counter noise is negligible. So the **gap** between
`adev` and `gcov` is a measurement of the instrument noise.

    GCov(tau) = 1 / (2 (N-2m) tau^2) * SUM_i dx_i * dy_i

identical to `adev`'s normalisation with one factor replaced by the second series, so `gcov(x, x)` **is**
`adev(x)**2` exactly — the estimator's own regression test.

## Measured on the real corpus, 2026-08-14

Two streams of one device share its clock and the host and carry independent per-packet noise, so
`nightqc.transport_share` pairs them. Per stream, `shared` = gdev / that stream's own ADEV:

| stream | ADEV(1 s) | shared |
|---|---|---|
| H10 ecg | 76.3 | **0.714** |
| H10 acc | 84.0 | 0.648 |
| Verity ppg | 31.7 | 0.238 |
| **Verity acc** | 236.3 | **0.032** |

The Verity's acc arrival series is almost entirely its own packet-arrival noise — expected for a sparse
low-rate stream, and previously indistinguishable from a badly unstable clock.

## Three things that are NOT claimed

⚠️ **A floor on the transport contribution, not a clock measurement.** Both streams ride the SAME BLE
connection, so jitter common to a connection event is *shared* and is retained rather than rejected.
GCov cannot tell shared clock from shared measurement noise. Read it as "at least this much is
per-stream noise".

⚠️ **`shared` is a ratio of DEVIATIONS, so it decays as a square root.** A 5 % shared variance reads as
0.22, and two entirely unrelated streams measure 0.18-0.29 rather than ~0. Square it before interpreting.
No threshold is applied: a fitted one passed on one seed and failed on the next, which is how the
anti-vacuity test came to compare the two cases against each other instead of against a constant.

⚠️ **A covariance may be NEGATIVE and is returned unclamped.** Vernotte & Lantz measure P(estimate < 0)
as high as 47.5 % when a clock is masked by less-stable partners. A real Verity session on 2026-08-14
returns −0.049; that means "below the noise of this comparison", not zero and not a bug.

## Defects found by running it, rather than by reading it

**Each stream needed its OWN denominator.** The covariance is symmetric; the two ADEVs are not.
Publishing one `shared` attached the denser stream's denominator to its partner's record, where it read
as that stream's own noise fraction — the Verity acc reported 0.208 (the ppg's) instead of its true
0.032. Found on the corpus, not in a test, and now pinned by one.

**A gappy partner inflated `shared`, and only the corpus showed it.** The covariance ran over the bins
where BOTH streams delivered while each ADEV ran over every bin its own stream delivered — so the ratio
was between two different series. On the Verity, whose acc covers about half the ppg's bins, that was a
numerator over 20 955 terms against a denominator over 42 468, reading **0.319 instead of 0.259**: it
UNDER-reports transport noise exactly where the gaps are worst, and looks entirely well-formed. Both
records now report the same `n`, and it is the common-bin count. On the near-gapless H10 the same bug
moved the figure by 0.3 %, which is why no test built from H10-shaped data would ever have caught it.

**`_clean_pair` exists because `_clean` would misalign the pair.** Dropping a non-finite sample from one
series shifts every later sample of that series by one against the other, so the covariance is taken
between different instants — no exception, and a well-formed number out. Unequal lengths REFUSE rather
than zip to the shorter, for the same reason.

Four mutants, each killed by the test written for it: `dx*dy` → `dx*dx` (degenerates to ADEV²),
clamping the sign, zipping unequal lengths, and cleaning the pair separately.
