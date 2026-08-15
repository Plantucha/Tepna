<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: none
---
Correct sigma-no-reference limitation (x) — its raw corpus was never unavailable, and the window sensitivity is now measured on it.

The limitation excused itself with *"whose raw capture is no longer available to re-derive."* That is
an empirical claim about a filesystem and it was false: the phone-captured tree is still on disk with
all three streams for every night the section names. Measured on those 24 nights, 1 h → whole night:
O2Ring 1.98 → 2.57 (+30 %), H10 0.61 → 0.92 (+51 %), Verity 0.45 → 0.47 (+4 %).

The surviving caveat — that the magnitude might not transfer — was right and understated: the corners
**reorder** (Verity is the most window-sensitive on the box corpus and the least here). "A monotonic
rise in every corner" also fails here; Verity peaks at 18 ks and falls back at whole-night. Scope is
stated in the paper: this is the node-export path, not the raw-ingest fused hat behind the headline σ,
so only the relative sensitivity is claimed comparable and no headline figure moves.
