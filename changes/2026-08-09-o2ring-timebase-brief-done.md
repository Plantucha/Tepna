<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md
---
Close the O2Ring adaptive-timebase brief lifecycle.

The feature is shipped end to end (Stage 1 #1037, Stage 2 #1048, Stage 3a #1057, Stage 3b #1072, bad-host
acceptance #1089 — all merged). Flip `O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md` PROPOSED → DONE with a
§7 execution record + acceptance verdict, update its DOCS-INDEX row, and spawn
`O2RING-ADAPTIVE-TIMEBASE-FOLLOWUPS-2026-08-09-BRIEF.md` for what is NOT code-complete: deploy to vigil,
a real travel-night ECG confirmation, the GR-701W GPS-PPS hardware to give vigil a real stratum-1, and the
build-tree / biome / verify-fixtures / bundle-churn gotchas. Docs only.
