<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: none
---
OxyDex no longer writes an absent value as a measured zero. The fix covers the CSV T-index row, the spike timeline, and the Motion and Deep KPI grades.
