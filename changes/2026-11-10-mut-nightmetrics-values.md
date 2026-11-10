---
bump: patch
type: added
brief: none
---

Adds one test group for CPAPDex nightMetrics. The group pins the pooled values, thresholds, and absence edges of nightMetrics in cpapdex-dsp.js. On main 79275f071 the function's 51 mutants ran 6 killed and 45 survived. The group kills all 45 survivors, the last four by null assertions on the default empty lanes. Kestrel's replay (#5178) refuted the four loop-bound mutants' equivalence. An off-by-one appends one undefined per session, flips the raw-length null gate, and the percentile returns NaN.

Each expected value comes from its fixture by hand computation. The percentile rule interpolates linearly over the sorted finite values at (q/100)(n-1). The group runs 68 assertions.
