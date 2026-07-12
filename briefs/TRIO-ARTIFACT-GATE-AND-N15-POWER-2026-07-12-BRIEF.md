<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-12 · **Follows:** `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md` §2 · **Feeds:** `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` · `SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md` · `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`

# The three-cornered hat is not robust to artifact — two σ estimates were wrong in opposite directions

> **One-line:** re-running the `SENSOR-TRIO-NIGHTS` power analysis at **N = 15** (the detector fix recovered
> 5 nights at zero capture cost) did **not** tighten the answer — it exposed that **both** the Verity and H10
> σ estimates were artefacts of *epoch hygiene*, in **opposite** directions: Verity's CI was optimistic
> because a quality gate had been **censoring the hard nights**, and H10's was pessimistic because **one
> night's 15-minute artifact burst** inflated its variance ~4×. The TCH is a **variance** estimator with **no
> robustness to brief contamination**, and that is the root defect. A **cross-corner consensus gate** fixes it
> and is validated below.

## Why this is not a data problem

TCH recovers each corner's σ from the *variances of pairwise differences*. Variance is dominated by outliers,
so a handful of bad epochs does not perturb σ̂ — it **replaces** it. Measured on the real corpus:
**3 bad epochs out of 86 (3.5%) inflated a corner's σ from 2.5 → 9.6 bpm.** No amount of extra nights fixes
this; N only averages the contamination in.

---

## §1 — H10: the "noisy corner" was one 15-minute artifact burst

`2026-06-12` reports **σ_H10 = 9.60 bpm** — implausible for a chest-strap raw-ECG corner that sits at 1.3–2.5
bpm on every other night, and it single-handedly blows the H10 across-night CI out to ±1.28.

**It is not a mis-pairing, a clock shift, or poor contact.** The three corners' median HRs agree
(ECG 50.5 / Oxy 50.0 / PPG 51.0), their start times align, and ECG quality is 98% analyzable. It is a
**transient burst of spurious QRS detections**, ~5¾ h in:

| epoch (min) | ECG | PPG | OXY | beats/5 min | mean SQI |
|---|---|---|---|---|---|
| 340 | 50.7 | 52 | 51 | 253 | 0.518 |
| **345** | **91.2** | 53 | 52 | **458** | **0.385** |
| **350** | **118.1** | 52 | 50 | **593** | **0.369** |
| **355** | **63.1** | 50 | 49 | 347 | **0.453** |
| 360 | 49.6 | 50 | 50 | 250 | 0.583 |

The beat count **more than doubles** (253 → 593) while **SQI drops** (0.52 → 0.37). Per-epoch HRV goes
physiologically impossible with it (SDNN 288 ms, RMSSD 133 ms against a 30–120 / 28–42 baseline).

**Variance impact:** SD of (ECG − OxyDex) = **8.77 bpm** across the night; **2.51 bpm** with those three
epochs removed. A **3.5% contamination → 3.5× inflation.**

**Corpus-wide, 06-12 is the ONLY night with a multi-epoch ECG burst.** 11 of 17 nights carry *some* artifact
epoch, but the rest are isolated PPG spikes that barely move the variance.

### Why the existing guards missed it
- `buildNN` corrects **per beat against a local median** (Malik 20%). When the artifact is **sustained**, the
  local reference is itself contaminated — the rule has nothing clean to compare against. (Same failure class
  as the PPG dicrotic-notch doubling: local adaptive methods collapse when the artifact dominates the window.)
- `buildNN`'s per-beat gate is `sqiThr = 0.30`. The burst beats sit at **0.37–0.45** — *above* the bar. They
  pass **individually**; only **collectively** are they nonsense.
- **ECGDex's 5-min epochs carry NO quality field at all** (`tMin, hr, rmssd, sdnn, lfhf, position`). The node
  computes per-beat SQI and then discards it, so no downstream consumer can tell a 118 bpm artifact epoch from
  a real one. **This is the actual gap.**

### ⚠️ The trap to avoid: do NOT gate on high RMSSD
A naive "RMSSD/SDNN implausible ⇒ reject" rule would **silently suppress atrial fibrillation**, which is
genuinely high-RMSSD — a far worse bug than the one being fixed. The safe discriminator is **SQI**:
- **artifact** ⇒ noisy QRS ⇒ **SQI falls** (0.52 → 0.37) *and* beat count inflates;
- **AF / ectopy** ⇒ **clean** QRS ⇒ **SQI stays high**, rate does not double.

Any gate must key on signal quality, never on rhythm irregularity alone.

## §2 — Verity: the CI was optimistic because the gate was CENSORING the hard nights

The detector fix (`PPGDEX-OPTICAL-DETECTOR…` §1) recovered the 5 nights `sensor-trio-worker.js`'s Verity gate
had been discarding as *"poor PPG contact"*. Re-running the power analysis at N = 15:

```
The 10 nights the gate KEPT     Verity σ: 0.95 … 3.30 bpm   (max 3.30)
The 5 nights it DROPPED         Verity σ: 1.40, 2.43, 5.00, 5.48, 6.19
```

**Three of the five sit above every one of the ten survivors.** The gate was dropping exactly the nights where
the optics were hardest — so the surviving ten were **the easy nights**, and the published Verity precision was
a **survivorship artefact**:

| | N=10 (censored) | N=15 (uncensored) |
|---|---|---|
| mean σ | 1.90 | **2.46** |
| SD | 0.67 | **1.73** |
| **median σ** | **1.94** | **1.85** ← barely moves |
| 95% CI half-width | ±0.396 | **±0.847** |

**More nights made the CI WORSE (+114%), against a 1/√N prediction of ±0.32.** The `1/√N` law assumes
**exchangeable** windows; a quality gate makes them non-exchangeable *by construction*.

The **median is robust** (1.94 → 1.85), so the papers' **headline σ stands**. It is the **mean and the CI**
that were optimistic. This also closes the `6.2 bpm` loop: 2026-07-02's recovered Verity σ is **6.19 bpm** —
**~6 bpm Verity nights are real, they live in the tail.** The original 6.2 was never a wrong measurement; the
error was calling a tail night *"the real estimate"* instead of *"the worst window"* — which
`papers/sigma-no-reference.html` had already said.

## §3 — SOLUTION: a cross-corner consensus gate (validated)

The system has the fix built in and unused: **three independent measurements of the same heart.** Drop an
epoch from the variance when **one corner disagrees with BOTH others by > 10 bpm**.

**It is AF-safe by construction:** real arrhythmia appears in *all three* corners, so no corner can disagree
with the other two. It keys on **cross-corner inconsistency**, never on rhythm.

Validated on the committed 17-night corpus (epoch-level TCH):

| night | dropped | σ ECG before → after | σ PPG before → after |
|---|---|---|---|
| **2026-06-12** | 12 | **8.70 → 0.43** | 7.31 → 1.50 |
| 2026-07-06 | 7 | — | **6.16 → 1.27** |
| 2026-06-15 | 7 | — | **6.87 → 1.63** |
| 2026-06-25 | 2 | — | 4.38 → 0.83 |
| 2026-06-29 | 5 | — | 4.22 → 1.10 |
| 8 clean nights | 0 | unchanged | unchanged |

Every inflated corner collapses into the normal band; **untouched nights are bit-for-bit unchanged.**

### What excluding the single artifact night does to the paper's deliverable

| | H10 mean σ | SD | 95% CI half-width |
|---|---|---|---|
| N=15, 06-12 **included** | 2.08 | 2.21 | **±1.278** |
| N=14, 06-12 **excluded** | **1.50** | **0.49** | **±0.296** ← meets the ±0.5 target |

**One artifact night was costing a 4.3× CI inflation.** H10's true σ is **~1.5 bpm** and it is the **tightest,
most stable corner in the trio** (SD 0.49 across nights) — the opposite of what the uncorrected numbers say.

**Done when**
- [ ] **ECGDex exports per-epoch quality.** Add `sqi` (mean per-beat SQI in the epoch) and `beats` to the 5-min
      epoch objects. The node already computes both and throws them away; without them no consumer can
      distinguish a 118 bpm artifact epoch from a real one. Additive (new fields), so back-compat holds —
      but it moves the beat/export series ⇒ regenerate the ECGDex fixtures per §🔏 (re-run, never hand-edit).
- [ ] **Raise/relativise `buildNN`'s epoch-level guard.** `sqiThr = 0.30` is too low: burst beats at 0.37–0.45
      pass it. Prefer an epoch-level **relative** test (epoch mean SQI well below the record's own median)
      over raising the absolute per-beat threshold, which would reject good beats on quiet records.
- [ ] **Add the cross-corner consensus gate to the TCH path** (`IntegratorTCH` / `tools/tch-multinight.mjs`):
      drop an epoch where one corner disagrees with both others by >10 bpm, and **report the count dropped**
      (CLAUDE.md: no silent caps). Gate on quality, never on rhythm — see the AF trap in §1.
- [ ] **Re-run `SENSOR-TRIO-NIGHTS` with the gate on** and restate its deliverable. The paper currently answers
      *"how many windows?"*; the honest answer is **"how many, and is your gate censoring the hard ones, and is
      your epoch hygiene clean?"** Both corrections must be stated — they push in opposite directions.
- [ ] **Diagnose the residual TCH degeneracy** — several nights still yield negative variance (σ = null) or
      implausibly small σ (0.05–0.17 bpm) even after gating. That is the known quiet-order / correlated-error
      regime (`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III` §1), and it is a **separate** defect from artifact
      contamination. Do not conflate them.

## Inputs (already committed)

`uploads/trio/` — 17 concurrent trio nights × 3 `ganglior.node-export` JSONs. The per-second sweep that produced
the N=10 vs N=15 tables drives the **real committed `sensor-trio-worker.js`** (its own channel pick, consensus,
foot-to-foot PPI, TCH kernel and Verity gate), swapping only `ppgdex-dsp.js` old↔new — so the comparison is
like-for-like against the published estimator.
