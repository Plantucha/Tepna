<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-20 · **Follows:** `TCH-FUSED-ROBUST-HAT-FOLLOWUPS-2026-07-14-BRIEF.md` (all five Do items closed 2026-08-20) · **Affects:** `ecgdex-dsp.js` composite per-beat SQI

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

- [ ] `kSQI` per-beat distribution measured WITHIN records, not just its per-record mean
- [ ] (a) vs (b) decided against that, or recorded as declined with a reason

## 2 · Do 1(b) is the parent's one live question, carried forward

`beatConfidence` down-weighting inside `buildNN`/`epochEngine` changes computed outputs and forces a
fixture regen, to move **9 of 4845 epochs (0.19 %)**. The parent measured that number and declined to
spend it without a reason those 9 epochs reach a decision. That reason has still not been shown.

- [ ] a case that low-`c` epochs change a published verdict, or Do 1(b) recorded as declined

## 3 · The method note worth keeping

Three candidate fixes for Do 5 were compared, and **the aggregate ranked them wrongly**. The runner-up
moved the median by 0.009 — a rounding error — while degrading **six segments by 0.11 each**; a gain
concentrated on one item and a loss spread thinly over fifteen cancel in a mean. Only the **paired
per-segment diff** separated them.

**Whenever a change is evaluated over a corpus, keep the per-item BEFORE values and report the paired
diff and the count of items that moved in each direction.** The summary statistic is not a weaker version
of that answer; on this data it was the opposite answer.
