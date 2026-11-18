<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex, hrvdex, pulsedex]
brief: none
---
Three nodes no longer publish an unmeasured value as a number. An ECGDex event with no beat within 5 s now carries a null SQI, where it carried a mid-scale 0.5. An absent HRVDex rMSSD now leaves the HRV-adjusted VO2max and its 7-day mean empty, where they repeated the base estimate. A PulseDex transit-time surrogate with no positive root is now null and reads "not resolvable", where it published 0 ms and painted the tile green. Shrike found all three in its absence audit.
