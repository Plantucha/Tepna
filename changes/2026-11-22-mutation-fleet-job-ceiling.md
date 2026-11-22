---
bump: patch
type: fixed
brief: none
---

Hold the default mutation worker pool under the fleet rule of 8 GB per consumer. A quiet box let the pool reach 16 workers, and the nightly triage unit ended with an out-of-memory kill.
