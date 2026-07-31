<!--
  POOLED-CLOCK-FIT-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-31 · **Follow-up:** `POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md` · **Found while executing:** `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md` §2d · **Affects:** `integrator-dsp.js fitClockOffset`, `tools/trio-batch.mjs`, `integrator-app.js`, every CPAP↔wearable offset the suite reports

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

- [x] `fitClockOffsetPooled` exists, is exported, and is gated in `tests/dex-tests.js` — including a
      **planted-offset recovery** test and a **null control** proving the statistic does not fire on
      shuffled anchors (the pair, or neither). **27 assertions**, `integrator-dsp · clock-fit-pooled`.
- [x] Per-night confidence is calibrated in-run (§5.2) and asserted to be false on a null-level night.
      The **in-run gap-shuffle null** was taken, not split-half — see §8.2 for the property that decided it.
- [x] The corpus comparison is re-run and recorded here (§8.1): pooled vs vote, per night, with the null.
- [x] `CROSS-DEVICE-CLOCK-SKEW` §2d amended (§5.4) — the 7/7 claim retracted in place, the desat-SNR
      framing corrected, and the §2b prediction row updated with the two post-correction nights.
- [x] `trio-batch` + `integrator-app` cut over; `fitClockOffset` marked deprecated, not deleted.
      `runFusion` cut over too — it is the producer `integrator-app` reads, so the app could not have
      been switched without it. Verified **display-only**: `skewApplied` shifts events by
      `detectClockSkew`'s finding, never by anything the fit computes.
- [x] Gates: suite green in both lanes (**4529 assertions / 296 groups**) · GATE A 9/9 + GATE B 13
      reproducible · `build --check` 11/11 clean · `integrator_tch_golden` re-verified under the moved
      compute closure (`computeHash 06cc68676ffb → 133571f75a1d`).

---

## 8 · Executed 2026-07-31 — what the corpus actually said

### 8.1 · Pooled vs vote, all 31 nights

`⚠` marks a vote outside the 36–42 min band. Pooled offsets are **bold**; `Z` is the pooled peak,
`nullZ` the maximum over that night's own 30 gap-shuffles, `p` the permutation p-value.

| night | apneas | vote (min) | vote conf | **pooled (min)** | Z | nullZ | p | pooled conf |
|---|---|---|---|---|---|---|---|---|
| 2026-06-10 | 18 | 38.65 | yes | **38.78** | 10.84 | 7.62 | 0.032 | yes |
| 2026-06-11 | 24 | 38.77 | yes | **38.50** | 11.25 | 8.66 | 0.032 | yes |
| 2026-06-12 | 20 | 37.90 | yes | **38.17** | 11.02 | 7.92 | 0.032 | yes |
| 2026-06-14 | 8 | — *(no channel fit)* | no | **38.17** | 8.92 | 8.48 | 0.032 | yes |
| 2026-06-15 | 37 | 1.53 ⚠ | **yes** | **39.05** | 10.82 | 8.69 | 0.032 | yes |
| 2026-06-16 | 18 | 38.70 | yes | **38.13** | 17.25 | 11.31 | 0.032 | yes |
| 2026-06-19 | 13 | — *(no channel fit)* | no | **38.02** | 10.38 | 13.11 | 0.097 | no |
| 2026-06-20 | 21 | 38.52 | yes | **38.28** | 10.08 | 7.88 | 0.032 | yes |
| 2026-06-24 | 14 | 38.67 | yes | **39.23** | 12.18 | 9.78 | 0.032 | yes |
| 2026-06-25 | 35 | 27.10 ⚠ | no | **38.88** | 8.81 | 8.97 | 0.065 | no |
| 2026-06-27 | 53 | 39.43 | no | **39.08** | 8.15 | 7.40 | 0.032 | yes |
| 2026-06-28 | 23 | 38.52 | yes | **38.15** | 11.16 | 7.71 | 0.032 | yes |
| 2026-06-29 | 20 | 37.43 | yes | **38.07** | 14.48 | 11.40 | 0.032 | yes |
| 2026-06-30 | 11 | 37.62 | yes | **41.15** | 10.84 | 11.27 | 0.065 | no |
| 2026-07-01 | 24 | 39.12 | yes | **38.92** | 11.12 | 9.14 | 0.032 | yes |
| 2026-07-02 | 24 | 31.98 ⚠ | no | **37.98** | 13.32 | 9.61 | 0.032 | yes |
| 2026-07-04 | 30 | 38.72 | yes | **38.28** | 11.86 | 10.45 | 0.032 | yes |
| 2026-07-05 | 9 | — *(no channel fit)* | no | **38.78** | 8.71 | 7.55 | 0.032 | yes |
| 2026-07-06 | 32 | 37.70 | yes | **37.90** | 8.56 | 10.32 | 0.129 | no |
| 2026-07-07 | 18 | 38.23 | no | **38.70** | 7.70 | 8.31 | 0.097 | no |
| 2026-07-08 | 42 | 37.88 | yes | **38.07** | 10.87 | 7.78 | 0.032 | yes |
| 2026-07-09 | 17 | 38.27 | yes | **37.82** | 9.62 | 9.52 | 0.032 | yes |
| 2026-07-11 | 17 | 39.35 | no | **37.52** | 9.28 | 8.83 | 0.032 | yes |
| 2026-07-12 | 13 | 38.42 | no | **38.78** | 8.13 | 7.68 | 0.032 | yes |
| 2026-07-13 | 13 | 38.13 | yes | **38.80** | 6.94 | 7.49 | 0.129 | no |
| 2026-07-25 | 8 | — *(no channel fit)* | no | **38.68** | 7.56 | 8.79 | 0.161 | no |
| 2026-07-26 | 28 | 38.20 | yes | **37.92** | 16.00 | 9.02 | 0.032 | yes |
| 2026-07-27 | 16 | 38.12 | yes | **38.55** | 11.43 | 8.40 | 0.032 | yes |
| 2026-07-28 | 12 | 40.03 | yes | **38.58** | 8.85 | 8.16 | 0.032 | no *(ambiguous)* |
| 2026-07-29 | 26 | −43.47 ⚠ | no | **−22.25** | 9.94 | 12.61 | 0.194 | no |
| 2026-07-30 | 19 | −21.82 ⚠ | no | **−21.13** | 6.21 | 9.19 | 0.516 | no |

**29 / 29 pre-correction nights in band** (37.52 … 41.15, median 38.50) against **22 / 25** for the
vote, reproducing §1 exactly. The four nights no channel could fit individually — 06-14, 06-19, 07-05,
07-25 — all resolve, all in band. Whole corpus: **2.3 s**, 66–156 ms per night including 30 null refits.

### 8.2 · The property that matters more than the headline

**Every night the pooled fit calls confident is in the band: 21/21. Every night it is not confident is
*also* in the band: 8/8.** So the in-run null is **conservative, never wrong-directioned** — it
withholds confidence from correct answers rather than granting it to wrong ones. That is the failure
direction to want, and it is the opposite of the vote, whose one `confident` error (2026-06-15, 1.53 min)
is what §2 retracts.

It also settles §5.2's open choice. The gap shuffle preserves the anchor count, span and interval
distribution, so it degrades honestly on **periodic** anchors: a periodic train reproduces itself under
shuffling, the null scores as high as the truth, and confidence is refused — correctly, because a
periodic anchor train determines the offset only *modulo its period*. A uniform-scatter null would have
hidden that ambiguity behind a confident flag. Gated (`a periodic anchor train is NOT confident,
however high its Z` — Z 15.22 against nullZ 15.22).

### 8.3 · What execution added that the brief did not ask for

- **The planted-offset control §6 called "the single most valuable thing execution can add"** is in the
  gate: offset 2297 s planted into three channels, recovered at **2303 s**, with the null control beside
  it. It immediately earned its keep — the first version of the estimator failed it by **37 s**, because
  a hard ±45 s match window makes the peak a ~90 s *plateau* and the argmax inside it was being set by
  whichever unrelated channel tilted it. The point estimate is now the plateau's **centroid**, and
  `spreadSec` publishes the width being centred rather than implying a precision the window cannot give.
- **`underpowered`** — a defect this brief's method had until it was pointed at a *different* question.
  A permutation p-value from N shuffles bottoms out at 1/(N+1), so below 19 shuffles `p ≤ 0.05` is
  unreachable and every night returns "indistinguishable from its own null". Run at `nullIters: 10`
  across 44 channel pairs it returned **zero significant results** — a clean negative finding that was
  entirely an artifact of the setting. The fit now reports `underpowered` + `pFloor` and names the
  setting rather than blaming the data. Same discipline as `apneaTyping.underpowered`.
- **`fitClockOffset` is deprecated, not deleted**, per §5.5, and both remain exported and gated so the
  corpus comparison above can be re-run at any time.
