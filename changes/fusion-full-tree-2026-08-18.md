---
bump: patch
type: changed
brief: PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md
---

**§2's question is now answerable — and the answer is a null.**

The full PSL tree (20 nights, newly visible after #1503/#1506) against the shipped consensus:

| | shipped | mean-of-3 | PCA-1 |
|---|---|---|---|
| jitter median | **6.37 ms** (IQR 4.61–7.92) | 6.47 | 6.47 |
| PPV median | **100.00 %** (IQR 99.91–100) | 100.00 | 100.00 |

**18 of 20 nights are physiologically plausible**; exactly one shows the alternation defect. Against
§2's *6 of 12*, the corpus is no longer artifact-dominated, so its stated objection — *"judging a
waveform-source change on a corpus where half the nights are already artifact-dominated would measure
the artifact"* — no longer applies.

**Fusion does not help.** Paired per night, mean-of-3 wins **12 of 19** (ties dropped) — **sign test
p = 0.359, not significant** — while the median favours the shipped consensus by 0.10 ms. It wins
slightly more often and loses slightly bigger; that the two summaries disagree *is* the answer.

🔴 **Corrects the 6-night note from an hour earlier**, which said the deltas *"point the same direction
as the original finding"*. They do not: on 6 nights mean-of-3 led 9.08 vs 9.42; on 20 it trails 6.47 vs
6.37. **The direction reversed with sample size** — precisely what a capped sample cannot tell you. I
flagged the cap as a limitation and then described a direction from it anyway.
