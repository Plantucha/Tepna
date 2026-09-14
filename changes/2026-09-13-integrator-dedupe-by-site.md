<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: none
---
Include the sensor `site` in the Integrator's de-duplication key — a finger PPG and a wrist PPG both export as `PpgDex`, so a night carrying both collapsed to one on the ±30 s rule and 15 of 41 trio nights silently lost a whole recording, with load order deciding which.
