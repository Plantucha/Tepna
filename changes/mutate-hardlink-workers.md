---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---

`tools/mutate.mjs` builds its worker pool with `cp -al` hard links instead of `git worktree add`.
The old path was a full checkout per worker — minutes of I/O before a mutant ran — and on this ntfs3
volume it deadlocked outright: one `git worktree add` sat in uninterruptible D state for 1 h 33 m and
took the fleet sweep with it. `killcheck.mjs` and `extreme-mutate.mjs` have always built workers this
way and have never wedged. Uncommitted changes are now visible by construction, so `syncDirty` is
gone. Measured after the port: 40 mutants at 8 jobs in 52 s, pool built in seconds, source
byte-intact.
