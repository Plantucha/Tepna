---
bump: patch
type: fixed
brief: none
---

The profile panel no longer captions an unentered elevation as "~ sea level". The value has been `null` since #2854, but the caption read it through `r.v > 1500`, and the false arm printed sea level.

A measured 0 m got the same sentence. The caption now has three states: not set, a high elevation that adjusts the norms, and a measured value. `build()` also runs in a realm without a `document`. No metric moves. Shrike found the site in task 30, and Kestrel verified it on `origin/main`.
