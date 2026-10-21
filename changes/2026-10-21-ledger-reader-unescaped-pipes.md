---
bump: patch
type: fixed
brief: none
---

The residue ledger reader splits on unescaped pipes only. An edit behind an escaped pipe now counts
as a mutation, where 44 of the 698 rows used to pass silently. A suite tripwire holds the shape for
the next reader.

