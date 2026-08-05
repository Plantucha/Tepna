---
bump: patch
type: added
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---

Waves 5 and 6 pin eight more `clock.js` guards — zero-padding, epoch digit bounds, finite zone offsets,
the hours→minutes conversion, the DMY-at-12 ambiguity, and the midnight-roll boundary. `clock.js` reaches
**104/127 = 81.9 %**, and all 23 remaining survivors are classified (equivalent, unreachable, or no
distinguishing input) — **100 % of distinguishable mutants**. That is the ceiling; 90 % raw is
unreachable without editing production code to satisfy the metric.
