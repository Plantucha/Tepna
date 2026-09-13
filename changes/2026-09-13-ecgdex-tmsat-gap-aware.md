<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: none
---
Make `ECGDSP.parseECG`'s `tMsAt` count the wall-clock a dropout consumed, as `analyze`'s beat clock has since DEEP-AUDIT-II §4.2 — the two describe the same axis and diverged by the accumulated dead time (−2522.8 s at the end of a 33-hole night), putting the two PAT legs on different axes from the first hole onwards.
