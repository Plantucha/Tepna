---
bump: minor
type: added
brief: none
---

Two new suite gates over the host-axis export blocks.

- A refused `DexClock.hostAxis` names its refusal in `recording.timing.reason`.
- All three publishers quote the spine's own sentence; `anchors`, `ppm` and `spanMs` read `null`.
- `recording.hostAxis` gains a declared key set per publisher, asserted in both directions.
- `docs/EXPORT-SHAPES.md` states both contracts and the 28-key table.
