---
bump: patch
type: changed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Answer §11 (multi-recording ordering) as §9. The LIST slot key is a fixed-width 14-ASCII
YYYYMMDDhhmmss, so lexicographic order on the raw bytes is chronological — no filename-ordering
assumption needed — with the ring's RTC reset as the one non-monotonic case, already observable via
the _rtclog.csv sidecar. The overwrite-priority half cannot be implemented: the eviction policy is
unmeasured, and §9a specifies the zero-cost LIST logging that would close it.
