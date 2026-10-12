---
bump: patch
type: fixed
brief: PAT-HAT-RING-FLOOR-2026-10-04-BRIEF.md
---

Report the O2Ring's dead stream-offset field by its own structural reason instead of `floorMap`'s
corrupt-capture message, which masked it on all nine real ring sessions.
