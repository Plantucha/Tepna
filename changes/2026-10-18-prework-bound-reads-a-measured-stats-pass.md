---
bump: minor
type: changed
brief: MUTATION-AUDIT-RUNBOOK-2026-08-03-BRIEF.md
---

Replace the mutation gate's 2.0 pre-work trace factor with a measured per-module stats pass.
`tools/mutate.py --record-prework` writes the measurement; the gate reads it and names its source.
A module with no record gets no prediction, and the gate prints that the bound examined nothing.
