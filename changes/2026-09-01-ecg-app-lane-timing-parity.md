<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
The ECGDex app and the gated headless parser now resolve ONE time axis — the browser's Blob worker
runs the DSP's own timing scan instead of a hand-written mirror of it (DEEP-AUDIT-VI F2).

**The defect:** the app's streaming worker and its small-file path each derived
`fs = Math.round(mean [ms]-column delta)` and ignored the integer `sensor timestamp [ns]` counter,
the host-axis correction, the device-epoch annotation and (since three days ago) the mid-file resync
discriminator. So the browser analysed the same bytes on an axis 96–320 ppm from the headless one —
129.958457 vs 130 on 2026-06-17, 130.012505 vs 130 on 06-25, |app − host-stamp span| 0.842 s against
0.008 s over 44 min — and every browser-produced export carried no `hostAxis`, `deviceEpoch` or
`tMsAt` at all. The DSP comment claiming the two "mirror byte-for-byte" had been stale for months.

**The fix is a SPLIT, not a port.** Porting the arithmetic into `WORKER_SRC` would have been a third
copy of the clock logic, and this file already carries the tombstone of the last one (`CLOCK-UNIFY`:
the worker's inline `_ckPF`, which silently skipped the Clock Contract §2.7 component-range guard).
The walk is cut at the one line a Worker cannot cross:

- **`ECGDSP.ecgTimingScan()`** — pure, self-contained, parses NO timestamps. `ecgdex-app.js` builds
  its Blob worker from this function's own `toString()`, so the worker RUNS the DSP's text rather
  than a copy of it, and every stamp it meets travels out RAW.
- **`ECGDSP.ecgTimingResolve(scan)`** — every decision (resync vs dropout, ns-vs-`[ms]` rate, the
  span and independence gates, `tMsAt`, `deviceEpoch`, `endEpochMs`), on the main thread where
  DexClock lives. Both lanes call it; `parseECG` is now a sample reader plus these two.

What makes the split honest: a resync shifts the device axis by a constant, and every quantity the
scan computes is a difference (step sums, candidate deltas) or a value carried out verbatim (an
anchor's raw counter) — all invariant under that shift. So resolve owns 100 % of the offset
arithmetic and the scan never needs to know a seam happened. The app's small-file branch, a third
ingest copy with its own row loop and rounded fs, is deleted rather than repaired: it calls
`ECGDSP.parseECG`. `parseTSfloat` goes with it — an unused parser is a mirror waiting for a caller.

**Measured.** Headless output is byte-identical before and after on every file checked: both
committed twins, the equiv clip, and the three real resync nights (08-27 fs 129.96475470405264,
gaps, `clockResyncs`, `hostOffsetMs`, `anchorsDroppedPreResync`, the whole `hostAxis` block). So this
is a refactor on the gated lane and a fix on the app one. 24 assertions diff app-vs-headless field by
field — fs to the last bit, t0Ms, endEpochMs, gaps with both relative edges, clockResyncs, hostAxis,
deviceEpoch, `tMsAt` at a FRACTIONAL sample index, sample count — on the clean twin, the gapped twin,
and a planted 129.9 Hz file where the old rule reports 130: **770 ppm, 2.2 s across a 7 h night**.
The committed twin could not carry that leg (it runs at 129.99999990 Hz, where the old rounding was
wrong by 0.0 ppm and a direction assertion would have passed vacuously).

Three existing gates asserted the old worker's SHAPE and were re-aimed at the contract; the
stream-fallback group gained the executable leg its own note said the harness could not have —
DEEP-AUDIT-II §4.4's stale re-read is now reproduced against the scan, with its defect direction.
`t0Ms` still follows Clock Contract §4 (the first stamp that PARSES, not the first non-empty).
