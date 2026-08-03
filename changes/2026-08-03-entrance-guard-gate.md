<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: BLANK-ON-PRINT-FLEET-2026-08-03-BRIEF.md
---
Guard `.main-wrap` and bare `.kpi` against the frozen-timeline blank, and gate the entrance guard against the drift that let them through.
