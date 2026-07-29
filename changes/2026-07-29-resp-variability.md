<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: REM-STAGING-REDESIGN-2026-07-28-BRIEF.md
---
Model respiration as stage-dependent in the synthetic oracle — it breathed identically in REM and NREM, so the one feature that gives REM a positive signature could be neither built nor validated — and measure per-epoch respiratory-rate variability against it.
