<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: O2RING-PROTOCOL-2026-07-17-BRIEF.md
---
Two O2Ring monitor cards. The perfusion index has been parsed and written to the SpO2 sidecar since the
`[7]`/`[11]` swap fix but was never published, so the field that says WHY a reading is poor was visible
only after the fact — it is now on the bus as `pi_o2`. And the ring's 3-axis accelerometer (`0x14`
AUTO_RT_ACC) is reachable for the first time: the `0x10` handshake payload is a bitfield we have always
sent as zero, which DISABLES four device-push streams. Opt-in via `'acc'` in the device's `streams`,
the same switch the H10 uses, and off by default — enabling it changes a whole session's traffic on
hardware that has never been asked to push.
