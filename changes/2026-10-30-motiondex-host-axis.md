---
bump: minor
type: changed
brief: DEVICE-TIME-HANDLING-2026-10-29-BRIEF.md
---

MotionDex now disciplines its device counter against the host column. It detected a counter resync and corrected nothing. Every position it published rode the device crystal, because `relSecOf` divides `relNs` by 1e9 and reads nothing else.

The node builds `DexClock.hostAxis` from anchors after the LAST resync. A resync changes the clock rather than shifting it, so earlier anchors go, and the node counts them. It then applies `correctionAt` to each row. It consumes the interpolation, not the rate, because it owns no `fs` for a rate to divide. A refused or inert axis keeps the device axis and publishes the refusal's own reason. The export gains `recording.clockAxis`: which stream spoke, whether the node applied the correction, the dropped-anchor count, and each seam's host-device offset.
