---
bump: patch
type: fixed
brief: none
---

The diff-scoped mutation gate runs from a worktree (interpreter resolved from an override, then the primary checkout, refusing with the paths it tried), stops emitting PASS over a population of zero, no longer double-counts survivors across globs, and asserts its own result block is possible.
