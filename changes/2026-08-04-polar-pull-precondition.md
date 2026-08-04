---
bump: patch
type: changed
brief: POLAR-OFFLINE-DOWNLOAD-2026-07-17-BRIEF.md
---

`POLAR-OFFLINE-DOWNLOAD`'s two open items were "idle-device gated", which was too vague to act on.
Observed on the live box: both Polars are **unreachable** (`TimeoutError`), not busy — so there is no
idle-but-reachable state to wait for, because the daemon takes the one BLE link the moment a Polar
appears. Precondition re-stated as a deliberate daytime window. Also records that the silent-stream
watchdog fired and self-healed a real O2Ring wedge in production this morning.
