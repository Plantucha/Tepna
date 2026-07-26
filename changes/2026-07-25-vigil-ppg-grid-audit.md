<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF.md
---
Stop the O2Ring PPG grid fabricating elapsed time — anchor gaps to the session start so BLE arrival jitter cancels instead of accumulating; surface a stream-shape breach instead of rewriting the declared channel count; treat an unreadable NTP stratum and a positive RSSI as unknown rather than trusted.
