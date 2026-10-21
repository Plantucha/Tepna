---
bump: patch
type: fixed
brief: none
---

Decide CLI-vs-import through one shared predicate. It answers on both the path as written and its resolved target, so a tool reached through a symlink still runs its main.
