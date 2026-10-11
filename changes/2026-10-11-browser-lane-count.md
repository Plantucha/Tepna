---
bump: patch
type: fixed
brief: none
---

Count what ran in `browser-lane`'s selftest instead of printing a literal 13 that the lane aggregator reads as the tool's assertion count — demonstrated by planting a 14th assertion, which the fix reports as 14 and the literal still reported as 13.
