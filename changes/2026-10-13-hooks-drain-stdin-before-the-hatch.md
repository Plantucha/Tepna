---
bump: patch
type: fixed
brief: RESIDUE.md
---

Six guard hooks drain stdin before any hatch exits, so the harness writer never takes SIGPIPE. Each hook's test script watches the writer's exit code over a 100 KB payload.
