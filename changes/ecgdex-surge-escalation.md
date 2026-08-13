---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

ECGDex exposes `surgeEscalation` (additive export) so the overnight CVHR-surge trend can be gated by
known answer. It was pseudo-tested — computed on every long recording and asserted by nothing, while
publishing a sentence a user reads as a clinical impression ("instability signature"). Now pinned on
the thirds split, the per-hour rate, the escalation percentage, both label thresholds at their strict
edges, the zero-denominator branch and both entry guards. Verified by re-applying 16 mutants: 16/16
killed.
