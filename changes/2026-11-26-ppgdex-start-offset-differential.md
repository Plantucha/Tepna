<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
Place PpgDex sample 0 at the recording start the series counts from. `relSec` holds host-elapsed
seconds since `t0Ms`, and `t0Ms` is one row's host stamp, so the node now reads the host-disciplined
axis differentially against that row. Sample 0 reads exactly 0, and the rate correction still rides
the series. Over 20 optical segments of 0.05 h to 8.26 h the start offset read a median of 20.7 ms
and a maximum of 234.8 ms. It now reads 0 on all 20. `hostAxis.startCorrectionMs` carries the
constant the node took off, and `startCorrectionReason` names a refusal where the node could take
no baseline.
