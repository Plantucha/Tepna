---
bump: patch
type: fixed
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

Score every optical channel across the whole night, not over one 90 s window at its midpoint. The 25th percentile of the per-window scores decides, so a channel wins the reference slot by holding up. Measured on 27 real nights: the old window picked a different channel on 8 of them.

One committed metric moves: the seeded `qrs-equiv` witness `PpgDex rMSSD (seed 12345)` reads 41.4 → 41.2. The pick leaves the channel that carries 10 % more motion for 5 % more pulse. A cleaner reference jitters the systolic foot less, so a successive-difference statistic falls. Every PpgDex fixture moves hash-only, because the real-night slice picks the same channel either way.
