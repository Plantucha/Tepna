<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-22 (§1 CLOSED by measurement 2026-08-20 — `kSQI` discriminates, re-scale declined with a reason. §2 Do 1(b) DECLINED 2026-08-22 with the leverage bounded at ~0.18 epochs/night and a named falsifier, not merely cited as 0.19 %. §3 is a method note.) · **Created:** 2026-08-20 · **Follows:** `TCH-FUSED-ROBUST-HAT-FOLLOWUPS-2026-07-14-BRIEF.md` (all five Do items closed 2026-08-20) · **Affects:** `ecgdex-dsp.js` composite per-beat SQI

# What closing the fused-hat transfer map surfaced

The parent's five Do items are done: four were measured and either refuted or found already shipped,
and Do 5 was executed — `bSQI` made observable (#1553) and the defect underneath it fixed (#1554).
This brief carries what turned up on the way and is **not** part of that work-unit.

## 1 · `kSQI` is the term actually running low on real data — median 0.457 of a possible 1

Measuring `bSQI` required surfacing all four terms of the composite per-beat SQI
(`0.30·kSQI + 0.28·bSQI + 0.24·rrPlaus + 0.18·ampOK`). Over 16 real H10 segments, 30,306 beats:

| term | weight | min | p25 | median | p75 | max |
|---|---|---|---|---|---|---|
| **kSQI** | 0.30 | 0.3262 | 0.3694 | **0.4572** | 0.4785 | 0.5199 |
| bSQI | 0.28 | 0.7423 | 0.8249 | 0.9951 | 0.9991 | 1.0000 |
| rrPlaus | 0.24 | 0.9930 | 0.9994 | 1.0000 | 1.0000 | 1.0000 |
| ampOK | 0.18 | 0.9991 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |

Three of four terms sit at ceiling on clean beats. `kSQI` never exceeds **0.52** on any segment, and its
whole observed range is 0.33–0.52 — a span of 0.19 on a [0,1] scale, i.e. it is close to a **constant**.

`kSQI = clamp((kurt − 2.5) / 8, 0, 1)`, so 0.457 implies a windowed kurtosis of ~6.2 against a source
comment expecting *"clean QRS window: kurt ~5–15"*. A value at the bottom of the intended band, on every
clean beat, on every segment.

**The question is which of two things this is, and they need opposite responses:**

- **(a) the mapping is mis-scaled for this hardware** — real H10 QRS windows produce kurtosis ~6, so the
  `/8` denominator was chosen for a different amplitude/bandpass regime, and the composite is losing
  ~0.16 of its 0.30 share on *every* beat. If so the whole score sits ~0.16 lower than designed and
  `sqiThr` 0.3 is effectively a stricter gate than it reads as.
- **(b) it is working as intended** — kurtosis is doing fine-grained discrimination in a narrow band and
  the absolute level is irrelevant because only *relative* differences gate anything.

⚠️ **Do not "fix" this by re-scaling until (a) is established.** Every term is spent through one
threshold (`buildNN`'s `sqiThr` 0.3), so raising `kSQI` across the board changes which beats enter the
tachogram, which moves every downstream HRV number and every ECGDex fixture. That is the same trade the
parent measured for Do 1(b) and declined at 0.19 % leverage.

**Done when:** the discriminator is measured — does `kSQI` **separate** clean beats from artifact beats
within a record (variance across beats, and its correlation with the other three terms), or is it
near-constant? A term that is constant carries no information regardless of its level, and that answer
decides between (a) and (b) without changing a line of compute.

- [x] `kSQI` per-beat distribution measured WITHIN records, not just its per-record mean
- [x] (a) vs (b) decided against that — **(b), and a re-scale is DECLINED with a reason**

### ANSWERED 2026-08-20, same day — it discriminates, and re-scaling would make kurtosis alone sufficient

The discriminator was the cheap one this section named: does `kSQI` VARY within a record? Per-beat, over
8 segments (~2400 beats each), replaying the same 0.13 s kurtosis window `computeSQI` uses:

| segment | n | mean | sd | **CV** | p5 | p95 | clamped@0 | **clamped@1** |
|---|---|---|---|---|---|---|---|---|
| 0617 part01of05 | 2524 | 0.369 | 0.167 | **0.452** | 0.077 | 0.634 | 38 | **0** |
| 0617 part02of05 | 2383 | 0.406 | 0.145 | 0.357 | 0.158 | 0.648 | 5 | **0** |
| 0617 part03of05 | 2400 | 0.344 | 0.147 | 0.427 | 0.079 | 0.576 | 27 | **0** |
| 0617 part04of05 | 2461 | 0.326 | 0.162 | **0.498** | 0.047 | 0.596 | 52 | **0** |
| 0625 part01of10 | 2074 | 0.468 | 0.070 | 0.150 | 0.387 | 0.560 | 14 | **0** |
| 0625 part02of10 | 2060 | 0.468 | 0.056 | **0.120** | 0.376 | 0.558 | 0 | **0** |
| 0625 part03of10 | 2064 | 0.504 | 0.061 | 0.122 | 0.407 | 0.606 | 0 | **0** |

**It is not near-constant — reading (b).** CV runs 0.12–0.50 and p5→p95 spans 0.047→0.596 on the noisier
night. The term is doing exactly the fine-grained discrimination §1 offered as the benign explanation,
and it separates the two nights too (0625 tight at CV ~0.12, 0617 broad at ~0.45 — the same night that
is noisier by every other measure).

**But the level offset is real, and the reason not to correct it is the interesting part.**
`clamped@1 = 0` on every segment: no real beat EVER saturates the top of the mapping, so the effective
range is ~[0, 0.65] rather than [0, 1] and `kSQI` contributes at most ~0.20 of its nominal 0.30. (It
CAN saturate — the `sqi · known-answer` group's single-sample spike reaches exactly 1.000 — just not on
ECG.)

⚠️ **Re-scaling is DECLINED because of what it would do at the threshold, not because the offset is
harmless.** The offset is uniform, so it changes no ORDERING — but `buildNN` gates on an absolute
`sqiThr` of 0.3, and 0.30 × 1.0 = 0.30 **is** that threshold. Re-scaling `kSQI` to use its full range
would make a good-kurtosis beat pass the gate **on the kurtosis term alone**, with detector B
disagreeing, an implausible RR and a dead-lead amplitude. Worked from the corpus's typical values, a
beat with `bSQI = 0` and `ampOK = 0` scores **0.135 today (excluded)** and would score **0.54
(included)** after a re-scale.

So the current low level is **protective**: it forces a beat to earn its place from more than one cue.
That is a stronger design than the nominal weights suggest, and correcting the "loss" would weaken it.
The composite's realistic ceiling for a clean real beat is ~0.85–0.90 rather than 1.0, which is worth
knowing when reading a `meanSQI`, and is not a defect.

**§1 is CLOSED. No compute change, as predicted — the measurement decided it.**

## 2 · Do 1(b) is the parent's one live question, carried forward

`beatConfidence` down-weighting inside `buildNN`/`epochEngine` changes computed outputs and forces a
fixture regen, to move **9 of 4845 epochs (0.19 %)**. The parent measured that number and declined to
spend it without a reason those 9 epochs reach a decision. That reason has still not been shown.

- [x] a case that low-`c` epochs change a published verdict, or Do 1(b) recorded as declined —
      **DECLINED 2026-08-22, with the leverage bounded rather than merely cited**

### DECLINED 2026-08-22 — bounded at ~0.18 epochs per night, and the falsifier is named

The parent declined on "0.19 %". That number is right but it is a *ratio*, and a ratio does not say
whether a verdict can move. Reading the code to the line puts a **magnitude** on it.

**What Do 1(b) can and cannot touch.** A beat with `c < 0.5` is **already gone** — `ecgdex-dsp.js:2411`
keeps a beat only `if (c >= 0.5)` and counts the rest in `artifactSec`; the file says so explicitly:
*"a beat below that is not down-weighted, it is gone."* So Do 1(b) is not about admitting bad beats.
It is about **weighting the survivors**, which span **[0.5, 1] by construction** — a weight range of at
most **2×**, applied to 9 of 4845 epochs.

**The epochs are 5 minutes, not 30 seconds** (`epochEngine(nn, tt, 300, nnSqi)`, `:2441`), and that
closes the arithmetic: 4845 × 5 min = **404 h**, which reconciles with the ~50-night corpus and
confirms the reading. So the 9 epochs are **45 minutes spread over 404 hours ≈ 0.18 epochs per
night**. On a typical ~8 h night (96 epochs) Do 1(b) changes **less than one epoch**.

**Why that matters more than the ratio.** The consumer that could plausibly flip is `stageSleep`
(`:2058-2072`), which is a per-epoch *classification* over `rmssd`/`hr`/`lfhf` and feeds the surfaced
`stageMinutes` (`:5132`). A mean absorbs 0.19 %; a classifier does not — 9 epochs could in principle
flip 9 labels. But at 0.18 epochs/night the per-night exposure is **one 5-minute label at most**, and
the cost is a fixture regen across all four ECGDex fixtures plus every downstream HRV number.

🔴 **The falsifier, stated so this decline is testable rather than permanent:** a night where a
*published* verdict sits within **one 5-minute epoch** of its threshold — a stage-minutes boundary, an
index band edge — AND one of the 9 low-`c` epochs falls on that night. Show that pairing and Do 1(b)
becomes worth its regen. Absent it, this is spending a fleet-wide fixture cycle to move a number that
cannot reach a decision.

**Not measured here:** which nights the 9 epochs fall on. That is the one query that would convert
this bound into a certainty, and it needs the parent's epoch-level run rather than a source read.

## 3 · The method note worth keeping

Three candidate fixes for Do 5 were compared, and **the aggregate ranked them wrongly**. The runner-up
moved the median by 0.009 — a rounding error — while degrading **six segments by 0.11 each**; a gain
concentrated on one item and a loss spread thinly over fifteen cancel in a mean. Only the **paired
per-segment diff** separated them.

**Whenever a change is evaluated over a corpus, keep the per-item BEFORE values and report the paired
diff and the count of items that moved in each direction.** The summary statistic is not a weaker version
of that answer; on this data it was the opposite answer.
