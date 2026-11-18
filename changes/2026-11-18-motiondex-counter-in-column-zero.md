---
bump: patch
type: fixed
brief: none
---

Pin the MotionDex counter read when the header names the counter first. A mutant that skipped column 0 published no duration, and no test saw it.
