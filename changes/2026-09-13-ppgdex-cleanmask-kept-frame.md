<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
Index PpgDex's clean-interval mask by the kept NN series, not by the intervals handed to `correctRR` — since the rejection became a drop, the SQI and gap-straddle tests were read one index off per rejection, so rMSSD/SD1/LF:HF pairs were judged by a neighbour's quality (real night: rMSSD 36.6 → 34.8, SD1 25.9 → 24.6).
