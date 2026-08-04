---
bump: patch
type: added
nodes: []
brief: TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md
---

Refutes the brief's proposal to relativise buildNN's epoch-level guard, and pins the refutation so it is
not re-proposed. The premise is right that burst beats at 0.37 to 0.45 pass the 0.30 per-beat threshold,
but the suggested remedy -- an epoch mean SQI well below the record's own median -- is wrong in timescale
rather than in threshold, because a burst lasts seconds and a five-minute epoch mean dilutes it to a few
percent.

Measured on the real corpus, a night carrying 664 seconds of confirmed burst artifact has a lowest epoch
SQI of 0.938 times its record median, against 0.953 on a night with zero artifact seconds; pooled over
474 epochs on seven nights the entire ratio range is 0.879 to 1.364, so there is no low tail to threshold
on. Meanwhile the guard the item asks for already exists one level finer: beatConfidence slides a plus or
minus 30 second window requiring beat density to be an upper outlier and SQI depressed, both against the
record's own median, and it fires on exactly those nights.

Gated with planted truth in both lanes, stating the sensitivity boundary rather than an absolute claim: a
20 second burst is 37 percent of its epoch and the epoch mean does see it at 0.787, while a 2 second
burst is 5.4 percent and the epoch mean is blind at 0.969 though the guard still flags it. The bound is
asserted in both directions so that if a corpus ever shows epoch ratios far below 0.85 the item can be
reopened on evidence. Two mutants confirm the gate fails by value.
