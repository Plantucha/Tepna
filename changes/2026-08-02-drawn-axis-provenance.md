---
bump: minor
type: added
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---

Detect and declare a DRAWN time axis. An O2Ring session up to 2026-07-27 reports
`sample_index × 7,953,045 ns` — a constant increment standing in for an assumed 125.738 Hz — so the
column carries no timing information and its apparent drift is the error in that assumption. Such a
recording must not be spent as a clock leg: three-cornered hat assumes three *independent* sources, and
a drawn axis is a constant.

`parsePPG` now computes the modal delta share from the delta array it already builds, asserts `drawn`
only at ≥99 %, and always reports the share as a number. PpgDex exports an additive
`quality.timingSource`: `device+host` (usable as a clock), `host` (device contributed sample order only),
`none` (no timing information exists). `tools/dual-clock-rate.mjs` now names the drawn cause rather than
only reporting a wide spread.

The proposed detector `first sensor timestamp == 0` was measured NOT to work — it is true for every
O2Ring fragment including the measured post-2026-07-28 ones, so it separates relative- from
absolute-epoch, not drawn from measured. A gate locks that out so it cannot be re-proposed silently.
