<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md
---
capture-host: an absent mandatory device (H10 / O2Ring) no longer costs 27–46 hopeless 30 s scans per hour on the shared radio — the three mandatory reconnect loops capped their error backoff at 60 s (the brief's 2026-08-19 check had read the optional-device branch); one shared `_RECONNECT_BACKOFF_CAP_S = 180` (≈ 17/h, `power.reconnect_backoff_cap_sec` overrides) replaces the three literals, reset-on-viable-session unchanged.
