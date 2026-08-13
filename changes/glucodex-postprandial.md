---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

GlucoDex `postprandial` was pseudo-tested — the meal-response curve (pre-meal baseline, peak rise,
time to peak, 2-hour delta, return-to-baseline) computed for every meal marker with nothing
asserting any of it. Now gated by known answer through `analyze(parsed, null, { mealMarkers })` on a
designed excursion, including the drop-rather-than-pad rule for an unmeasurable meal and both
admission floors at the shapes that separate them. Verified by re-applying 13 mutants: 12 killed,
1 documented equivalent. This closes the last tractable pseudo-tested function in the fleet.
