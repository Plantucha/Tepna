<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: TEST-COVERAGE-FOLLOWUPS-II-2026-07-17-BRIEF.md
---
Add a known-answer gate for HRVDex's profile personalization — pins the ACSM/NHANES VO₂-category classifier (calcVo2Cat) and age-band cut points (getAgeBand), which shipped as bare globals but unasserted; test-only wiring, no re-bundle.
