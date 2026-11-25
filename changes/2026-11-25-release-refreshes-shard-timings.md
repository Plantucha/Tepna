---
bump: patch
type: fixed
brief: none
---

The release now refreshes the per-group test timings before its gate. The 5 % cap on untimed groups then starts each cycle at zero, so it no longer reds the next pull request that adds a group. The step never blocks a release. It keeps the committed table when the suite, the generator or the shard planner refuses.
