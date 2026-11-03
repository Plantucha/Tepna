---
bump: minor
type: added
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

Measure what the box's seam sidecar examined, over the nights it can reach. A new census places
every `*SEAMS.txt` against its own capture stream and reads PASS: 144 reconnect boundaries recorded
since the seed fix, 0 of them outside an examined population. A file whose examined count falls
outside the interval its stream holds counts no shared population, so the census excludes it by name
with both counts in the reason, and clamps none.
