---
bump: patch
type: fixed
brief: MUTATION-AUDIT-RUNBOOK-2026-08-03-BRIEF.md
---

The diff-scoped mutation gate's dominant cost is the TEST SELECTION re-timed per glob (capture.py: 936.7 s per clean run, five globs → 78 min before a mutant existed), not the size of the functions selected — corrected in the runbook's §4 cost section where the size framing is quoted, beside the full-sweep row it does not contradict; the `PREWORK_TRACE_FACTOR = 2.0` assumption is named as one.
