<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
Three OxyDex fabricated absences, landed together because they share a re-bundle: a missing Motion column defaulted to 0 for every sample, so an oximeter with no accelerometer published Sleep Efficiency 100%, WASO 0 and a PERFECT 100/100 motion sub-score (F15); crcIdx initialised to 0 and never computed under ~20 min, so an un-computed 0 satisfied the Cheyne-Stokes "low coupling" criterion and shipped "Cheyne-Stokes: Possible" on short recordings (F22); and the stuck-motion-column guard needed an absolute 600-sample run, so a record stuck for its entire length went uncondemned below that — 642 rows caught, 592 rows not, same device, same night (F23). Also fixes a pre-existing ordering leak that stopped computeSleepStabilityScore's own null-motion branch from ever firing.
