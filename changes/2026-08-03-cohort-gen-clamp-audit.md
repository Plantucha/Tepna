<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: FINDINGS-AND-FIXES-BRIEF.md
---
Audit §6's clamp-pileup class across both generators — four fixes had already shipped unrecorded, and the one live instance gives every synthetic desaturation an identical 86.6% nadir with no jitter.
