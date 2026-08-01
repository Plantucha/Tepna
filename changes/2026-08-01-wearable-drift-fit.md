<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, suite]
brief: WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md
---
Fit wearable clock DRIFT, not just offset — the pair is 87 ppm apart and one number cannot hold a night.

fitClockDrift refits the offset in 5-minute blocks and regresses it against time, so offset and drift
come from one fit. It runs on beat times the node-export already carries (timeseries.rr.tSec /
timeseries.ppi.tSec) — no contract change. On the real corpus the H10 and Verity agree on 89% of
heartbeats against a 21% chance control, drifting 80 ppm (2.13 s over 444 min) with a 52 ms per-block
IQR; a constant-offset fit reports 16% on the same data because two seconds exceeds an RR interval and
the match walks off the correct beat. Gated by PLANTED recovery (a known offset+drift is recovered
exactly at 0 and -60 ppm) plus its own chance control, and publishes maxDriftPpm so a caller can tell
"no drift" from "drift beyond the search". Wired into trio-batch, ungated from --cpap since it needs
no CPAP anchors.
