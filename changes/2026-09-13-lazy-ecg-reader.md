<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ECGDex, capture-host]
brief: VIGIL-SELF-SUSTAINED-FOLDING-2026-09-01-BRIEF.md
---

The Node fold path streams `_ECG.txt` in bounded chunks instead of reading the whole file and
splitting it. `ECGDSP.parseECGLines` is an additive line-feed entry point; `parseECG` keeps its
whole-text contract for the browser and delegates, so there is one parse body. Measured on a night
carrying a 260 MB single ECG: wall −37 %, peak RSS −1 % — a speed change, not a memory one. Export
bytes are unchanged (`verify-fixtures` green, one fixture re-stamped under the new code identity).
