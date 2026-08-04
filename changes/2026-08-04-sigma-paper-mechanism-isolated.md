---
bump: patch
type: changed
nodes: []
brief: TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md
---

Closes TCH-REFERENCE-VALIDATION. Its two remaining items were the fold into the sigma paper and the
follow-up brief owed for R2.

The fold had already happened: the paper's item (ix) carries the statement that the estimator has never
been validated against an external truth, that the hat has no bias term and is structurally blind to any
offset, and the retraction of the -0.269 bpm O2Ring figure as an estimator confound rather than a device
bias. One clause had gone stale, saying the -0.299 mechanism was not fully isolated and depended on some
unidentified feature of real overnight R-R. It was isolated: the gap is the shape of the interval
distribution, dominated by variability, and regressing it on each block's own statistics over 1,670 real
blocks reproduces the measured value to within 0.001. That also explains the synthetic series the paper
called puzzling, since each carries a different CV and skew.

Spawns TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS for R2's result, which deserves its own brief. The
per-pair correlated solve is sound, recovering planted sigma to 1e-6 across six triples including
all-pairs-correlated and mixed-sign cases. This triplet is degenerate: the measured correlation sits
within half a percent of the critical value at which the CPAP corner's sigma hits zero and past which
there is no solution at all. The 0.19 bpm it returns is the non-negativity boundary seen from the inside,
and unlike the classic hat's negative-variance case it occurs at a positive sigma, so no existing check
catches it.

Parent stamped DONE; the paper's docs copy rebuilt.
