<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [tools]
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---
`trio-batch.mjs writeArrival` now attaches a `ringClock` block to each night's `arrival_${key}.json` — reads/pushes/resets/battery counts, first/last read offsets, drift, and the raw window-scoped rows — rolled from every `*_rtclog.csv` sidecar found in the night's arrival dirs.
