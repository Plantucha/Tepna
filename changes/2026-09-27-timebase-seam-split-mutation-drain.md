---
bump: patch
type: fixed
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

The SOLID-NIGHT seam split's sidecar readers are read row by row, and `_seam_cause` drops a dead parameter — #3095's diff-scoped mutation gate goes from 41 survivors and 8 orphaned equivalence entries to zero.
