<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The CPAP discovery-failover warning now carries the pinned adapter's exception TEXT (one line, capped at 160 chars) beside its type — a bare `BleakError` names no verdict without it (#2170).
