<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
De-bias the gyroscope before it enters the motion index — a stationary arm read ~3.85 dps, which normalised to a 0.096 pedestal on every quiet epoch and discounted the confidence of every beat event.
