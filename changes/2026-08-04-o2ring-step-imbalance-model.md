---
bump: patch
type: added
nodes: []
brief: O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md
---

Measures §2 and falsifies its model. §7.2 explains the O2Ring's 159/180 duration-step split as a beat
between the ring's 1.00346 s second and the ~1.0028 s poll interval; §2 asked whether that predicts the
ratio. It does not: across 55 usable sessions the observed imbalance is +0.00069 at a 0.990 s poll and
−0.00067 at 1.005 s, where the model predicts −0.0131 and +0.0010 — a sign change and a ~20× swing that
the data does not show, Pearson r = −0.084. `step_imbalance` is therefore descriptive permanently
rather than provisionally. Ships `tools/o2ring-step-imbalance.mjs` to reproduce it, whose filter is the
experiment: 1503 of 1558 OXYFRAME sessions have a duration counter that never advances, and leaving
them in produces a confident r = −0.213 over mostly flat lines. Also records that §1 is blocked on a
capture rather than on work — the ppg_n columns landed 2026-08-03 and no ring capture on disk carries
them.
