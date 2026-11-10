---
bump: patch
type: added
brief: none
---

- Lint every shell script outside `capture-host/` as a gate step.
- Red the gate when no shellcheck binary runs, rather than pass.
- Clear the 31 findings the new gate names over 36 scripts.
