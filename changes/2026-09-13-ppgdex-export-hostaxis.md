<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: none
---
Forward `rec.hostAxis` out of PpgDex's `analyze` so the `recording.hostAxis` export block can actually run — it was written, gated and field-checked but never once emitted, because only three scalars were projected out of the axis and the object itself was dropped, taking `ppm`, `anchors`, `spreadMs`, `independent` and `inertReason` with it.
