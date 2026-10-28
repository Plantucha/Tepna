---
bump: patch
type: fixed
brief: none
---

`corpus-scope.mjs --nights` skipped the primary checkout's uploads tree. The documentation writes that
root as a placeholder, and a placeholder is not countable. The census now resolves that one row through
the repository's own corpus resolver, and states the resolver that failed when no tree is reachable.
