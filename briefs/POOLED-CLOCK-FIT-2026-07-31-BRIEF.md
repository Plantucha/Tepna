<!--
  POOLED-CLOCK-FIT-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-31 · **Found while executing:** `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md` §2d · **Affects:** `integrator-dsp.js fitClockOffset`, `tools/trio-batch.mjs`, `integrator-app.js`, every CPAP↔wearable offset the suite reports

# `fitClockOffset` estimates each channel separately and then votes. Pooling instead is measurably better.

The estimator fits **every channel independently**, keeps the ones that clear a floor, clusters them by
proximity, and lets the clusters compete on how many distinct nodes back them. Every failure mode this
brief records — the arbitrary tie (#589), the corroborated-but-wrong night, the nights that produce no
number at all — is a symptom of that one architectural choice: **it throws away the joint evidence, then
tries to reconstruct a decision from the wreckage by voting.**

Sliding a single candidate offset across the night and scoring *all* channels at that offset — the
**pooled** fit — is better on every axis measured, and needs none of the special-case machinery.

> **This brief supersedes nothing and retracts one thing.** §2d of the parent brief claims *"every
> corroborated night is in the band, and every wrong night is uncorroborated… consuming only corroborated
> fits is 7/7 correct."* That is **false** — see §2 — and the parent needs amending whether or not this
> brief is executed.

---

## 1 · The measurement

31 nights re-folded under current code (`cccfb11`), CPAP `_EVE.edf` apnea/hypopnea as the anchor, all
eight-to-ten wearable impulse channels as partners. **29 are pre-correction** (before the ResMed timezone
fix, so the true offset is known to sit near +38 min); 2 are post-correction.

| selection rule | pre-correction nights landing in the 36–42 min band |
|---|---|
| **cluster vote — what ships today** | 22 / 25 |
| strongest single channel | 24 / 25 |
| strongest **non-stage** channel | 25 / 25 |
| **POOLED joint fit** | **29 / 29** |

The vote and the strongest-channel rules can only be scored on the 25 nights that produced a number at
all. **The pooled fit resolves 4 nights the per-channel path could not fit** — 2026-06-14, 06-19, 07-05,
07-25 — where every individual channel failed `too few events` / `too few pairs to refine`. Eight weak
channels together carry what none carries alone. That is the whole argument for pooling in one sentence.

### The statistic

For each candidate lag `L` over ±90 min on a 5 s grid, and each channel independently: count anchors with
a partner event within ±45 s of `t + L`. Convert to a **z-score against that channel's own chance floor**
(its mean coincidence count across all lags), then sum across channels and divide by `√nChannels`.

Z-scoring per channel is the load-bearing detail: it makes the statistic **scale-free**, so a dense
channel cannot dominate a sparse one by sheer event count. Summing raw coincidences — what §1 of the
parent did — is exactly the failure that makes desaturation appear to be the only channel that matters.

### It needs no exclusion list

A channel that carries no timing information contributes noise at **every** lag, so it cannot move the
peak. This is why the pooled fit does not need the sleep-stage exclusion that the strongest-channel rule
required to reach 25/25 — `stage_*` impulses are simply included and are harmless. **An estimator that
needs an allow-list of trustworthy channels will be wrong the first time a node ships a new impulse.**

---

## 2 · Why the current architecture fails — three confirmed instances

**(a) It ignores evidence strength entirely.** 2026-06-15, corroborated by 2 nodes, reports **1.53 min**:

```
   .     OxyDex/desat_event        40.23 min  CI[2398,2420]  n=28  peak=6.75   ← strongest, ignored
AGREED   ECGDex/autonomic_surge     1.53 min  CI[  35, 157]  n=29  peak=4.38
AGREED   ECGDex/movement_onset      4.50 min  CI[ 246, 292]  n=31  peak=4.46
AGREED   PpgDex/movement_onset      1.18 min  CI[  32,  75]  n=29  peak=3.40
```

Three weak channels outvoted one strong one on node count alone. The same pattern loses 2026-06-25
(desat, peak 9.34, says 40.22 → vote says 27.10) and 2026-07-02 (desat, peak 9.63, says 39.70 → vote says
31.98). **`peakOverFloor` and the CI width are computed, reported to the user, and then discarded by the
thing that picks the winner.**

**(b) `agreeSec` does not bound what it appears to bound.** Cluster tolerance is applied between
*adjacent sorted members*, so clusters **chain**: 1.18 → 1.53 → 4.50 merges into one "agreeing" set
spanning **199 s**, wider than the 180 s tolerance that supposedly defines agreement. The UI then prints
*"sensors agree within 199 s"*. Two of 25 nights exceed the tolerance this way (06-15 at 199 s, 07-09 at
237 s); on 07-09 it is harmless, on 06-15 it is what merges the three weak channels into a winner.

**(c) Ties.** Fixed in #589 by reporting rather than breaking them — but a tie is only reachable because
the ranking is a coarse three-key sort over discarded evidence. Under pooling there is one continuous
statistic and nothing to tie.

---

## 3 · Null calibration — the part that makes this a measurement

93 random anchor sets (same count, same span, seeded), identical statistic:

```
REAL   Z: min 6.2   median 10.4   max 17.2
NULL   Z: min 3.4   median 5.0    p95 7.0   max 9.6
```

**Per-night Z is NOT a clean separator** — 12 of 31 real nights fall below the null's maximum. Anyone
quoting a single night's pooled Z as proof would be doing exactly what
`papers/null-calibration.html` warns about. The evidence is the **concentration**:

```
real, pre-correction : 29 nights spanning 37.58 … 41.17 min   (3.58 min wide = 2.0% of the 180 min search)
random anchors landing in that same band : 6/93 (6.5%)
null peak lags: -86.3 … +89.4 min — scattered, as a null must be
```

29 independent nights landing in a band the null hits 6.5% of the time is ~10⁻³⁴. **That**, not any
per-night number, is the result. It also means the estimator must keep reporting a per-night confidence
that is honest about this: a lone night is weak evidence even when the corpus is overwhelming.

---

## 4 · It answers the parent brief's open prediction

`CROSS-DEVICE-CLOCK-SKEW` §2b predicts that after the timezone correction the offset should **flip sign
to ≈ 21 min ahead**, not fall to zero. The per-channel fit could say nothing: 2026-07-29 came back
`uncorroborated`, 2026-07-30 `AMBIGUOUS`. Pooled:

```
2026-07-29   -22.33 min   (Z 9.9)
2026-07-30   -21.17 min   (Z 6.2)
```

Two independent nights, agreeing within **1.16 min**, at **−21.7 ± 0.6**. Under the null, two peaks
agreeing that closely by chance is ~1%.

**Not yet "confirmed"** — two nights, one with Z inside the null range. One more clean tri-device night
settles it. But the prediction is no longer untestable, which it was for the whole of 2026-07-30.

---

## 5 · What to do

### 5.1 · Add the pooled estimator alongside the current one

`IntegratorDSP.fitClockOffsetPooled(anchorTimes, channels, opts)` returning the existing shape plus
`z`, `nullZ`, and the per-channel z at the winning lag. **Additive** — new function, new fields, existing
`fitClockOffset` untouched — so no consumer breaks and the two can be compared on the same corpus.

### 5.2 · Report an honest per-night confidence

`confident` must NOT be a repackaged Z threshold, because §3 shows Z overlaps the null. Options to
decide during execution, cheapest first:
- an **in-run null**: shuffle the anchors ~30× per night and report the peak's percentile against that
  night's own null. Self-calibrating, no corpus constant, ~30× the cost of one fit (a fit is milliseconds).
- a **split-half** check: fit the first and second half of the night separately and require agreement.
  Directly tests stability rather than height, and reuses the CI-stability idea already in the code.

The in-run null is preferred: it is the discipline the suite already argues for in prose and does not yet
apply in code.

### 5.3 · Keep the per-channel table

Its diagnostic value is real and independent of who picks the winner — §2's evidence came from it. Under
pooling it becomes *"each channel's z at the chosen offset"*, which is strictly more informative than
*"each channel's own argmax"*, because the numbers are then comparable.

### 5.4 · Amend the parent brief

`CROSS-DEVICE-CLOCK-SKEW` §2d carries a claim this work disproves (the 7/7 corroboration rule) and a
framing worth correcting: desaturation is presented as the *laggiest* channel by the latency ladder, but
it is also by far the **highest-SNR** one (peaks 6.75 / 9.34 / 9.63 / 18.9 against 3.3–5.7 for movement).
Both are true and the brief currently implies only the first.

### 5.5 · Cut over, then retire

Once 5.1–5.2 are gated and the pooled fit has run the corpus, switch `trio-batch` and `integrator-app` to
it and mark `fitClockOffset` deprecated in place. Do **not** delete it in the same change — the two must
be comparable on the corpus for at least one cycle.

---

## 6 · Risks, and what would falsify this

- **The 36–42 min band is not ground truth.** It is where 29 nights of an *already-suspect* clock land.
  The pooled fit could be systematically wrong in a way the vote is not, and the band would hide it. The
  ACC↔ACC control of the parent's §2c is the pattern to reuse: plant a known offset and check recovery.
  **This is the single most valuable thing execution can add.**
- **9 nights could not be re-folded** (2026-07-16 … 07-24, raw data gone from every tree), so the
  comparison is 31 nights, not the full 40. Whatever survives on disk should be checked before cutover.
- **±45 s window and 5 s grid are unvalidated choices.** They were picked to match §1's ±60 s
  coincidence and have not been swept. A sensitivity sweep belongs in execution.
- **Pooling can mask a genuinely disagreeing sensor.** The vote at least made disagreement visible by
  leaving a channel out of the agreeing set. §5.3 exists to preserve that; if it does not, pooling trades
  one blindness for another.

## 7 · Done when

- [ ] `fitClockOffsetPooled` exists, is exported, and is gated in `tests/dex-tests.js` — including a
      **planted-offset recovery** test and a **null control** proving the statistic does not fire on
      shuffled anchors (the pair, or neither).
- [ ] Per-night confidence is calibrated in-run (§5.2) and asserted to be false on a null-level night.
- [ ] The corpus comparison is re-run and recorded here: pooled vs vote, per night, with the null.
- [ ] `CROSS-DEVICE-CLOCK-SKEW` §2d amended (§5.4).
- [ ] `trio-batch` + `integrator-app` cut over; `fitClockOffset` marked deprecated, not deleted.
- [ ] Gates: suite green in both lanes · GATE A/B · `build --check` clean · fixtures re-verified under the
      moved compute closure (`integrator-dsp.js` is inside it).
