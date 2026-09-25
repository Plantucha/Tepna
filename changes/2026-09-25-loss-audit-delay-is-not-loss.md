<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [capture-host]
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---
The loss audit no longer counts late-delivered samples as lost. Gaps were found on the host stamps, so a batch
that arrived seconds late (an event-loop stall, BLE delivery latency) was scored as lost minutes although every
sample was present. When a stream carries its device clock (`sensor timestamp [ns]`, read by header name), a host
gap whose device step stays under 1.5 sample periods is now a DELAY: `LOSS-AUDIT.json` publishes it in `delays` /
`delayed_min` and never in `gaps`, `by_cause` or `lost_min`. On the H10, 16 of 55 unattributed gaps over
2026-09-17 → 09-23 were delays (device step 0.008 s, one sample), and on 2026-09-24 21 stall gaps (2.2 min) are.
Real losses, where the device clock jumps too, are unchanged (the 2026-09-24 manual time sync: Verity 44 s, H10
21 s). The ring's SPO2.csv carries no device clock, so its gaps are judged as before.
