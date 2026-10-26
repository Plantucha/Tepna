---
bump: patch
type: fixed
brief: none
---

Resolve ruff over four candidates in the commit guard, so a worktree with no venv denies a ruff-dirty staged file instead of allowing it silently.
