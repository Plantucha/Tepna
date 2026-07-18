<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [CPAPDex]
brief: CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md
---
Add a cross-night device-SETTING change-point detector (CPAPCross.pressureChangePoints, robust L1-cost binary segmentation) surfaced as an additive crossNight.pressureChangePoints export field — flags a delivered-pressure step (e.g. an EPAP-min change) that crossNight deliberately does not trend, closing the §P8 KNOWN GAP; validated on the real 180-night corpus (nails the 2026-06-12 epap95 step 10.7→6.8, zero false positives).
