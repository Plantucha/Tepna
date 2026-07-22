<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
Exclude PPI intervals that straddle a time discontinuity from HRV — an interval measured across real time the capture lost spans an unknown number of absent beats, so it is not a measurement and must leave rMSSD, pNN50, SD1, meanRR and SDNN rather than inflate them.
