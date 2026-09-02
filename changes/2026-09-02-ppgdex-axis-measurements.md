<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---
PpgDex's node export published the host-axis VERDICT and dropped every measurement behind it.

`out.quality` carried `timingSource`, `axisDrawn` and `axisQuantizedShare` — the conclusions — while
`ppm`, `independent`, `spreadMs`, `inertReason` and `stability` were computed (`ppgdex-dsp.js:760`)
and named by no reshape. A consumer could read `timingSource: 'device+host'` and had no way to check
whether the host column was a second clock at all, which is exactly what CLAUDE.md §7 instructs it to
do ("read `independent`, never a ~0 ppm"). **The export made the mandated check impossible while
looking complete.** ECGDex has emitted the full block at `ecgdex-dsp.js:5210+` throughout.

Now emitted as `recording.hostAxis`, mirroring ECGDex's field set so the two are comparable by
construction, and CONDITIONAL on an axis existing so a night without one omits the block and every
committed export stays byte-identical.

Gated as PARITY against ECGDex as the reference emitter rather than as a field list, so the two
cannot drift apart again — including an assertion that the REFERENCE itself is non-empty, or the
gate would pass vacuously the day ECGDex's block changed shape.
