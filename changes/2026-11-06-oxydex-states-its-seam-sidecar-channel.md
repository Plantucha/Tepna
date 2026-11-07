---
bump: patch
type: changed
brief: SEAM-SIDECAR-NODE-COVERAGE-2026-11-06-BRIEF.md
---

Every OxyDex export now carries the `recording.validity` seam keys, as UNKNOWN under `no-seam-sidecar`.
Four nodes already published that block and OxyDex published nothing, so a consumer read its silence as a clean night.
The node reads no sidecar: the ring hands `write_ppg2w` no device stamp, so the box never opens one.
Its own U3 tripwire count stays in `timing.seams`, because two observers own two blocks.
