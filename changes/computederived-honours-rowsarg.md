---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

HRVDex `computeDerived(rowsArg)` now honours its argument on all three passes. The day-to-day and
rolling-window passes iterated the module's `allRows` regardless, so `HRVDex.derive(rows)` left ten
columns UNDEFINED on caller-supplied rows — a third state beside the NaN this file uses for absent —
and, with a populated `allRows`, computed those windows over app state and wrote them onto rows the
caller never passed. The no-argument path is unchanged by construction. The characterisation
expectations move accordingly (52 → 62 derived columns); the blast radius was verified first — every
column-set expectation changed by window columns alone, no per-row column moved.
