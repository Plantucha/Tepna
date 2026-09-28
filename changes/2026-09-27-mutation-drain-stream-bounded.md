---
bump: patch
type: fixed
brief: none
---

The fourteen mutation survivors on #3181's new lines are drained: the wall-cap arithmetic is extracted as `cap_remaining` with a named floor so it can be asserted as numbers rather than through a clock that cannot afford a one-second bound, the abandoned reader is pinned as a daemon with a bounded join (an unbounded one would turn a refusal that just fired into a hang), and the post-kill reap's bound is asserted; one survivor, a one-second change to the join bound on an already-finished thread, is recorded as no-distinguishing-input with its argument.
