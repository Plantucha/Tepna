---
bump: patch
type: fixed
brief: none
---

Split the cite-drift `missing-file` bin by the cited path's tail. A citation that omits its leading directories now reads the tracked file it names. A path that shares only a basename scores off-tree.
