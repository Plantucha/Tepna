<!--
  DEX-DSP-AUDIT-FREQ-HRV.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Frequency-Domain HRV — DSP Audit (WP-C)

**Date:** 2026-06-21 · **Scope:** the LF / HF / VLF spectral estimators in `ecgdex-dsp.js`,
`pulsedex-dsp.js`, `ppgdex-dsp.js` · **Triggered by:** external review §B ("Frequency-domain HRV from
irregularly-sampled RR is where most implementations are quietly wrong… must be audited"). This is
the read-and-document pass + a known-answer regression test. **No estimator behavior was changed**
(one inert export added so the test can reach `ECGDSP.lombScargle`).

---

## TL;DR

- **The method is correct.** All three nodes estimate the spectrum with a **Lomb–Scargle
  periodogram applied directly to the unevenly-sampled RR/PPI series** — *no interpolation, no
  resampling*. This sidesteps the single most common frequency-HRV error the review flagged
  (results depending on an arbitrary interpolation rate). The classic Lomb τ phase-reference and
  band integration are implemented correctly in all three.
- **Bands match Task Force 1996** everywhere: **VLF 0.003–0.04 Hz · LF 0.04–0.15 Hz · HF 0.15–0.40 Hz.**
- **Two real inconsistencies, both in PpgDex** (not errors of correctness, but of parity):
  it uses **mean-only detrend** (the others use **linear** detrend, per Task Force) and it does **not
  Parseval-calibrate** its power to signal variance (the others do). Consequence: PpgDex is more
  susceptible to slow-drift leakage into VLF/LF, and its absolute band powers are **not on the same
  ms² scale** as ECGDex/PulseDex, so cross-node *absolute* power comparison is invalid (ratios and
  peak location are fine).
- **HRVDex computes no spectrum of its own** — it reads vendor `HF`/`LF`/`VLF`/`Total power` columns
  (Welltory-style) and only derives ratios (LF:HF, n.u., spectral entropy). Out of estimator scope;
  its inputs are only as good as the source device.
- **New regression test:** `tests/dex-tests.js` group **"Frequency-domain HRV — spectral
  known-answer"** (tag `WP-C`, 12 assertions) drives both engines with synthetic single-tone RR and
  asserts the recovered band + peak. **All green** (browser suite: 576 passed / 37 groups).

---

## Per-node comparison

| Property | ECGDex (`lombScargle(nn,times,nf)`) | PulseDex (`lombScargle(a,nf)`) | PpgDex (`lombScargle(tt,nn)`) |
|---|---|---|---|
| Input | NN(ms) + beat times(s) | RR(ms); times = cumulative RR | PPI(ms) + times(s) |
| Resampling | **none** (Lomb on raw) | **none** | **none** |
| Detrend | **linear** (`linfit`, Task Force) | **linear** (`linfit`, Task Force) | **mean-only** ⚠ |
| Bands (Hz) | 0.003–0.04 / 0.04–0.15 / 0.15–0.40 | same | same |
| Freq grid | `nf=300`, df≈0.0013 Hz | `nf=512`, df≈0.00078 Hz | fixed `df=0.002` Hz |
| Normalization | **∫PSD = variance** (Parseval) | **∫PSD = variance** (Parseval) | **raw integral** (no calibration) ⚠ |
| Returns | tp, vlf, lf, hf, lfhf, respRate | tp, vlf, lf, hf, lfhf, respRate | vlf, lf, hf, totalPower, lfhf, lfnu, hfnu |
| Windowing | single segment; **PulseDex additionally takes the median of per-window spectra** for long recordings (a robustness win the other two don't do) | per-window median (long) | single segment |
| Min beats | 12 | — | 8 |

### What's genuinely good
- **Lomb–Scargle on raw intervals** is the right call for consumer RR/PPI (gappy, ectopy-pruned,
  non-uniform). It removes the interpolation-rate degree of freedom entirely.
- **Linear detrend** (ECGDex, PulseDex) is exactly the Task-Force remedy for slow drift contaminating
  VLF/LF — the known-answer test confirms a pure ramp is suppressed to ~19% of a tone's power.
- **Parseval calibration** (ECGDex, PulseDex) makes the band powers physically interpretable (ms²)
  and cross-comparable between those two nodes.
- **PulseDex's per-window median spectrum** for long recordings is a real robustness feature
  (rejects transient artifact windows) beyond a single whole-record periodogram.

### Findings (PpgDex parity) — ✅ APPLIED 2026-06-21 (re-bundled; suite 580/0; buildHash unchanged)
1. **Detrend → linear.** Replace the mean-only removal (`y[i] -= my`) with the same `linfit` linear
   detrend the other two use, so slow PPG baseline drift can't masquerade as VLF/LF power.
2. **Calibrate ∫PSD = variance.** Apply the same `sc = variance / tp` scaling so PpgDex band powers
   land in ms² and are comparable to ECGDex/PulseDex (today they're an uncalibrated integral).
   *Impact:* changes PpgDex's absolute `vlf/lf/hf/totalPower` numbers (ratios, n.u., and peak location
   are unaffected). Because it changes a surfaced metric's value, it requires the **full gate**
   (test suite → re-bundle `PpgDex.html` → provenance) and a regenerated PpgDex fixture — so it's a
   **separate small follow-up**, deliberately kept out of this read-only audit.

### Caveats (all nodes — documentation, not bugs)
- **VLF needs length.** VLF (0.003–0.04 Hz) is only resolvable over ≥~5 min; on short readings VLF is
  unreliable and should be read as context only. The bands are computed regardless of record length —
  consumers should length-gate VLF interpretation.
- **respRate** is the HF-band peak × 60. It assumes the dominant HF oscillation is respiratory, which
  holds for clean rest but not during arrhythmia or heavy motion.
- **DFA α1 / SampEn** (also in these files) are length/stationarity-sensitive; correctly tiered
  `emerging`. Not re-audited here (time-domain/nonlinear, not spectral).

---

## The known-answer test (what it proves)

Synthetic RR = 800 ms mean + a single pure sinusoid at a known frequency (deterministic, no network,
no PhysioNet fixture needed — the expected answer is analytic):

| Assertion | Result |
|---|---|
| ECG: 0.25 Hz tone → HF ≫ LF, HF ≫ VLF | ✓ (hf=798, lf=1, vlf=0) |
| ECG: HF peak → respRate ≈ 15 br/min | ✓ (15.0) |
| ECG: 0.10 Hz tone → LF ≫ HF | ✓ (lf=795, hf=2) |
| ECG: pure linear drift suppressed by detrend (tp ≪ tone tp) | ✓ (ramp tp=149 vs 800) |
| PPG: 0.25 Hz tone → HF ≫ LF, HF ≫ VLF | ✓ (hf=499, lf=1) |
| PPG: 0.10 Hz tone → LF ≫ HF; LF:HF > 1 | ✓ (lfhf≈368) |
| ECG & PPG agree the 0.25 Hz tone is HF-dominant | ✓ |

The test lives in the **shared** `tests/dex-tests.js`, so it runs in **both** `node
tests/run-tests.mjs` (CI) and `Dex-Test-Suite.html` (browser). It reaches the estimators via
`ECGDSP.lombScargle` (newly exported — inert addition, no re-bundle per the BADGE_CSS precedent) and
the already-exported `PPGDSP.lombScargle`. Note the differing absolute scales in the numbers above
(ECG tone tp=800 vs PPG hf=499) — that is exactly the un-calibrated-power delta documented under
Finding 2; both still localize the peak correctly, which is what the test asserts.

---

## What this does NOT cover (hand-off to later WPs)

- **Beat detection & artifact/ectopy rejection** (the input quality *into* this pipeline) — that's
  **WP-D** (review item #4), the other half of "can I trust the HRV number."
- **Agreement vs a reference** (Kubios / NeuroKit2 on the same recording) — that's **WP-E** (item #2);
  a known-answer synthetic test proves the *math*, not agreement with a gold-standard tool on real
  data.
- The recommended **PpgDex parity fix** above (separate gated change).

---

### Bottom line
The frequency-domain HRV estimators are **methodologically sound** — Lomb–Scargle on raw intervals
with Task-Force bands, and (in the two RR nodes) proper linear detrend + Parseval calibration. The
review's specific fears (interpolation-rate dependence, VLF leakage) are addressed in ECGDex and
PulseDex and now **regression-guarded**. The one substantive gap is **PpgDex parity** (linear detrend
+ variance calibration), itemized above as a gated follow-up.
