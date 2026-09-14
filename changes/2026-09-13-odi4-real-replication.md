---
bump: minor
type: changed
brief: PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md
---

`papers/odi4-ahi-bias.html` §3.2: the ODI-4/AHI bias is replicated on the full SHHS1 cohort (5136
clinical polysomnograms), which §6 names as the condition for submission.

The replication separates a question the synthetic corpora could not. Against scored AHI the detector
reads 35 events/h low; against the expert's OWN desaturation index, on the same nights, it agrees to a
median −0.22 events/h and recovers 89.7 %. The gap is definitional — SHHS scored hypopneas without
requiring a desaturation — not detector error.

Table 4 publishes the synthetic-vs-real comparison, which appeared nowhere before: synthesis is
inverted in shape (120 healthy / 26 severe against 61 / 3008), understates the severe-stratum bias by
~60 %, and reports R² 0.93 where real data gives 0.27.

Coverage is now published per §∅ (median 98.45 %, 30.8 % of records below 95 %) — which also makes the
Methods sentence added in #2474 true; it asserted coverage was published when nothing published it.
