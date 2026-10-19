---
bump: patch
type: fixed
brief: BRIEF-HEADER-CLAIM-RATCHET-2026-10-17-BRIEF.md
---

The brief-header gate now masks a bare month-day such as `09-25` before it looks for counts. A date fragment no longer reads as a count that needs a source. The change retires the 35 baseline entries that were date fragments, so the baseline holds 747 entries.
