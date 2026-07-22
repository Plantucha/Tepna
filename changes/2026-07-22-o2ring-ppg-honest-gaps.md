<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Insert honest gaps in the O2Ring PPG grid when BLE loses a frame — the synthesized sample counter previously laid survivors contiguously across missing real time, compressing the record and fabricating beat-to-beat variability (measured: 82.3 s lost over 119 min, ~20% of beats adjacent to a gap).
