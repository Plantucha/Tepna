---
bump: patch
type: fixed
brief: none
---

ECGDex reports an unmeasured RMSSD as `null` with a named reason instead of `0`, so `lnrmssd` no longer exports `-Infinity` and the firmware-comparison ratios refuse an absent or zero reference instead of publishing `Infinity`.
