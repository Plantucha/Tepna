---
bump: minor
type: added
brief: EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md
---

`tools/aperiodic-method-compare.mjs` — §2's measurement: Nearest Advocate vs the correlation estimator
on identical envelope-derived events from the 4.75 h paired night, swept over **two** invariance axes.

**Answer: NO.** The event-based method does not rescue the alignment. Correlation reproduces its
recorded failure to the millisecond (3850 / 5750 / 9000 ms), and Nearest Advocate is perfectly
width-stable (0 ms) while wandering **1250 ms across envelope grids** with `ok: true` and z 7–17 at
every point. Evidence for §3's "the pair, not the method" reading.

Also fixes two defects in `nearest-advocate.mjs` (#1644): it ran its CLI **on import**, hijacking an
importer's `--selftest` and printing a PASS for tests that never ran; and `av()` used `i > 0`, so a flag
at `argv[0]` silently fell through to the default.
