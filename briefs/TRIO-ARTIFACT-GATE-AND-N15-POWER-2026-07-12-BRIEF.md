<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (still LIVE — **do NOT retire this as superseded**; re-checked 2026-07-19; **Done-when reconciled with the ⚠️ DISPROVEN-§3 banner + degeneracy measured 2026-08-01, see §6**. Two Done-when boxes asked for exactly the cross-corner consensus gate the banner above declares dead — the banner landed 2026-07-18 and the list was never reconciled with it, so a reader working the list top-to-bottom would have built the forbidden thing; both are now RETIRED in place with the substance re-homed, not dropped. The residual-degeneracy box is ANSWERED: **8 of 39 nights (21 %)**, not "several" — but its two attributions do **not** survive measurement (the boundary corner is not attributable at n=8, p=0.088; and degenerate nights carry *less* co-motion ρ, 0.26 vs 0.41, which inverts the correlated-error reading). §1/§2's findings and the N=15 power material are untouched) · **Created:** 2026-07-12 · **⚠️ NOT superseded by [`TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md`](TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md), despite its header saying it "executes its intent with a better estimator"** — that line describes the ESTIMATOR only (§3's cross-corner consensus gate is indeed replaced by the fused weighted-variance hat), and reading it as a full supersession is a trap this note exists to close: an open-brief review on 2026-07-19 did exactly that and nearly retired a brief that is on the critical path. TCH-FUSED's own "Done when" **routes work BACK here** — its second box is still open on the power tool's REAL overlay, which needs a **confidence-carrying (`ms;hr;c`) corpus re-derivation** that THIS brief owns, and the same re-derivation is what [`TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md`](TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md) is blocked on. Retiring this brief would orphan that leg and leave both the paper chain and the fused hat stuck with no owner. · **Follows:** `PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md` §2 · **Feeds:** `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` · `SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md` · `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`

# The three-cornered hat is not robust to artifact — two σ estimates were wrong in opposite directions

> ### ⚠️ §3's SOLUTION IS DISPROVEN — do not build it (noted 2026-07-18)
> **§1 and §2 stand: they are findings and they are correct.** What is dead is **§3's proposed cross-corner
> consensus gate.** `TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md` prototyped it on the REAL corpus and found
> *"that gate (and every single-cue fix) is either unreliable or biases the noisiest corner."* Its validated
> replacement is a **fused-weight hat** — a per-second, per-sensor confidence `c = density_trust ×
> quality_trust` driving a weighted-variance TCH, which recovers the planted σ exactly with no corpus-tuned
> threshold anywhere. Build **that**, not §3.
>
> This is deliberately **not** a `Superseded-by:` link. That field is whole-brief and strictly 1:1
> (gate-enforced, `tests/dex-tests.js` check 5), and the fused hat replaces only §3 — the **N = 15 power
> material (§2, and the tables at ~L70–L150) is untouched by it** and still feeds
> `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`. Stamping the whole brief superseded would bury live work.

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
- [x] **DONE 2026-08-04 — `sqi` and `beats` ship on the exported 5-min epoch.**

      Per-beat SQI is carried into `epochEngine` in the **same pass that builds `nn`/`tt`**, which is the
      file's own existing idiom and is load-bearing: `peaks[i]`, `nnRes.nn[i]` and `sqi[i]` share an index
      only BEFORE the confidence filter, so deriving it afterwards would hand a consumer a mask of one
      length and a series of another. `beats` is the epoch's NN count after artifact gating.

      **Both are projected at the EXPORT seam as well as the internal builder**, because ECGDex builds its
      epoch twice and a field added only to the first never leaves the node — exactly how `hrStat` shipped
      inert, with every bundle carrying the string and every golden reading `undefined`.

      **An absent SQI is `null`, never a defaulted 1** — a fabricated 1 reads as "clean", which is §2.6's
      never-fabricate rule applied one signal over.

      Measured on 12 real H10 nights (573 exported epochs): `sqi` spans **0.47–0.97** with ~50 distinct
      values per night, `beats` spans **116–657**. So it is a measurement, not a constant.

      ⚠ **What it does and does not settle.** The 10 epochs at hr ≥ 100 in this corpus carry *higher* sqi
      than the rest (**0.753 vs 0.554**) and a beat count matching their rate — i.e. they are real
      tachycardia, and the new fields say so. That is the intended use. But note `beats / (hr × 5) ≈ 1.00`
      in **both** groups: `hr` is derived from the same gated NN that `beats` counts, so that ratio is
      near-tautological and is **not** an independent artifact check. `sqi` is the informative field;
      `beats` reports how much data backs the epoch.

      **Gated** by `ecgdex-dsp · epoch-quality` (14 assertions, both lanes), three mutants confirmed to
      red: dropping `sqi` from the export projection (2), defaulting an absent SQI to 1 (2), dropping
      `beats` (4). `epochEngine` is exposed on `ECGDSP` so the null-SQI leg is reachable — the first
      attempt attached it to `ECGDex` instead and **three legs skipped silently while the group still read
      10/10 green**, so the guard is now an assertion rather than an `if`.

      ECGDex re-bundled `c8a4977c79c4 → af1e7fabc235`; only `synthetic_ecgdex_rich_golden` moved
      (`sqi: undefined → 0.959`, `beats: undefined → 60`) — the light exports carry no `timeseries.epochs`
      at all, which is the same light/rich split this brief family noted. Regenerated with
      `tools/regen-ecgdex-goldens.mjs`, never hand-edited.
      but it moves the beat/export series ⇒ regenerate the ECGDex fixtures per §🔏 (re-run, never hand-edit).
- [ ] **Raise/relativise `buildNN`'s epoch-level guard.** `sqiThr = 0.30` is too low: burst beats at 0.37–0.45
      pass it. Prefer an epoch-level **relative** test (epoch mean SQI well below the record's own median)
      over raising the absolute per-beat threshold, which would reject good beats on quiet records.
- [x] ~~**Add the cross-corner consensus gate to the TCH path**~~ — **RETIRED 2026-08-01, do not build.**
      This box asked for exactly the thing the ⚠️ banner at the top of this brief says is **DISPROVEN**:
      `TCH-FUSED-ROBUST-HAT` prototyped the gate on the real corpus and found it *"either unreliable or
      biases the noisiest corner"*. The banner was added 2026-07-18 and this list was never reconciled with
      it, so a reader working the Done-when list top-to-bottom would have built the thing the header
      forbids. Its validated replacement is the fused-weight hat (per-second `c = density_trust ×
      quality_trust` driving a weighted-variance TCH) — build that, in `TCH-FUSED-ROBUST-HAT`.
- [x] ~~**Re-run `SENSOR-TRIO-NIGHTS` with the gate on**~~ — **RETIRED 2026-08-01 with the box above**: it is
      conditioned on "with the gate on", and there is no gate. The *substance* survives and is NOT dropped —
      the paper must still state both corrections (censoring of hard nights, and epoch hygiene), which push
      in opposite directions. That obligation now belongs to the re-run under the FUSED hat, and is tracked
      by `TCH-FUSED-ROBUST-HAT`'s own second Done-when box (the real-overlay re-derivation this brief owns
      the `ms;hr;c` corpus for).
- [x] **Diagnose the residual TCH degeneracy — MEASURED 2026-08-01, see §6.** It is **8 of 39 nights (21 %)**,
      not "several"; the boundary corner is **not attributable** at this n; and the correlated-error reading
      is **not supported by the one proxy available** — degenerate nights carry *less* co-motion ρ, not more.
      It remains a defect distinct from artifact contamination, as this box said.

## §6 — The residual degeneracy, MEASURED 2026-08-01 (and two of its three claims do not survive)

The last Done-when box asserted three things. Only one of them was a measurement.

**Reproduce:**
```sh
node tools/tch-multinight.mjs --dir uploads/trio > /tmp/tch.txt
node tools/tch-degeneracy-stats.mjs /tmp/tch.txt      # --selftest runs with no corpus
```
The estimation is entirely `tch-multinight`'s (the shipped `IntegratorTCH.threeCorneredHat`); the new tool
only counts and tests, so nothing here re-estimates σ.

### 6.1 "several nights" → **8 of 39 (21 %)**

A fifth of the corpus, not a handful. Every one is the same failure: negative classic variance, so the
correlated fit lands on the non-negativity boundary and the boundary member's σ is ~0 **by construction,
not by measurement** — which `tch-multinight` already says in its own excluded-night banner.

### 6.2 "which corner" → **not attributable at this n**

| boundary member | nights |
|---|---|
| OxyDex | 5 |
| PpgDex | 2 |
| ECGDex | 1 |

OxyDex leads, and it is tempting: it is the 1 Hz-quantised corner, so a quiet-order story writes itself.
But `P(X ≥ 5 | n = 8, uniform ⅓) = 0.088`. **That is not a finding**, and recording it as one would be the
`estimatedAHI` mistake in miniature — a plausible mechanism resting on a correlation nobody tested.

### 6.3 "the known quiet-order / correlated-error regime" → **the one available proxy points the other way**

`ρ` is the per-night co-motion correlation (mean of the positive pairwise motion Pearsons, clamped to
[0, 0.9]) — and it is precisely the parameter the correlated fit uses to *rescue* these nights; the tool's
own header says the motion-ρ "RESCUES the quiet-order nights".

| | n | median ρ |
|---|---|---|
| degenerate | 8 | **0.26** |
| estimated | 31 | **0.41** |

Two-sided permutation p = **0.090** — suggestive, not significant. Two-sided **on purpose**: the direction
was chosen after seeing the medians, and a one-sided p there is the garden of forking paths.

So the honest reading, offered as a hypothesis and not a result: these nights may fail **not** because they
carry more correlated error, but because they carry **too little co-motion for the ρ-correction to grip** —
the rescue mechanism has nothing to work with, so the solve stays on the boundary. That inverts the box's
attribution. At n = 8 it cannot be settled either way, and the deliverable is saying so rather than
producing a number.

### 6.4 What would settle it

More degenerate nights — which means more nights, since the rate is ~1 in 5. The corner attribution needs
roughly n ≥ 25 degenerate nights to separate 5/8-style leads from chance at this effect size, i.e. ~125
trio nights against the 40 available. Until then §6.2 and §6.3 stay open questions, and the fused-weight
hat (`TCH-FUSED-ROBUST-HAT`) is the path that does not depend on answering them: it replaces the
boundary-prone solve rather than diagnosing when it fails.

## Inputs (already committed)

`uploads/trio/` — 17 concurrent trio nights × 3 `ganglior.node-export` JSONs. The per-second sweep that produced
the N=10 vs N=15 tables drives the **real committed `sensor-trio-worker.js`** (its own channel pick, consensus,
foot-to-foot PPI, TCH kernel and Verity gate), swapping only `ppgdex-dsp.js` old↔new — so the comparison is
like-for-like against the published estimator.
