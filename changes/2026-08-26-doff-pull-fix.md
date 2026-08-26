---
bump: minor
type: fixed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Fix the doff-triggered pull, which failed on its first production firing. Scope is now derived from
the trigger (not-worn → latest, charger → all); the settle clamp that silently turned a configured 45
into an effective 210 is deleted; and the power drop defers while a pull is in flight, resolving by
deferral the collision the clamp used to prevent. Owner-amended §4 for this path, 2026-08-26.
