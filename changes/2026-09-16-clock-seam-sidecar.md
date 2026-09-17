---
bump: minor
type: added
brief: BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md
---

capture-host: clock seams are now emitted where the clocks arrive. Every device-clocked writer feeds
a `<base>SEAMS.txt` sidecar recording device/host disagreements beyond 60 s. Emitted, not enforced —
nothing refuses and no node consumes it yet, so no `computeHash` moves.
