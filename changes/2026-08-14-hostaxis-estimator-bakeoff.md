---
bump: patch
type: added
brief: CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md
---

`tools/hostaxis-estimator-bakeoff.mjs` — the planted-recovery experiment behind `hostAxis`'s
running-median width, which was never committed.

CLAUDE.md §7 records the width-21 choice as "planted recovery against ±100 ms jitter on real geometry
(9 → 77 ms worst, 21 → 57, 41 → 168, 81 → 245)". No harness producing those numbers exists in the
repository. The number governing every bundle's clock smoothing could not be re-run, and no challenger
could be scored against it.

The tool is seeded (never `Math.random`, which would make a bakeoff as unreproducible as the thing it
replaces), reads real anchor geometry from a Polar Sensor Logger export (3001 anchors, 481 min span),
and loads the shipped `DexClock.hostAxis` in a co-loaded realm so the baseline is the real function.

USED IMMEDIATELY, AND THE ANSWER WAS NO. The hypothesis was that a one-sided estimator should beat a
symmetric median because BLE delivery delay only ever adds — NTP's clock filter selects minimum delay
for exactly this reason, and `capture-host/clock_offset.py` already uses Paxson's per-subset minimum
while citing `hostAxis` in its docstring. On a smooth non-linear plant that is what happens: `min-21`
scores 8.0 ms worst against `median-21`'s 19.7 ms. Add a 250 ms clock step mid-record and it inverts —
shipped `median-21` becomes the best of all 16 variants at 44.6 ms while every one-sided statistic
collapses to 237–248 ms, because a windowed minimum lags a FULL window at a discontinuity where a
median lags half. §7 disqualifies that by contract, not merely by score: `maxStepMs` exists to surface
a genuine step rather than hide it in a slope.

No behaviour changes. `clock.js` is untouched, so no bundle moves and no fixture is affected.

⚠️ The harness does NOT reproduce §7's recorded ordering (its median row is roughly flat across widths;
§7 has it sharply worse at 41 and 81), so these numbers score *a* plant, not *the* plant. Anyone
re-opening this must say which plant they used before quoting a width.
