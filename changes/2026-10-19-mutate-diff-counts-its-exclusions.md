---
bump: patch
type: fixed
brief: none
---

Count the mutants `mutate_diff` sets aside. A string-literal exclusion lands in `result.notRequired` with the mutant named, an empty diff in `result.emptyDiff`. `result.decided` now counts only killed and surviving mutants, never a timeout. A decided mutant in no bucket refuses the verdict.
