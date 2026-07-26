<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Bound every post-connect GATT await in run_polar. An unbounded battery read froze the Verity's device task for 4 h 25 m on 2026-07-25: four PMD streams acknowledged `ok`, the link stayed up, zero bytes were written, and no stall warning was ever emitted — because the 90 s stall watchdog lives in the hold loop, which the task never reached. `_bounded_setup` already existed for exactly this ("never a silent all-night freeze at connected=True") but was applied only to the PMD data subscribe; the HR subscribe, the control-point subscribe, the PMD feature read and the battery read were all bare. A source check now fails if a new one is added unbounded.
