---
bump: patch
type: fixed
brief: none
---

Drain the SessionStart payload in `session-tailnet.sh` before its two early exits, so that a payload over the pipe buffer cannot kill the writer.
