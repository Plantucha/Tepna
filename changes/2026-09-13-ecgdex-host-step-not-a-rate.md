<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: none
---
Refuse to spend a host clock STEP as a crystal rate — `hostAxis` divides a single multi-second jump by the whole span and hands back a fabricated ppm that was applied to `fs`; on 2026-08-26 one 3.0 s step quoted −10.02 ppm where the same device reads −19.8 to −23.0 on every other night.
