<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [ECGDex]
brief: ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md
---
Commit a golden for ECGDex's Integrator-facing rich export — every prior ECGDex golden was the light one, so `respFromEDR` had no fixture.

`patch`: a new committed fixture plus its gate; no runtime code changed, so no bundle moves. Found by its
own consequence — #634 changed `respFromEDR` and the equiv fixture reproduced byte-for-byte without
covering it. GATE B coverage 15 -> 16.
