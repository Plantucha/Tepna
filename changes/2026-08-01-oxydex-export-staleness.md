<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex]
brief: INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS-2026-07-22-BRIEF.md
---
Add `tools/oxydex-export-staleness.mjs` — re-runs OxyDex on each export's own named source and reports every field that no longer reproduces.

`patch`: a new tool, no runtime code touched. It answers §2's question (the null `hrv.rmssd` was a STALE
export, not a quality gate) and generalises the check, since `uploads/` exports are gitignored working
artifacts that sit outside GATE B.
