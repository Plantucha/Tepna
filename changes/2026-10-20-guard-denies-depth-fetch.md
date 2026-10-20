---
bump: patch
type: fixed
brief: none
---

Deny a depth-limited `git fetch` or `git pull` in the shared-tree guard, because it writes `.git/shallow` for every worktree and stops each session's `npm run check`.
