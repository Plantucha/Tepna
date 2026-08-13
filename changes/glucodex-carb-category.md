---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

GlucoDex `carbCategory` was pseudo-tested — it labels every meal marker light / medium / heavy and
nothing asserted the bands, nor the 45-minute clustering that decides what a meal is. Both are now
gated through `parseNutrition` by known answer, together with the 8 g serving floor the fixture ran
into. Verified by re-applying 10 mutants: 10/10 killed. `carbCategory`'s null default is documented
as unreachable — both call sites pass a rounded sum.
