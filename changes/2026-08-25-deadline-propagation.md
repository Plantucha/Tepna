---
bump: patch
type: fixed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Pin that close_harvest_decision propagates its deadline to flush_gate rather than dropping it. The
mutant that passes None survived every behavioural test because step 3 already refuses a gone window,
making the gate's deadline branch unreachable from the composition — so the fix tests the wiring with
a spy, and the docstring is corrected to say the redundancy is not what it claimed.
