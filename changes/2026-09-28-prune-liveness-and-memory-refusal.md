---
bump: patch
type: fixed
brief: none
---

The mutation scratch prune stops deleting directories other sessions are still using — each scratch records its owner's PID and process start time when it is claimed, and a stale tree is removed only once that owner is provably gone and past an age floor, with an unmarked tree outlived rather than judged. And a mutation run whose projected peak memory does not fit refuses before it starts, naming the generated-module size, the assumed RSS factor, the worker count and the cap it was measured against, instead of beginning and being reaped under box memory pressure with nothing to report.
