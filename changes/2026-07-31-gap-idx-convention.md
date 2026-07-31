<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex, suite]
brief: INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS-2026-07-28-BRIEF.md
---
Settle the `gaps[].idx` convention on "first sample after the dropout" and correct `mergeEcg`, which wrote the last sample before it.
