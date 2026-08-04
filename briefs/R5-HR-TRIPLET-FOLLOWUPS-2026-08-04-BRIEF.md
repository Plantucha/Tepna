<!--
  R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-04 · **Spawned-by:** `R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md` (bias item, executed) · **Affects:** every cross-node HR comparison — `oxydex-dsp.js` `oxyBuildEpochSeries`, `ecgdex-dsp.js` epoch builder, the HR three-cornered hat

# The bias was an estimator; the σ is almost untouched — and one of those needs saying out loud

## 1 · What the parent established

`R5`'s *"OxyDex under-reads HR by −0.36 bpm"* is a **cross-node estimator confound**, not a device
property:

- The ring's firmware HR agrees with chest ECG to **−0.027 bpm (0.6σ)** over 252 windows / 20 nights.
- `ECGDex: hr = 60000/mean(RR)` vs `OxyDex: hr = median(1 Hz rate)` differ by **−0.299 bpm** on 1670
  real 300-beat blocks — one series, both statistics, no device involved — against the **−0.269**
  cross-node figure the brief blamed on the O2Ring.

## 2 · The question that immediately follows, and its answer

If the bias is an artifact, **is the σ an artifact too?** Every σ the fleet publishes for the HR triplet
is computed from these same epoch series. Measured, treating the per-block estimator disagreement
(SD **0.489 bpm**) as an error term on the OxyDex leg:

| reported σ | σ with the estimator term removed | change | variance share |
|---|---|---|---|
| 2.60 (O2Ring, classic hat) | 2.554 | **−1.8 %** | 3.5 % |
| 2.72 (O2Ring, planted) | 2.676 | −1.6 % | — |
| 1.50 (H10) | 1.418 | −5.5 % | — |

**The σ values survive.** On the O2Ring leg — the one the estimator gap actually lands on — the effect
is **under 2 %**, well inside every uncertainty those papers already state. The 1.50 row is shown only
to make the scaling visible; the gap is an OxyDex-vs-ECGDex artifact and does **not** apply to the H10
leg.

⚠ **3.5 % is an UPPER BOUND, not a point estimate.** Both estimators are computed from the *same* RR
series, so their disagreement is correlated with the physiology rather than independent of it, and
subtracting it in quadrature assumes independence it does not have. The true contribution is smaller.

**Why this needs saying out loud:** the parent's headline is "the bias is an artifact", and the obvious
next inference — *"so the σ papers are wrong too"* — is **false**. Left unstated, someone re-derives
σ, finds a 2 % change, and either publishes a correction nobody needed or concludes the correction was
too small to be the real story and keeps hunting. Both waste the finding.

## 3 · What is actually owed

- [ ] **Pick ONE epoch-HR statistic across the fleet, or publish the choice per node.** Today ECGDex,
      OxyDex and PpgDex each summarise an epoch and nothing states which statistic, so a consumer
      differencing them is measuring the choice. Note the third option exists and reads the other way:
      `mean(rate) − 60000/mean(RR) = +0.203 bpm` on the same blocks. The decision is not binary and
      picking one silently is how this recurs.
- [ ] **Whichever is chosen, the epoch block must NAME it** — a `hrStat: 'median-rate' | 'rate-of-mean'`
      field beside `hr`, so a cross-node consumer can refuse a mismatched pair instead of differencing
      it. Additive; the Integrator's `normalizeFile` ignores unknown keys.
- [x] **ISOLATED 2026-08-04 — it is the interval distribution's SHAPE, dominated by variability.**
      Regressing the per-block gap on the block's own RR statistics, 1670 real blocks:

      ```
      gap ≈ 0.2989 − 8.7175·CV + 0.2121·skew        R² = 0.601, residual SD 0.309 bpm (raw 0.489)
      r(gap, CV) = −0.719    r(gap, skew) = +0.690    r(gap, HR level) = −0.134  (negligible)
      ```

      Real overnight RR has **mean CV 0.0522, mean skew −0.671**; substituting gives **−0.298** against
      the measured **−0.299**.

      **That also explains why the three probes failed**, which was the evidence for "no mechanism":
      a smooth series has too little CV, and injected long **pauses are POSITIVELY skewed** where real
      overnight RR is **negatively** skewed — hence the +0.54 sign flip. The probes were not evidence of
      no mechanism, they were three points off the surface.

      With the driver known the number is reproducible **without a corpus**: a synthetic at CV 0.0506
      and negative skew gives **−0.307**. The gate is upgraded from source-scan-only to asserting the
      value, so a fresh clone checks the magnitude and not merely that the two estimators differ.

      Not claimed: a closed form. 60 % of variance explained by two shape statistics is a driver, not a
      derivation — the residual 0.309 bpm is unmodelled.
- [ ] **Re-read §2 of the parent** with the confound removed. Its bias table compared node epoch HR
      directly; every row inherits the same artifact, so the *ordering* of the corners may survive while
      the magnitudes do not.

## 4 · Explicitly NOT owed

- **Re-deriving the σ papers.** §2 measures the effect at under 2 % on the affected leg, inside their
  stated uncertainty. A correction here would be churn, and `FIXTURE-VERIFICATION-GATE`'s rule applies:
  do not move a published number without a measurement that says it moved.
- **The ResMed fourth corner**, *for this question*. `R5` still needs it for independence and σ
  accuracy; it is not what unblocks the bias item, and iteration-27's claim that it was is retracted in
  the parent.

## Cross-references
- Parent: `R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md` §5 (bias item, resolved).
- `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` — Finding A (the hat is blind to bias) is *reinforced*:
  here the bias was not even a device property and the hat still could not see it.
- Reproduce: `DEX_UPLOADS=<corpus> node tools/oxy-hr-bias.mjs` (LEG 3) ·
  `node tools/o2ring-finger-validate-batch.mjs <capture-dirs…>`
