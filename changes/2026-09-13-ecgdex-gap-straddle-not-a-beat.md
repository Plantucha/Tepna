<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: none
---
Stop median-filling an ECGDex interval that straddles a dropout — a 74-second absence was being written into the NN series as a plausible ~1 s heartbeat (5 of 5 on a real H10 night) and flagged `corrected` as though the beat had merely been mis-measured; the honest elapsed time now survives, marked `spansGap` and excluded from rMSSD, pNN50, meanRR and SDNN.
