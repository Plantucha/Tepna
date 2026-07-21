<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: VIGIL-O2RING-AUTOPULL-2026-07-21-BRIEF.md
---
Auto-pull the O2Ring's onboard .dat off flash (opt-in) so a night's SpO2 survives a lossy live BLE link — pulls only when the ring is off the finger, retries to drain the FIFO flash, idempotent.
