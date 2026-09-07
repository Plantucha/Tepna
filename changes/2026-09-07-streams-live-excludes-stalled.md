<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The monitor's `Streams · N of M live` counted streams that had ever produced data rather than streams that were flowing, so it read "2 of 12 live" with every device disconnected. The two were the O2Ring's `motion_o2` and `pi_o2`, which pushed before the ring dropped at 09:49 and kept the bus's `active` flag: that flag is documented as "streams that have produced data this session", is set on the first push, and is cleared only by `unregister` — which the O2Ring path never calls on disconnect. The stall was visible the whole time in a field the heading did not consult, `health`, which IS recomputed from the age of the last sample. The claim of liveness now excludes `health:'stall'`, and `weak` is counted among the live rather than alongside them, because a silent stream is not a degraded one and the previous code reported the same two streams as both live and weak in one heading. The denominator deliberately stays every declared stream, so a configured-and-failing stream is still visible rather than vanishing from the count.
