---
bump: minor
type: added
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Add pull.on_close, the §8/§14 close-triggered harvest's own flag, defaulting OFF and never inheriting
— unlike on_doff, which inherits because it was split out of an existing flag. The arming line now
prints all three trigger states including the OFF ones.
