---
bump: patch
type: fixed
brief: none
---

Stop the probe's safety bar from reading `/re/.exec(s)` as a process spawn. A dotted call now counts only where the file names the child process module, which also catches a spawn reached through `createRequire`.
