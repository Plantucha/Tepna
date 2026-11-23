---
bump: patch
type: fixed
brief: none
---

Guard the update watcher's command-line work with the house entry predicate. An import of its exports ran the whole tool, which read three networks and rewrote the state file.
