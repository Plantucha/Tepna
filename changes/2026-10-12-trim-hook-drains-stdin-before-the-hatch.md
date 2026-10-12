---
bump: patch
type: fixed
brief: none
---

Drain stdin in `trim-output.sh` before the environment hatch exits, so the harness writing the payload no longer takes SIGPIPE; measure the hook's verdict by redirect rather than through a pipeline, and add a leg that watches the writer's fate.
