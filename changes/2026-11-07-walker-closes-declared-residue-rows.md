---
bump: minor
type: added
brief: none
---

The PR walker now closes a residue row when a merged PR declares it on a `Residue-fixed:` line.
It opens one RESIDUE-only draft PR that writes `fixed #N` in the state cell of each OPEN row.
The walker journal now prints each alert once per head and one line for a pass that changed nothing.
