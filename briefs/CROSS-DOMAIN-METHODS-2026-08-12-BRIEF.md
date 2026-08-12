<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-12

# Most of what this suite keeps re-deriving is a solved problem in another field

A 2026-08-12 literature sweep across pulsar timing, frequency metrology, network time transfer,
neuroimaging methodology and astrometry. Every item below either replaces something hand-rolled here,
names a failure this repo discovered independently, or is recorded as REJECTED with the measurement
that rejected it. Citations are given so the next session does not re-derive them a third time.

## 1 · ADOPTED — Allan deviation (frequency metrology)

Own brief: [`ALLAN-DEVIATION-2026-08-12-BRIEF.md`](ALLAN-DEVIATION-2026-08-12-BRIEF.md). Shipped as
`capture-host/allan.py`.

**Why it was needed:** three clock analyses in one session reached wrong or unsafe conclusions using
ad-hoc statistics. Allan built this estimator because **standard deviation DIVERGES for these noise
types as the sample count grows** — so "does it average down?", asked with SD of block means, was
ill-posed before the data were even considered.

**What it settled immediately:** all four Polar streams are **white/flicker phase noise (slope −0.99 to
−1.00)**, averaging to **0.023–0.094 ms**. The H10's "~14 ms within-connection wander" is therefore
neither drift nor random walk; it averages away and the fitted line already removes it. **The clock is
~100× inside PAT's 10 ms budget and is not the bottleneck.** The O2Ring is white FREQUENCY at 615 ms —
four orders worse, now a mechanism rather than an inference from its scattered ppm.

> NIST/Riley, *Handbook of Frequency Stability Analysis* (SP 1065) · <https://tf.nist.gov/general/pdf/2220.pdf>

## 2 · ADOPTING — Fourier-domain template matching for the pulse fiducial (pulsar timing)

**This is now the dominant error term, which is why it is next.** With the clock at 0.03 ms, the PPG
systolic foot at **12.7 ms σ** (measured between three co-located LEDs of one device — same clock, same
pulse, so detection error alone) is what limits PAT.

The governing relation from pulsar timing is **σ_TOA ≈ W / (S/N)** — pulse width over signal-to-noise —
and the Cramér-Rao bound agrees from first principles that timing precision is set by **bandwidth and
SNR, not by sampling rate**, with the rider that sub-sample estimation is *necessary* to attain it.

**This resolves the repo's own contradiction.** `PPG-SAMPLE-RATE-AND-PAT` §3 measured residIQR FLAT from
25→176 Hz and concluded rate buys nothing. That is exactly what theory predicts **for a point-based
fiducial**: intersecting tangents uses ~3 local samples (trough, max-slope, crossing) and discards the
rest, so extra samples cannot help it. A **matched filter integrates the whole pulse**, so its effective
SNR grows with samples-per-pulse. Both results are correct; they describe different estimators.

Taylor (1992) FFTFIT fits the phase gradient of the cross-power spectrum of template against
observation. Phase resolution imposes **no fundamental limit**, and time-domain cross-correlation is
explicitly **~10× worse than the data resolution**. The same idea reached physiology independently:
template + three-parameter fit including a sub-sample shift, over 5-minute segments, giving **SD −20.2 %
overall and −48.8 % in the low-motion case** at 25–250 Hz. Sleep is the low-motion case.

> Taylor 1992, via *Pulsar Timing Techniques* <https://ar5iv.labs.arxiv.org/html/1309.1767> ·
> *Improving pulsar timing precision through superior TOA creation* <https://arxiv.org/pdf/2405.08629> ·
> *Increasing accuracy of PAT estimation in low-frequency recordings*, Physiol Meas 2024,
> <https://iopscience.iop.org/article/10.1088/1361-6579/ad2c12>

### 2.1 · MEASURED — it helps where the pulse is starved and LOSES where it is not

Built as `tools/pulse-template-toa.mjs` (scout, wired into nothing). The estimator itself is correct:
planted sub-sample shifts of 0.25 / −0.4 / 1.7 / −2.3 samples come back to within **0.0016 samples**.

Scored on the only test that cannot be gamed — inter-LED IQR across the three co-located LEDs, which
share a clock and a pulse, so a merely self-consistent estimator cannot move it:

| night | tangents (shipped) | Fourier template | verdict |
|---|---|---|---|
| 2026-08-11, native **55 Hz** | 18.78 ms | **17.07 ms** | −9.1 %, a real but modest win |
| 2026-08-02, native **176 Hz** | **1.70 ms** | 2.70 ms → 1.86 ms at kMax 48 | **LOSES**, at every harmonic count tried |

**⛔ THE COMPOUNDING PREDICTION IN §2 WAS WRONG.** I argued the matched filter and the higher rate would
multiply, because a point-based fiducial cannot spend extra samples. Measured, they do the opposite: at
176 Hz the intersecting-tangent foot has enough samples to place itself well and the template's
whole-pulse integration stops paying. The template earns its keep only where the pulse is
under-sampled. The literature's −20 % / −48.8 % was not reproduced at either rate.

One implementation flaw was real and is fixed by parameter, not by ambition: a fixed `kMax = 8` is
8-of-22 bins at 55 Hz but 8-of-70 at 176 Hz, so the high-rate case was discarding most of the spectrum.
Raising it improves monotonically (3.03 → 1.86 ms) and still does not overtake tangents.

**⚠️ The far larger effect in that table is NOT the estimator — it is 18.78 ms against 1.70 ms, an 11×
difference in the shipped method between two nights.** That is confounded: different nights, and rate
and signal quality move together. It is the same confound `PPG-SAMPLE-RATE-AND-PAT` §3 set out to avoid
by decimating one recording, and it is why a **native 176 Hz night against a native 55 Hz night on the
same subject** remains the only clean test. Do not read 11× as the rate's effect.

**Recommendation: do NOT adopt the template as the default fiducial.** Keep it as a scout for
under-sampled data, and revisit only if a same-subject comparison shows the tangent method starved.

## 3 · ADOPTED AS A DISCIPLINE — circular analysis has a name and a citation

Kriegeskorte et al. define **double dipping** as *"the use of the same dataset for selection and
selective analysis"*, invalid *"whenever the results statistics are not inherently independent of the
selection criteria"*, and found **42 % of 134 fMRI papers** doing it.

This repo discovered the same rule the expensive way and states it in three places without a citation:
`pat-gate.js:201` (*"a bin at 3 % match is edge-censored toward PHYS_HI, not a measurement"*),
`pat-host-offset.mjs` §3c.4 (*"selecting the best pair BY the statistic is circular"*), and
`PAT-COMPENDIUM` §6.1. It was violated again on 2026-08-12, when the 5-minute window with the tightest
residIQR (11.6 ms) was called the best — it was 89 % censored, i.e. the most selected.

**The prescribed fix is concrete and stronger than "be careful": use independent data for selection and
for the selective analysis.** Cross-reference this from `pat-gate.js` rather than restating it.

> Kriegeskorte, Simmons, Bellgowan & Baker, *Nature Neuroscience* 12:535 (2009) ·
> <https://www.nature.com/articles/nn.2303>

## 4 · REJECTED, with the measurement

- **Geometric hashing / point-set registration for beat correspondence** (astrometric plate solving).
  Attractive because RR intervals are aperiodic where beat times are not — but
  `IBI-ALIGNMENT-LIMIT-2026-08-01` and `tools/beat-comb-analysis.mjs` already establish that the
  coincidence curve is a **comb of period mean-RR**, and that the resolution is **a drift term, not a
  finer search**: 5-minute refits take the same nights from 18–40 % to 43–98.8 %. The arrival sidecar
  supplies the offset directly at 4.8 ms agreement. Nothing left for a hash to solve.
- **Tobit / censored-regression for the `PHYS` window.** The literature bound is the problem: Tobit's
  bias stays under 2 % at low-to-moderate censoring and **deteriorates around 60 %**. Our nights run
  **46–68 %** censored — at or past the edge where the standard correction stops working. Censoring
  must be *reduced*, not modelled away. Recorded so nobody reaches for it as a shortcut.
- **3-LED fusion** to cut foot error by √3. Measured: **2.3 %** (42.7 → 41.7 ms residIQR). The three
  optical paths share their error, so it is common-mode; only a method using the whole waveform helps.

## 5 · Already in use, named here so they are findable

Moon et al.'s lower-envelope LP and Paxson's minimum-of-subsets (`clock_offset.py`) · PELT changepoint
detection (as a reference for `stepiness`) · metamorphic testing (the passthrough gate) · matched
filtering (about to be, §2).

## Done when

- [x] §1 Allan deviation shipped and run on real captures
- [x] §2 Fourier-domain template TOA implemented and measured on the inter-LED scatter — and it does
      NOT win: −9.1 % at 55 Hz, LOSES to tangents at 176 Hz. Recorded as a scout, not adopted (§2.1)
- [ ] §3 `pat-gate.js` cross-references Kriegeskorte rather than restating the rule
- [x] §4 rejections recorded with the measurement that rejected them

Related: [`ALLAN-DEVIATION-2026-08-12-BRIEF.md`](ALLAN-DEVIATION-2026-08-12-BRIEF.md) ·
[`PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md`](PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md) ·
[`PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md`](PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md)
