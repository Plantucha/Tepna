---
bump: patch
type: added
brief: none
---

Adds one test group for CPAPDex nightMetrics. The group pins the pooled values, thresholds, and absence edges of nightMetrics in cpapdex-dsp.js. On main 79275f071 the function's 51 mutants ran 6 killed and 45 survived. The group kills 41 of the 45 survivors. Four loop-bound mutants survive and stand equivalent: every consumer of those lanes filters non-finite values before use, and the raw length only gates null-ness.

Each expected value comes from its fixture by hand computation. The percentile rule interpolates linearly over the sorted finite values at (q/100)(n-1). The group runs 64 assertions.
