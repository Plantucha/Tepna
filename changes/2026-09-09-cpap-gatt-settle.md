<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Rebuild bleak's GATT snapshot in place when BlueZ published it late, instead of throwing the CPAP link away and reconnecting (#2170).
