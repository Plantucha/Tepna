<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
The board's staleness banner weighs every file the renderer runs, not `tools/board.mjs` alone, and raises on an absence as well as a drift.
