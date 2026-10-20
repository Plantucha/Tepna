---
bump: patch
type: fixed
brief: none
---

Read an equivalence key the way a diff writes one, so a module-level line stops reporting ORPHANED. A committed check now names any entry whose before text has left its module. The diff-scoped mutation gate can reach a verdict on this module again: the leg that needs a git base version skips inside mutmut's scratch copy instead of failing there and taking the whole run's stats with it.
