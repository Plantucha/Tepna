<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: TRIO-METHODS-REUSE-2026-07-06-BRIEF.md
---
Add a decorrelation quality gate to the Integrator three-cornered hat — drop a node that decorrelates from both peers before the solve, so a failed extraction can't contaminate every per-sensor σ.
