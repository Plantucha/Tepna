---
bump: patch
type: fixed
brief: none
---

Split the cite-drift tool's `missing-file` bin by evidence. A path whose spellings appear nowhere in
this repo's history, and whose basename no tracked file carries, now reads as `off-tree` and leaves
the strict sum. An unread history keeps every unresolved path a defect.
