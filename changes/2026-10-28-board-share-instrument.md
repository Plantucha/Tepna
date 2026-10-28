---
bump: patch
type: added
nodes: [suite]
brief: none
---

`tools/board-share.mjs` measures how much of Rule 0's top five the agent board takes, so the owner
can order the deferred share cap from a reading rather than from a worry. The deferral's trigger
was the post count, and that count has passed 1,000 while the crowding it stands in for has not
arrived: on 2026-10-28 the board holds 1,819 entries, 723 of the four indexed kinds, and takes 3 of
95 top-five slots over a 20-query set, worst case 1 of 5.

The threshold is pre-stated from the shape of a five-slot list, never from the reading it judges. A
query doc-search could not run and a query the reranker floor rejected keep separate states, because
one slot of the population is absent and the other is genuinely empty. Primary dev machine only: no
gate or CI step reads its output.
