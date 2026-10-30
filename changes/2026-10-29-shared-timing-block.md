---
bump: minor
type: added
brief: DEVICE-TIME-HANDLING-2026-10-29-BRIEF.md
---

Every node-export now carries `recording.timing`, nine keys built by one function
(`DexExport.timingBlock`). Three nodes reshaped the host-axis verdict by hand and dropped fields they
did not name. Five nodes published no timing provenance at all, so a consumer could not separate "this
input carries one clock" from "nobody looked". A node with no host stamp column writes
`timingSource: 'device-only'` and `independent: false`, and every number it could not measure stays
`null` beside a reason. A node that counts no resync writes `null`, never `0`.

MotionDex now surfaces its resync count, which stopped inside `actigraphy`. The block is additive and
no existing value moves; 32 fixtures gain it and regenerate.
