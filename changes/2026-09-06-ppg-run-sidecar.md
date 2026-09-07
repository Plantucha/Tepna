<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

Optical streams now write a constant-run sidecar (`<base>RUNS.txt`) recording spans where the wave
stopped changing — the shape a held or dropped link leaves in the data. The live rule is `stuck`
(a constant run ≥ 200 samples, 4× the measured p99.99 of legitimate 8-bit pleth plateaus), plus
per-channel zero-order-hold classification so a device that repeats each sample by design is
marked rather than flagged. Captured bytes are unchanged.
