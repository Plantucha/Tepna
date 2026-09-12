---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

`wt-done`'s in-use check no longer counts its own invocation as a user of the tree.

It excluded the scanner's pid alone, so a shell that had `cd`'d into a worktree to run the tool from
inside it was reported as a user and the removal was refused — asking the question prevented the answer.
Measured: it also flagged a sibling in the same pipeline, one process wider than reported.

The exemption is now the scanner's ancestor chain plus its process group — the invocation — and nothing
else. A peer session working in the tree has its own pgid and ancestry and still refuses.
