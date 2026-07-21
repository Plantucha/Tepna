<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Disclose the SpO₂ altitude norm-shift at the Oxygen KPI: entering an elevation lowered every SpO₂ verdict threshold via upSpo2Adj() while the only explanatory copy wrote to a DOM id that never existed, so the moved norm was silent — now surfaced next to the numbers it grades (DEEP-AUDIT-II #43).
