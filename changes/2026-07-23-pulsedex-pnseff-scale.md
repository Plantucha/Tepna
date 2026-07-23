<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: none
---
PulseDex PNS Efficiency now divides by the pNN50 FRACTION (pNN50/100), matching HRVDex's reference formula — the omitted /100 rendered values 100× too small (0.0140 vs HRVDex 1.3955 on identical RR truth); the render grade band is recalibrated to HRVDex's thresholds (green <4, warn <7). App/render only — the ganglior export is unaffected.
