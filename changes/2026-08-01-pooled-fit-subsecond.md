<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md
---
`fitClockOffsetPooled` quantised **every** answer it has ever returned to one second. The centroid did `Math.round(wLag / wSum)` on a value in **seconds**, discarding exactly the precision `stepSec` exists to provide.

Invisible for the clock work it was built for — a ±45 s match window makes a ~90 s plateau, so a 1 s quantum sits far inside the noise — and fatal the first time it was pointed at a sub-second question: beat-train lags came back as 6000, −2000, 10000, 16000 ms, every one an exact multiple of 1000. A quantiser wearing a measurement's clothes.

Now kept to millisecond resolution. The centroid legitimately interpolates *between* grid points, so it is not snapped to `stepSec`: finer would be false precision against a 20 ms grid, coarser would discard a real interpolation.

Gated with a planted **250 ms** offset, recovered as 0.25 s, plus an assertion that the answer is not an exact multiple of one second — the specific shape the bug produced.
