<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md
---
trio-batch now finds the ring-clock sidecar the daemon actually writes (`_RTCLOG.csv`, upper-cased by `capture_filename`) — the reader matched lowercase only, so `arrival_<night>.json` never carried a `ringClock` block on any real night; the gate now RUNS the reader's matcher against the writer's real filename instead of asserting the defective literal.
