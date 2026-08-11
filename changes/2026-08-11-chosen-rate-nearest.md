<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`chosen_rate` fell back to the MAXIMUM rate a device offers when its menu lacked the preferred one —
the Verity streamed ACC at 416 Hz for ten hours because its list has no 50. It now takes the nearest.
