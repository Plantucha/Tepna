<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Stop the profile panel fabricating authority (DEEP-AUDIT-II §13.1/§13.2/§13.4): `vo2Category`/`vo2Percentile` are the suite's own ratio-to-50th-pct heuristics, not the ACSM/FRIEND percentile distribution — relabel them `heuristic` ("vs 50th-pct norm"), never `validated`/"ACSM" (LITERATURE-USE-POLICY: no `validated` badge without a real citation for THIS number). Disclose that the VO₂ norm is HELD past age 65 (not extrapolated). And clamp profile age to ≥18 — every norm it feeds is an adult reference, so ages 6–17 must not borrow adult norms. Profile-panel render only; the node exports are unaffected (they carry `Unknown` headless).
