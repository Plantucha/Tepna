---
bump: patch
type: changed
nodes: [oxydex]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

The SHHS desaturation-scoring convention is re-measured at cohort scale, correcting a figure taken
from the signal-carrying subset.

It was characterised as "a median 70.9 % of scored desaturations are shallower than 3 %" from the 99
records that have EDFs. The annotation side of SHHS1 is the full cohort — 5136 scored records, no
signal file required — and the same statistic there is **66.7 %** per-record median, or **59.3 %**
pooled over **735 880** events.

    5136 records · 735 880 desaturations · 0 records with none
    depth: min 0.0 · p25 1.0 · median 2.0 · p75 4.0 · p95 8.0 · max 59.0 %

The conclusion is unchanged — most SHHS-scored desaturations are shallower than any threshold index
counts, which is why pairing their raw event count against ODI-3 was invalid. The number moved ~4
points, which is the useful part: a scoring convention is a property of the COHORT, and 99 records
over-stated it. Nothing in the analysis needed signals, so the narrow sample was convenience.

Filed as residue `2026-09-13-convention-measured-on-the-signal-subset`, because the habit is the
defect: event-rate distributions, hypopnea/apnea ratios, arousal counts and stage fractions are all
computable over 5136 and have so far been taken over 99 or fewer.
