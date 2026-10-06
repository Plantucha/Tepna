---
bump: patch
type: fixed
brief: CLOCK-FIT-SEARCH-COST-2026-10-05-BRIEF.md
---

The pairwise clock fit stops reallocating its delta buffer per offset and stops holding a polymorphic null in its inner loop, so the fitClockClosure suite group runs 56 times faster with every answer byte-identical.
