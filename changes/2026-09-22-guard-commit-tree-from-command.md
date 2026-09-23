---
bump: patch
type: fixed
brief: none
---

The commit guards (guard-format.sh, guard-ruff.sh) resolve the repository from the command's `git -C <dir>` or leading `cd <dir>`, not from the hook's own cwd — a `cd <worktree> && git commit` was being examined against the session root's index and allowed.
