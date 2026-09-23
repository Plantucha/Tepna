---
bump: patch
type: fixed
brief: RESIDUE 2026-09-22-wt-done-merged-is-not-landed
---

`wt-done` could approve removing a worktree holding commits that never landed: `gh` answers
"did a PR from this branch merge", not "is every commit on this branch landed", and under squash
nothing in the graph distinguishes them. The decision core had no input that could express the
difference, so no caller could make it refuse. It now takes `unlanded` (optional and last, so
older callers are unchanged) and refuses on commits dated after the merge, naming the count.

Two cheaper discriminators were measured on the 20 merged worktrees on this box and discarded,
recorded in the source so they are not re-attempted: PR headRefOid ancestry (the oid is absent
from the object store in 8 of 12 merged cases, so refusing on "cannot prove" would block two
thirds of legitimate reclaims) and content residual on touched paths (18 of 20 false positives,
because main moves on those paths after the merge).
