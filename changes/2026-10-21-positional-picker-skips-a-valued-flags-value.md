---
bump: patch
type: fixed
brief: none
---

A tool's positional argument no longer swallows a valued flag's value. Eleven tools picked the positional with a dash test, so `--every 60 <dir>` handed them `60`. The guard module owns arity, so it owns the skip.
