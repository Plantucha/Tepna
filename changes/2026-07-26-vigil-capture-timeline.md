<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
Add a per-stream capture timeline and a per-device signal trace to the foot of each monitor card: a coloured strip showing captured / degraded / no-signal / wedged / idle across the night with a coverage percentage, and a second strip plotting RSSI in dBm on a fixed -100..-40 scale. Intervals come from rows written rather than file mtime, and the wedge state requires two devices that were both previously up to drop together — a single sensor can never accuse the adapter.
