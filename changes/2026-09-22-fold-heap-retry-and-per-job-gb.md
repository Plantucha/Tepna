---
bump: patch
type: fixed
brief: none
---

A night that dies of heap exhaustion is now retried ALONE at a larger cap instead of being lost.
2026-07-19 was the one night of 139 that died in the whole-corpus re-fold; measured, its abort edge
is (3200, 3328] and it needs ~4 GB of live set. Raising the ceiling instead would hand the bigger cap
to every child — a light night peaks 2.27 GB at cap 2048 and 3.03 GB at 4096, so at --jobs 3 that is
9.1 GB of box residency, over the 8 GB standing rule, to serve 0.7 % of the corpus. The retry runs
after the pool has drained, so the big-cap child holds the box alone.

PER_JOB_GB corrected 1.2 -> 2.4 from measurement at the cap actually shipped: it decides how many
children start, and at --jobs 3 the fold held ~6.9 GB while the planner believed 3.6.

Adds tools/fold-provenance.mjs: the run-level record (night list, file-set digest keyed on resolved
path, and the mount behind each source root) that a per-night .trio-stamp structurally cannot carry.
