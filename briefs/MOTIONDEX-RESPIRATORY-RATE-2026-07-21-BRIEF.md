<!--
  MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-07-21

# MotionDex respiratory rate — rebuild the estimator, and the three papers it unlocks

> **Scope.** Two things, deliberately coupled. **(A)** Replace
> `motiondex-dsp.js:respiratoryEffort()` — measured at MAE 3.59 brpm against a real CPAP-flow
> reference, i.e. *worse than predicting a constant*. **(B)** Land the three preprints the
> validation corpus produces, which close the `PAPERS-ROADMAP` §0 gap ("the single biggest
> unwritten story is real-world validation"). The paper drafts exist
> (`papers/cpap-flow-reference.html`, `papers/acc-respiratory-rate.html`,
> `papers/effort-typing-null.html`) and are **NOT submittable** until §4 below is done.

---

## 0 · What was measured, and against what

A validation corpus was assembled from `Ecg nightly/`: **26 nights, 172 h** of Polar H10 chest
accelerometer, each with a time-aligned ResMed CPAP recording. **19,193 scored 30 s epochs.**

**Reference standard:** `*_BRP.edf` `Flow.40ms` @ 25 Hz → breath-by-breath inspiratory onsets.
Its own noise floor was established first, before any algorithm was scored: two independent
flow-derived estimators (median-breath-period vs breath-count) agree to **MAE ≈ 0.70 brpm**.
Nothing below can be better than that, and any claim that appears to be is an artifact.

Secondary references: `*_PLD.edf` `RespRate.2s` (ResMed's own RR — heavily smoothed, r = 0.05–0.43
against raw flow at 60 s, so **not** used as primary) and `*_EVE.edf` (AASM-scored events).

| Estimator | MAE (brpm) | ≤2 brpm | r |
|---|---|---|---|
| **Shipped `respiratoryEffort()`** | **3.59** | 47.6% | +0.06 |
| Constant = corpus median (null) | 1.50 | 80.7% | — |
| **Proposed** | **1.01** [0.91, 1.12] | **91.6%** [90.2, 92.7] | +0.37 |
| Proposed @ 85% coverage | 0.73 [0.67, 0.81] | 95.5% | +0.49 |
| Proposed @ 70% coverage | 0.56 [0.52, 0.61] | 97.8% | +0.61 |
| *Reference channel self-noise* | *≈0.70* | — | — |

95% CIs are night-level bootstrap (4,000 resamples, n = 26 nights).

---

## 1 · Why the shipped estimator fails

Full diagnosis in the findings write-up; the three that dominate:

1. **The band-pass is not a band-pass.** `x − MA(10 s)` then `MA(1.5 s)` is a difference of
   boxcars — a sinc in frequency, with poor stopband and sign-inverting sidelobes. Independently
   derived by three verification agents: **peak gain at 0.137 Hz (8.2 brpm), −3 dB band
   ≈ 0.077–0.235 Hz, 11.9 dB in-band tilt, −10.8 dB at 0.5 Hz.** The subject's true RR is
   ~16 brpm = 0.267 Hz — *outside the passband*. Measured consequence: band peaks land at
   6.0–9.5 brpm while truth is 16.
2. **Whole-night max-variance axis selection picks drift, not respiration** (waveform r 0.13 vs
   0.36 for the best axis). ⚠️ The usual *posture-rotation* rationale is **not** demonstrable on
   this corpus — see §3.
3. **No quality gate** (`q = 1.0` always), so it cannot abstain. Abstention is the single largest
   accuracy lever available (see the coverage rows above).

---

## 2 · The replacement

Reference implementation validated at MAE 1.01; **0.17 s per night** in plain ES5 (~139,000×
realtime), no dependencies.

```
1. Resample to a uniform grid; anti-alias (6th-order Butterworth LP at 0.8·Nyquist) → 5 Hz.
   MEASURE the native rate per file (median inter-sample interval) — H10 ACC is ~25.3-25.4 Hz on
   49/50 nights but 202.9 Hz on 2026-06-06, and Verity runs ~25.8-25.9 Hz.
2. Three channels: band-passed acc X, Y, Z, 0.13-0.50 Hz, 4th-order Butterworth, zero-phase.
   Do NOT add a tilt-angle channel — provably redundant, §3.
3. Per 60 s window / 30 s hop, per channel: Hann-windowed periodogram zero-padded to 2048,
   resampled to a 0.10-0.60 Hz grid at 0.004 Hz, normalised to unit in-band power. SUM.
4. Soft spectral high-pass taper 1/(1+exp(-(f-0.16)/0.01)); renormalise.
5. Blend in a TIME-DOMAIN zero-crossing estimate as a Gaussian bump, weight 0.30, width 1.0 brpm.
6. VITERBI ridge track: maximise Σ log S[t,f] - (Δbrpm)²/(2σ²), σ = 1.2 brpm.
7. Confidence = spectral mass within ±1.4 brpm of the ridge. Emit null below the gate.
8. Bias constant +0.58 brpm — SUBJECT-FITTED, see §5.
```

Every parameter was chosen by measurement, not taste:

| Decision | Alternative | Result |
|---|---|---|
| Viterbi tracking | per-epoch peak-pick | MAE **1.18 vs 1.54** |
| σ = 1.2 brpm | 0.6 / 2.5 / 5.0 | 1.19 vs 1.20 / 1.23 / 1.35 |
| Spectral taper | none / whitening | **1.15** vs 1.20 / 1.26 |
| 3 acc channels | +tilt / +g-par / +\|acc\| | all within 0.01 MAE |
| Time-domain blend w=0.30 | spectral only | **1.08 → 1.02**; nested CV picks 0.30 every night |
| Sum across channels | amp/concentration/peak-weighted | all within 0.01 |

---

## 3 · Two findings that constrain what may be claimed

**(a) A tilt-angle channel is redundant.** For a DC-coupled chest accelerometer the band-passed raw
axis *already is* the gravity-reprojection signal scaled by g (a 1–3° respiratory tilt reprojects
17–52 mg; chest-wall translational acceleration at 0.2 Hz is sub-mg). Measured:
`corr(spectrum(acc-X), spectrum(tilt-1)) = +1.000`, and adding the tilt pair moved MAE by 0.01.
Three independent verification lenses reached the same conclusion analytically
(<1.2% deviation, −79 dB THD at 3°). **Do not implement an arcsin tilt channel.**

**(b) Posture barely varies in this corpus — so posture robustness is UNTESTED.** Gravity-vector
roll: **median 15.1°, IQR [13.1°, 17.9°], p5–p95 = 7.8°–23.2°**; 84.9% of windows in one band.
Doheny et al. 2020 (EMBC, n=11 PSG) report supine MAE 2.43 vs lateral 1.58 (1.54×, p<0.01);
measured here, worst-vs-best orientation is **1.02×**. That is a failure to replicate *by absence
of exposure*. **No posture-robustness claim may be made from this corpus, in code comments or in
the papers.**

---

## 4 · ⛔ Prerequisites before ANY paper ships

Per `PAPERS-ROADMAP` §5.2 — *"No number without a tool that reproduces it"*:

- [ ] **Port the analysis harness to `resp-acc-analysis.html`** (unbundled → touches neither gate).
      Currently the numbers regenerate only from a Python harness outside the repo. Until this
      exists, all three papers are **DRAFT, not submittable**. This is the single blocking item.
- [ ] Figures regenerated by that tool into `papers/figures/`.
- [ ] Honest data-label tag on each paper (`real-data`, n-of-1) — §5.1.
- [ ] Generator version stated — §5.6.
- [ ] Rows added to `papers/papers.html` and `papers/PAPERS-AUDIT.md`.

---

## 5 · Open questions

1. **The +0.58 brpm bias is subject-fitted.** Consistent on every night (−0.20 to −1.27), applied
   leave-one-night-out so the reported MAE is honest — but it is one subject. Re-derive before any
   second subject's data is scored. Ship it as a named, commented constant, never a bare literal.
2. **Why does the estimator read low at all?** Most likely the reference uses `60/median(period)`
   while the spectral peak is pulled down by residual low-frequency energy. Untested.
3. **Does the pipeline survive a mobile sleeper?** Unknown — see §3(b).
4. **Apnea typing** — see the separate finding; needs its own brief, not a rider here.

---

## 6 · Done when

**Part (A) — the estimator — LANDED 2026-07-21 in `7002778`.**

- [x] `motiondex-dsp.js` emits a per-epoch `rateSeries` with confidence, keeping the existing
      return shape back-compatible (added `rateSeries`/`rateEpochSec`/`rateCoverage`/
      `respRateMethod`/`rateBrpmLegacy`; every legacy field gate-asserted present).
- [x] `respRateMethod: 'acc-spectral-viterbi'` set so `integrator-dsp.js:2441` can attribute it.
- [x] Evidence tier **`emerging`** in `motiondex-registry.js`.
- [x] `tests/dex-tests.js`: synthetic known-answers at 10/15/20 brpm (±0.5); bias-is-opt-in;
      confidence-gate monotonicity; additive-export-shape back-compat.
- [x] **The adversarial twin** — DONE. `genSyntheticACC` gained additive `flipAtSec` /
      `pauseAtSec` / `pauseDurSec` options; the twin drives 11 min at 15 br/min with a 90 s
      breathing pause and a posture flip rotating gravity +Z → +Y. It gates the one property the
      corpus **cannot** supply (§3(b)): rate is recovered at 15.1 br/min on BOTH sides of the
      flip, where a fixed-axis estimator would lose the breath entirely. It also pins a **KNOWN
      LIMITATION** measured while building it — a pause *shorter* than the 60 s window does NOT
      trigger abstention (30 s-pause epochs carried mean confidence 0.488 vs 0.390 for clean
      ones), so a downstream apnea consumer must not treat the confidence gate as an apnea
      filter. Reproducible from committed CODE (deterministic seed), not a 900 KB blob.
- [x] Gates green on merged `main` **with the real corpus present**: 3,677 assertions, **0
      skipped** (the GATE-C equivalence legs actually ran); `build --check` clean (11 owned);
      GATE A 9/9; GATE B **25** fixtures reproducible; `tools/verify-fixtures.mjs` green
      (14 current, 0 stamped).
- [x] Changeset `changes/2026-07-21-motiondex-spectral-resp-rate.md` (`bump: minor`).

**Part (B) — the papers — NOT done. This is why the brief is IN-PROGRESS.**

- [x] **Port the harness to `resp-acc-analysis.html`** — DONE. Runs the *shipped*
      `MOTIONDSP.respiratoryRate`, so it measures production code, not a twin. Verified against
      the original harness on four nights: clock offsets within **8 s**, per-night MAE within
      **0.06 br/min**. The port surfaced three defects that would each have silently corrupted
      the clock lock, all now documented in-code: integer-decimation grid skew, double
      band-pass filtering, and — the subtle one — deriving the sample rate from the
      millisecond-quantised phone stamp instead of the Polar nanosecond counter (a 1.2% rate
      error → ~18 s of skew over a 25 min chunk → locks off by tens of minutes).
- [x] **Re-run the full 26-night corpus through the tool** — DONE. `resp-acc-analysis.js` driving
      the shipped estimator independently reproduces the external harness across all 26 nights:
      **MAE 1.005 vs 1.006** (95% CI 0.917–1.101 vs 0.912–1.115) and **within-2-brpm 91.7% vs
      91.6%**, on separately recovered clock alignments — agreement to 0.001 br/min and 0.1 pp.
      Reference self-noise regenerates at median **0.74** br/min over 26 nights (range 0.56–1.19).
      Per-night MAE median 0.88 (0.76–1.67). Papers now cite the tool's numbers.
      **Two corrections this surfaced**, both now in the papers: (a) the drift residual SD of
      1.03 s is **implementation-specific** — it came from a pre-cached exactly-25 Hz grid; the
      tool correlating from the raw stream reaches 6.87 s for the same slope, so a validity
      tolerance must be derived from the fitted residual (3σ), never hardcoded (a fixed 5 s gate
      rejected 15 of 26 good nights); (b) the tight-gate coverage figures were slightly optimistic
      — 0.61 rather than 0.56 at 70% coverage — because noisier locks blur epoch pairing.
- [ ] **Exercise the browser page itself** (`resp-acc-analysis.html`) end to end. The regeneration
      above was driven **headlessly against the tool's engine**; the folder-ingest / FileReader /
      render path is still unexercised, as is `Dex-Test-Suite.html?full`. Both need a browser.
- [ ] Figures emitted into `papers/figures/`.
- [ ] Figures regenerated into `papers/figures/`.
- [ ] `papers/PAPERS-AUDIT.md` rows.
- [x] **`MaskPress.2s` test of the CPAP-pressure hypothesis** — DONE, and it **fails**. Effort
      during central apnea is *negatively* associated with concurrent mask pressure (Spearman
      ρ = −0.174, p = 0.0008, n = 367 events / 22 nights; low-pressure median ratio 1.12 vs 0.83
      at high pressure), the opposite of the prediction. The convenient narrowing of the typing
      claim to "under therapy" is therefore **not available**. Caveat that bounds it: pressure
      varied only across the delivered therapeutic range (4.14–11.08 cmH₂O), so this is a
      within-therapy dose–response test, not therapy-vs-no-therapy — a null here is much weaker
      evidence against the hypothesis than a positive would have been for it.
- [ ] Follow-up brief spawned per the house pattern, carrying the
      Integrator apnea-typing rule at `integrator-dsp.js:1205` — which this work-unit deliberately
      did **not** touch.
