---
bump: patch
type: fixed
brief: none
---
An unset VO₂ was RANKED rather than refused. `p.vo2gt` is 0 when no ground truth was entered and none was detected, and `vo2Percentile` had no unset branch: 0 sits below every Cooper cut point, so the interpolation loop never matched and the tail `: 1` published the **1st percentile** — the worst possible fitness ranking, derived from no data. The absolute beside it printed **"0.00 L/min"**.

⚠️ **The 0 itself is NOT the defect and is left alone.** `detOr0` documents it as a protocol value — *"else 0 ⇒ node auto"* — so changing it would break a contract consumers rely on. What was wrong is a display layer that turned that protocol 0 into a reported measurement.

The idiom was already in the file, one line from the fabrication: `vo2CatStr` reads `p.vo2gt > 0 ? calcVo2Cat(…) : '(enter VO₂ GT)'`. And the VO₂-absolute card guarded its FORMULA hint on `p.vo2gt > 0` while printing the value unguarded — it explained that no ground truth was entered while stating one.

The twin shows the class on the kernel that IS reachable: `calcVo2Cat(0, 42, 'M')` returns **"Very Poor"**, so the raw kernel ranks an unset 0 just as happily — which is precisely why its call site guards and the percentile's did not. ⚠️ `vo2Percentile` is nested inside the DOM-touching `updateProfile` and is asserted against the source; hoisting it is a refactor larger than the fix, and the limit is stated in the test.
