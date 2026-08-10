<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md
---
Measure PAT simultaneity over the overlap window instead of the file headers — `sharedClock` compared file START times and whole-file beat counts, refusing 21 of 30 real box pairings before the gate read coupling or beat IQR.
