<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md
---
Record the O2Ring's own PPG stream offset and the whole flag byte in the OXYFRAME sidecar, so the ring's sample accounting can be settled from its own counters instead of the host clock.
