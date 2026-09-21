---
bump: patch
type: fixed
brief: none
---

Reset the process-global open-sample-writer counter before every capture-host test and trip after any test that leaves it raised, closing the ten writers ten tests left open — the leak that made `capture._now()` absorb clock steps instead of re-anchoring in the #2715 mutation lane.
