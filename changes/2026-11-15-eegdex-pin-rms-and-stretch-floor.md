---
bump: patch
type: fixed
brief: none
---

Pin two EEGDex refusals that no assertion held. `rms` returns null over a window with no finite sample. `swaTrend` excludes a stretch with fewer than four N2 or N3 epochs.
