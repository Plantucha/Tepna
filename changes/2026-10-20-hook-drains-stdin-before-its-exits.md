---
bump: patch
type: fixed
brief: none
---

Drain a hook's stdin with a builtin before its early exits, so a hatch release no longer leaves the harness holding a closed pipe. Two self-tests gain the leg that watches the writer.
