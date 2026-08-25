---
bump: patch
type: fixed
brief: none
---

The mutation-suite selftest "another file's ledger never leaks in" matched /oxydex/ against
cwd-derived candidate PATHS, so any worktree whose directory name contains a dex name false-failed
it locally while the primary checkout and CI passed. Match the ledger basename instead.
