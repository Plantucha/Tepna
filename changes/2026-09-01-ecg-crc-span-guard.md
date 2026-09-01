<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex]
brief: none
---
`cardiorespCoupling` now refuses an implausible beat-time span — #1800's guard reached its sibling,
and the class is closed, not just the instance.

#1800 bounded `detectCVHR`'s uniform-grid resample after a night whose gap-accumulated beat-time
axis spanned 7.6 years killed the export with `RangeError: Invalid array length`. The SAME axis
flows three calls later into `cardiorespCoupling`, whose 4 Hz grid (`M = floor((t1−t0) × 4)`) had
no bound — and because its Float64Arrays are EXTERNAL memory, V8's heap cap never fired: the
process died by kernel/cgroup OOM with no stack. Measured on the real night 2026-08-23 (H10 raw
line 1316: the sensor stamp jumps **+2792 days** ten seconds into the file): M = 965 million,
≈7.7 GB per array, >50 GB observed before any bound — three refold runs OOM-killed the box's fold
while `detectCVHR` was refusing that exact night correctly.

Fix: the same `CVHR_MAX_SPAN_S` (48 h) refusal, returning `null` — the function's established
refusal shape (its `M < 16` path); every caller already handles it. Sweep result recorded in the
guard comment: the only two span-to-grid consumers of the gap-accumulated axis are `detectCVHR`
(guarded) and `cardiorespCoupling` (now guarded); `beatConfidence` is safe by construction
(sample-index seconds, bounded by count).

`cardiorespCoupling` is newly exported on the gateable surface (additive, same contract note as
the #1800 block). Tests reuse the measured 2026-08-23 geometry through this second consumer plus a
dense 75-min over-tightness control, and were pair-verified the hard way: with the guard removed,
the test run itself is OOM-killed (SIGKILL, exit 137) inside a 6 GB cgroup — the exact production
failure — and passes with it.
