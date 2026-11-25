---
bump: patch
type: fixed
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
nodes: [CPAPDex]
---

The clinical summary added a night whose therapy hours the DSP refuses as a night of zero hours, so a
partly unmeasured set read as a smaller complete one. The total now sums the nights that state their
hours and names the count of the nights that do not.
