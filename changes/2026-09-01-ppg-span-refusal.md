<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
A PpgDex night whose sensor clock rebases mid-file no longer loses its whole export to a span-sized
allocation (DEEP-AUDIT-VI F10).

Two siblings of the span refusals ECGDex received in #1800/#2030 shipped unguarded in `ppgdex-dsp.js`:
`beatConfidence` is handed time-derived pseudo-indices (`round(footSec·fs)`) and sizes four
`Float64Array(S)` from their span; `cvhrFromNN` — the port of ECGDex `detectCVHR` — sizes six arrays
from `floor(tt[N−1])`. A +2792-day in-file sensor rebase (the measured H10 shape) survives `parsePPG`
into `relSec` (hostAxis correctly refuses at ±50000 ppm and does not repair the jump), and `analyze()`
died with `RangeError: Array buffer allocation failed` (~7.7 GB attempted; >50 GB before OOM
uncapped), killing the night.

Fix: `PPG_MAX_SPAN_S = 48 h` (the ECGDex `CVHR_MAX_SPAN_S` bound). Past it `cvhrFromNN` returns
`{ index: null, reason: 'implausible-span' }` before allocating, and the `beatConfidence` call site
refuses (`ppiConf: null`) instead of allocating. The export carries `cvhrReason` / `ppiConfReason`
ONLY when a refusal fired, so a refused null is told apart from a too-short one and no committed
fixture moves; hr, rMSSD and every metric that never touched the span are still measured.

Gate: new group "PpgDex F10 — an in-file sensor-clock rebase REFUSES the span; the export survives"
(17 assertions: control, +2792-day rebase, and a 1.9-day gap INSIDE the bound), pair-verified under
`ulimit -v 6 GB` — 9 red on `origin/main`'s `ppgdex-dsp.js` (`Array buffer allocation failed`),
17/17 here. `regen-ppgdex-goldens`: 0 moved; `manifestHash` 9996f626bf58 → 99d9a03d73e5.
