---
bump: patch
type: fixed
brief: none
---

Split the `rebase-safe` rebuild advice into two classes. The `git add` line now names only the paths a
PR carries. The tool lists the build outputs that check 10 refuses, and it does not stage them.
