---
bump: patch
type: fixed
brief: none
---

Stop GlucoDex publishing a 5-minute cadence nothing measured: a daily or spot export now reports `cadence: null` with a named reason and a separately-named assumed grid step, and every minute total derived from that rate (activeMin, gapMin, warmupMin, compMin, durDays, longRec) reports the absence instead of a plausible number.
