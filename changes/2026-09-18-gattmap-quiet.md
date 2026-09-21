<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: GATT-HANDLE-MAP-2026-09-17-BRIEF.md
---
The GATT table recorder writes and logs only on a first sighting or a real change — it was re-recording an identical table every 34 seconds.
