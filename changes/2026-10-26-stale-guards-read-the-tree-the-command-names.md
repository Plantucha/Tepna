---
bump: patch
type: fixed
brief: none
---

Resolve the tree from the command that names the guarded file in both stale guards.
A `git -C <checkout>` read and an absolute worktree path are now measured where they act,
not in the hook's own cwd.
