---
bump: patch
type: changed
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---

Clock Contract §2.7: the node-local range guards are now pinned at the EDGE of each closed band
(accept 23/59/59/999, reject just outside) across all four parsers — GlucoDex `_ckParse`, PpgDex
and CPAPDex `parseTimestamp`, and `CpapEdf.parseEdfClock`. The previous assertions only used
far-out values (hour 25, minute 99), which cannot detect a bound that has shifted by one; five
mutants survived the whole suite on that gap. Verified by re-applying the mutants: 34 killed,
2 documented in place as equivalent (subsumed by the date round-trip check).
