---
bump: patch
type: fixed
brief: none
---

- Report whether a mutation sweep's own input moved. A worker shares the caller tree's inodes, so a root write reaches it mid-sweep.
