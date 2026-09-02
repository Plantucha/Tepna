<!--
  R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-09-02 (statistic-naming BUILT across all producers and the Integrator consumer; the −0.299 bpm gap gate was upgraded from source-scan to **asserting the value** with an anti-vacuity leg. **PARKED on one owner decision**: §3's `median→mean` switch moves a published field and needs a ruling on `hrStatMixed` semantics — *per Heron's read, not independently re-verified*) · **Created:** 2026-08-04 · **Spawned-by:** `R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md` (bias item, executed) · **Affects:** every cross-node HR comparison — `oxydex-dsp.js` `oxyBuildEpochSeries`, `ecgdex-dsp.js` epoch builder, the HR three-cornered hat

> **TRIAGED 2026-09-01 — measurement complete; the one residue is an OWNER ROUTING DECISION, not code.** §3's four owed items: three are `[x]` (the epoch block names its statistic via `hrStat`; the spread is ISOLATED to the interval distribution's shape; the parent's §2 attribution is RE-READ and corrected). The fourth is `[~]` by design — the fleet statistic is `rate-of-mean` and OxyDex's closest unbiased proxy is the arithmetic mean of its 1 Hz rates, but **OxyDex has no intervals**, so the switch is *routed, not taken*. Taking it changes a published value and is therefore an owner call. §4 is explicitly NOT owed. Nothing here is open to code.

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

- [~] **MEASURED 2026-08-04 — the fleet statistic is `rate-of-mean`, and OxyDex's closest unbiased
      proxy for it is the arithmetic MEAN of its 1 Hz rates. The switch itself is routed, not taken.**

      **OxyDex cannot compute the fleet statistic directly.** It has no intervals — `parseCSV` yields
      `tMs, t, spo2, hr, motion, pi`, a 1 Hz rate column and nothing else. So `60000/mean(RR)` is not
      available to it and the question is which aggregation of a rate series best estimates it.

      Measured against ECGDex over 726 paired epochs:

      | OxyDex estimator | bias vs ECGDex | | spread SD |
      |---|---|---|---|
      | `median(rate)` — **ships today** | −0.244 | 5.7σ | 1.16 |
      | trimmed 20 % | −0.201 | 4.8σ | 1.14 |
      | trimmed 10 % | −0.156 | 3.6σ | 1.17 |
      | trimmed 5 % | −0.113 | 2.5σ | 1.20 |
      | **`mean(rate)`** | **+0.013** | **0.3σ** | 1.23 |

      Monotonic and one-sided: the robustness the median buys costs **0.26 bpm of bias** and saves
      **6 % of spread**. `mean` removes essentially the whole cross-node HR bias this brief family began
      with.

      ⚠ **The theoretically-correct estimator LOSES, and the reason is measurable.** For instantaneous
      rates the harmonic mean equals `60000/mean(RR)` exactly, so it should win — it does not
      (−0.083, 1.9σ). The ring's `pr` is **already smoothed**: same overall SD as beat-to-beat ECG
      (4.09 vs 4.19) but **5.1× less consecutive-sample jitter** (0.256 vs 1.298 bpm). Applying a
      convexity correction to a series that has already absorbed one over-corrects. Do not "fix" this
      back to the harmonic mean on theory.

      **Not switched here, deliberately.** It is a one-word change (`_median(b.hr)` → `_mean(b.hr)`) but
      it moves a published field on a shipped node, re-records OxyDex's fixtures, and — because
      `mean-rate` is still not `rate-of-mean` — requires deciding what the `hrStatMixed` flag should say
      when the legs differ in NAME but agree to 0.3σ in VALUE. That last part is a design question this
      measurement does not answer, and shipping the switch without it would leave a flag that fires on
      every night while the bias it warns about is gone.
- [x] **SHIPPED — the epoch block NAMES its statistic.** `hrStat` is emitted beside `hr` by OxyDex
      (`'median-rate'`), ECGDex and PpgDex (`'rate-of-mean'`), at BOTH the internal epoch builder and the
      export projection — each node builds epochs twice and a first attempt labelled only one, shipping a
      field that every golden read as `undefined`. The Integrator's epoch adapter is a whitelist, so it
      needed the key added explicitly; it now publishes `hrStats` / `hrStatMixed` and appends a ⚠ to the
      HR hat's note when the corners disagree. A cross-node consumer can now refuse a mismatched pair
      instead of differencing it.
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
- [x] **RE-READ 2026-08-04 — the parent's §2 ATTRIBUTION is wrong, and the correction is paired.**
      §2 reads *"OxyDex systematically under-reads HR by ≈ 0.36 bpm, and it survives artifact gating — so
      it is not contamination, **it is the device** (or the pulse-oximetry HR path)."* The device is not
      what that measured.

      The decisive test is **paired**: hold the epochs, the nights and the pairing fixed and change only
      the aggregation. Over the same 726 paired epochs, `median(rate) → mean(rate)` moves the OxyDex−ECGDex
      bias from **−0.244 bpm (5.7σ) to +0.013 bpm (0.3σ)**. No device property can move by 0.26 bpm because
      the analyst picked a different average. **~0.26 bpm of the parent's −0.36 is the estimator.**

      It is corroborated from the other side: the ring's own firmware HR agrees with chest-ECG to **0.6σ
      over 237 windows** (`tools/o2ring-finger-validate-batch.mjs`). Both legs say the ring is unbiased.

      **The ordering does NOT survive — it inverts.** §2 reads as *PpgDex clean, OxyDex biased by hardware*.
      PpgDex already computes `rate-of-mean`, i.e. ECGDex's own statistic, so its **−0.028** row never
      carried this confound and stands. OxyDex's row is the one made of artifact. The honest re-reading is
      that **both optical corners are unbiased against chest-ECG**, and the fleet's one measured HR bias was
      a comparison artifact — which is a *stronger* statement of `TCH-REFERENCE-VALIDATION` Finding A than
      the parent made: the hat was blind to a bias that was not even real.

      ⚠ Not a re-derivation of the parent's absolute −0.436/−0.357 (different gating, n=1192 vs 726). The
      claim is the **paired delta**, which is gating-independent by construction, and the **attribution**.

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
