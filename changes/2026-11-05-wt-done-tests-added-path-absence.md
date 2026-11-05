---
bump: patch
type: fixed
brief: none
---

Refuse to remove a merged worktree that holds the only copy of a path its branch added.
The base's own history separates a never-landed path from a changeset a release consumed.
