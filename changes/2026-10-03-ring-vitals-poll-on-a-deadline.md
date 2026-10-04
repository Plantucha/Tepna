---
bump: patch
type: fixed
brief: none
---

The capture box polls the O2Ring's live vitals on a fixed 1.000 s schedule. It used to sleep a fixed
second after each cycle's work, so every cycle ran 1 s plus that work: 1.015 s on average, measured on
2026-09-28. The live SpO2 file therefore held ~1.5 % fewer rows than the night had seconds, although
nothing was lost; the ring's own clock agreed with the host to 2 s. Each cycle now sleeps until its
deadlines (half a period for the mid-cycle raw drain, a full period for the next poll). A cycle that falls
a whole period behind re-anchors instead of firing catch-up polls. Takes effect at the box's next daemon
restart. Recorded nights keep their spacing; OxyDex's row-as-second reading of them is a separate row.
