---
bump: patch
type: fixed
brief: none
---

PpgDex and ECGDex forward `hostAxis.ok` into `recording.hostAxis`. Both blocks ship only when the gate
passed, and neither field list named the key. So a reader of `.ok` saw `undefined` over 241 of the 242
committed blocks. MotionDex already named it, so three publishers shipped two shapes. The line forwards
the gate's own value, never a literal.
