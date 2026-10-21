---
bump: patch
type: fixed
brief: none
---

Let `wt-done` retire a worktree whose branch adds no commit to `origin/main`. A branch that rebased to nothing adds no identifier, so the strongest proof scored lowest. The tool now measures emptiness on the merged path too, and `--list` reports the same decision the run makes.
