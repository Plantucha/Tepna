---
bump: patch
type: fixed
brief: none
---

Refuse a secret scan whose run and whose copy of the gate sit in different checkouts, so the verdict
can no longer describe a tree the reader never named.
Give `tools/write-root.mjs` a `judgeRoot` arm over the same decision, with a refusal that says JUDGE.
