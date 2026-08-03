<!--
  INTEGRATOR-TCH-FU-IV-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-03 · **Follows:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-IV-2026-07-13-BRIEF.md` §1-RESULT (REFUTED 2026-08-03)

# The third motion corner exists in the DSP and dies at the export boundary

FU-IV §1 proposed re-weighting `_tchRhoFromMotion`'s mean-of-pairwise ρ to stop it diluting the
quiet-order shape. Measured, that mechanism is not present: **`nPairs` is 1 on all 24 committed trio
nights**, because **ECGDex contributes no motion series**, so mean ≡ max ≡ any weighted mean and the
change moves nothing. This brief carries what that refutation exposed.

---

## 1 · Publish `motionIndex` on ECGDex's export epochs 🔴 (the unblock)

**It is already computed.** `ecgdex-dsp.js` reads the H10 accelerometer (`rec.deviceACC`) and derives
per-epoch gross motion from jerk — `epochMotion` (`ecgdex-dsp.js:1844`), called into `_epochMot`
(`:2415`), deliberately suppressing the respiratory chest movement and gravity baseline so only real
body movement scores. It reaches no export. `timeseries.epochs` carry
`tMin · hr · rmssd · sdnn · lfhf · position` and stop there.

Publishing it is **additive** and gives the Integrator its third motion corner, at which point
`_tchRhoFromMotion` sees three pairs and FU-IV §1's dilution question becomes *askable for the first
time* — on data, not on hypothesis.

**Cost, stated honestly, because it is why this was not folded into the refutation:**
- ECGDex re-bundle → all three build systems (`build.mjs`, `build-analysis.mjs`, `build-docs.mjs`).
- ECGDex fixtures move → regen + `verifiedUnder` on the real corpus.
- **The 24 committed trio ECGDex exports must be regenerated from raw ECG+ACC** to actually carry the
  field (`tools/trio-batch.mjs` is the sanctioned fold — do not hand-roll it). Until that happens the
  corpus still shows `nPairs = 1` and nothing downstream changes.

**Done when:** an ECGDex export carries per-epoch `motionIndex`, gated; the trio corpus is refolded; and
`node tools/tch-multinight.mjs --dir uploads/trio` reports `nPairs = 3` on nights where all three nodes
recorded motion.

## 2 · Only THEN re-ask FU-IV §1 — and keep its over-correction guard

With three pairs the original question is live. FU-IV §1.3's bound still governs and is the part worth
carrying verbatim: *the ρ that makes the solve non-negative is a **floor**, not a target — an aggregation
that always returns ≈0.9 would "rescue" everything and mean nothing.* Acceptance stays FU-IV's: the
failed nights lift off the ≈0 boundary **without** disturbing the already-rescued or positive-variance
ones (ρ must not lower Σσ²).

## 3 · The five "failed nights" are two populations, not one

Now visible via `externalRhoRejected` (shipped with the refutation):

| night | ρ offered | outcome |
|---|---|---|
| 2026-06-24 · 07-05 · 07-07 · 07-09 | 0.04 · 0.37 · 0.13 · 0.49 | **ρ REJECTED** — below the floor; auto min-ρ branch; corner pinned 0.01–0.07 |
| 2026-06-29 | 0.39 | ρ **applied**, simply too small — corner 0.04 → 0.13 |

Four were never given the ρ they were offered; one was and it did not help. **These need different
fixes.** A single aggregation change was only ever going to address the second kind, and FU-IV's
acceptance criterion counted all five.

## 4 · The minimum-overlap guard is still unaddressed

Carried from FU-III §1 and re-flagged by FU-IV §1.1: nothing requires a minimum aligned overlap `n`
before trusting ρ. With a single pair, ρ rests entirely on one correlation — and 2026-07-11 applies
ρ = 0.51 off **n = 20** epochs. Deliberately **not** fixed in the refutation pass: choosing a threshold
means inventing a constant, and this repo does not ship those un-evidenced. Decide it from the corpus
(how does ρ's stability vary with n?), not from a round number. Consider publishing `nOverlap` alongside
ρ first — the diagnostic half costs nothing and needs no threshold.

## 5 · Done when

- [ ] §1 — ECGDex publishes per-epoch `motionIndex`; trio corpus refolded; `nPairs = 3` observed
- [ ] §2 — FU-IV §1 re-asked on three pairs, with the floor-not-target guard held
- [ ] §3 — the two failure populations addressed separately
- [ ] §4 — `nOverlap` published; a minimum-`n` rule derived from data if one is warranted
