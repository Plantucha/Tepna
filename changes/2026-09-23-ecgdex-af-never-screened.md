---
bump: patch
type: fixed
brief: none
---
`afScreen` scores 32-beat windows and needs ≥20 usable beats to score one. When NO window qualified — every window too sparse or too noisy — `total` was 0, the three metrics fell to 0, `suspiciousPct >= 8` was false, and the function published **`'no-af'`**: a clinical all-clear derived from zero evidence, rendered as "Clear" with an `ok` severity.

The vocabulary for this already existed **in the same function**: the `n < W + 2` guard at the top returns `'insufficient'`, and both consumers already map it to `'—'` and `neutral`. Two ways of having nothing to screen, only one of them answered correctly — the same shape as `computeSpO2Percentiles` vs `computeODI1` in #2961, a precondition handled twice and differently.

The metrics go null with the verdict on both insufficient paths: `0 % irregular` is a measurement claim about windows that were never scored, and `suspiciousPct` is printed straight into three surfaces, all three now guarded.

The twin is a discriminating pair rather than a single case: the SAME beats with usable quality produce a genuine `no-af`, and with quality below the 0.4 gate produce `insufficient`. That control is what distinguishes the fix from the early-return path it must not be confused with.
