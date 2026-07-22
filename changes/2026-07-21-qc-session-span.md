<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-AUDIT-FIXES-2026-07-21-BRIEF.md
---
nightqc coverage is scoped to the CURRENT capture session (not the whole date folder), so a box that also ran earlier the same day no longer reads a live, healthy stream as 0% degraded.
