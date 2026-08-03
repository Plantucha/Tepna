<!--
  INTEGRATOR-TCH-FU-IV-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-03 (**§1 DONE** — the export already existed, the corpus was stale; refolded, `nPairs` 3 on 25/25. **§2 DONE** — coupled-pair ρ shipped. **§1b DECIDED**, **§4a DONE** — `nOverlap` published, corpus spans 20…92. §3 re-opens against a CHANGED population and §4b, the threshold, is deliberately still unwritten) · **Created:** 2026-08-03 · **Follows:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-IV-2026-07-13-BRIEF.md` §1-RESULT (and its same-day correction)

# The third motion corner exists in the DSP and dies at the export boundary

FU-IV §1 proposed re-weighting `_tchRhoFromMotion`'s mean-of-pairwise ρ to stop it diluting the
quiet-order shape. Measured, that mechanism is not present: **`nPairs` is 1 on all 24 committed trio
nights**, because **ECGDex contributes no motion series**, so mean ≡ max ≡ any weighted mean and the
change moves nothing. This brief carries what that refutation exposed.

---

## 1 · Publish `motionIndex` on ECGDex's export epochs ✅ DONE 2026-08-03 — and half of this section was wrong

> **CORRECTION.** This section was written believing ECGDex did not export motion. **It already did** —
> `50545ad feat(ecgdex): the chest-ACC motion index reaches the bus, so the TCH rho has a third corner`
> had landed before FU-IV §1-RESULT was measured, and `ecgdex-dsp.js` publishes
> `timeseries.epochs[].motionIndex` with the same tri-state discipline (null, not 0, where the ACC did
> not observe the epoch). The stale artefact was **`uploads/trio`**, folded before that commit.
>
> **Refolded 2026-08-03** — `node tools/trio-batch.mjs --src <capture dir> --out uploads/trio`, 25 nights
> (was 24; 2026-07-13 joins), every night logging `✓ ECGDex … motion`. **`nPairs` = 3 on 25/25**, so the
> third corner is live and §2 below is answerable for the first time. The committed corpus keeps its
> three-node-exports-per-night contract; `trio-batch`'s `.trio-stamp` idempotency markers are left
> uncommitted (they carry only digests — no paths, no serials — so committing them would be safe and is
> a reasonable future choice, just not this unit's).
>
> Everything below this line is the ORIGINAL text, kept because its cost estimate is still the right
> warning for the next person who touches the corpus.

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

## 2 · Only THEN re-ask FU-IV §1 — and keep its over-correction guard 🔴 NOW LIVE, and the A/B SUPPORTS it

**Measured 2026-08-03 on the refolded corpus**, changing ONLY the aggregation inside `rhoFromMotion`:

| aggregation | ρ rejected | nights excluded | median σ E / P / O (ρ-on) |
|---|---|---|---|
| `mean` (shipped) | **12** / 25 | 3 | 0.79 / 2.71 / 1.09 |
| magnitude-weighted `Σr²/Σr` | 8 | 2 | 0.87 / 2.54 / 1.14 |
| `max(r)` | **5** | 2 | 1.01 / 2.54 / 1.23 |

Monotone in aggressiveness, exactly as FU-IV §1 predicted — and `max` still rejects 5 and excludes 2, so
it is **not** the degenerate "always ≈0.9" that §1.3 warns against.

**§5's invariant checked per-night on all three variants: ρ lowered Σσ² on ZERO of 25 nights**, so it does
not discriminate between them and the choice rests on estimator properties.

**SHIPPED: `Σr²/Σr`, not `max(r)`.** `max` is the maximum of three noisy estimates and is therefore biased
upward by selection even when all three measure the same common mode — it buys its extra rescues with a
systematic over-estimate. The weighted aggregate is inert where the pairs are equal (it *is* the mean
there) and bounded above by `max(r)`, and both properties are gated. Landed at ρ-rejections 12 → 8,
nights estimated 22 → 23; `integrator_tch_golden` regenerated (ρ 0.356 → 0.381) and re-verified.

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

> ⚠️ **THE TABLE ABOVE IS THE PRE-REFOLD, PRE-WEIGHTED-ρ STATE and no longer describes the corpus.**
> It was measured on the stale 24-night fold (two motion corners, plain-mean ρ). After §1's refold and
> FU-IV §1's coupled-pair aggregate the population is **8 rejected of 25**, not 4 of 24, and the members
> have changed. Anyone re-running the two-populations question must re-derive it from
> `node tools/tch-multinight.mjs --dir uploads/trio` rather than from this table — kept, rather than
> silently updated, because the shift *is* the reason §3 is still open.

Four were never given the ρ they were offered; one was and it did not help. **These need different
fixes.** A single aggregation change was only ever going to address the second kind, and FU-IV's
acceptance criterion counted all five.

## 4 · The minimum-overlap guard is still unaddressed

Carried from FU-III §1 and re-flagged by FU-IV §1.1: nothing requires a minimum aligned overlap `n`
before trusting ρ. With a single pair, ρ rests entirely on one correlation — and 2026-07-11 applies
ρ off **n = 20** epochs. Deliberately **not** fixed in the refutation pass: choosing a threshold means
inventing a constant, and this repo does not ship those un-evidenced.

**✅ THE DIAGNOSTIC HALF SHIPPED 2026-08-03.** `_tchRhoFromMotion` now publishes `nOverlapMin` /
`nOverlapMax` — the shared-epoch count behind the weakest and strongest pair. Measured across the
refolded corpus the overlap spans **20 … 92 epochs, median 77**, so one night's ρ rests on 20 paired
epochs and another on 92 and nothing said which. Gated, verified RED, and the gate includes a truncated
third series so the field is shown to *move* (40 → 12) rather than being a constant wearing the shape of
a measurement.

**The RULE is still deliberately unwritten.** A minimum-`n` cut needs a threshold, and the honest way to
get one is to measure how ρ's stability varies with `n` on the corpus — not to pick a round number now
that the count is visible. Publishing the evidence first is the whole point of the split.

**Cost, stated because "the diagnostic half costs nothing" was too glib:** it is additive to the export,
but `integrator-dsp.js` is inlined, so it moved the Integrator + two orchestrators across all three build
systems and re-recorded `integrator_tch_golden` (2 additive fields). Cheap, not free.

## 5 · Done when

- [x] §1 **DONE 2026-08-03** — the export already existed (`50545ad`); the corpus was stale. Refolded to 25 nights, `nPairs = 3` on 25/25
- [x] §1b **DECIDED 2026-08-03 — leave them uncommitted.** They carry only digests (no paths, no serials),
      so committing would be safe, but they are regenerable local cache: a refold rewrites them, so they
      would churn the corpus diff on every re-run while `provenance/` already owns the committed-artifact
      identity question. The corpus contract stays three node-exports per night.
- [x] §2 **DONE 2026-08-03** — re-asked on three pairs, A/B measured, §5 invariant clean on 25/25, and the magnitude-weighted aggregate shipped (not `max`, which is selection-biased upward)
- [ ] §3 — the two failure populations addressed separately
- [x] §4a **DONE 2026-08-03** — `nOverlapMin`/`nOverlapMax` published + gated; corpus overlap spans 20…92,
      median 77
- [ ] §4b — a minimum-`n` RULE, derived from how ρ's stability varies with `n` on the corpus (not from a
      round number now that the count is visible)
