<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
Stamp which BLE adapter captured a night into its LINK sidecar, and add `adapter_ab` to compare two nights on the same sensors — RSSI median and 10th percentile, fraction below -85 dBm, reconnects per hour, and per-stream coverage. Three adapters now sit on the box and nothing in a night recorded which one produced it, so any comparison rested on the operator remembering; the tool refuses to compare a night that cannot name its own radio rather than accept a remembered label. The report states what a single night-pair cannot settle, because body position, room, battery and strap fit move between nights too.
