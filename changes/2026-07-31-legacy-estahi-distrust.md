<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator, OxyDex, CPAPDex]
brief: ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS-2026-07-31-BRIEF.md
---
Stop trusting a LEGACY ECGDex `apnea.estimatedAHI` — a non-CPAP fusion no longer surfaces the retired proxy as the night's AHI.
