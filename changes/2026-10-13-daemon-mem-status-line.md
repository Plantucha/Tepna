---
bump: patch
type: added
brief: none
---

Publish the capture daemon's resident memory, both glibc allocator views and the gc counters on every status tick. A journal line at `mem.log_sec` keeps the series.
