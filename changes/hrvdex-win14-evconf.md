---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

HRVDex: the two 14-day rolling windows (stress lag-1 autocorrelation, ln-rMSSD momentum) and the
two Ganglior event confidence clamps are now gated by known answer — the momentum slope of a
doubling series is exactly ln 2, and an alternating stress series autocorrelates to exactly −1.
Reached through the no-argument `computeDerived()` path via the `allRows` accessor, because
`computeDerived(rowsArg)` honours its argument only in the first pass; that inconsistency with the
function's own header is reported for a decision rather than changed here. Verified by re-applying
19 mutants: 18 killed, 1 proven equivalent.
