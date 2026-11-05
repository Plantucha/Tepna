---
bump: patch
type: fixed
brief: RADIO-DELAY-FLOOR-2026-11-03-BRIEF.md
---

Split a radio-clock floor line at every empty window, so no rate spans unobserved time.
Each run carries the holes, the dropped windows and the largest hole beside its rate.
