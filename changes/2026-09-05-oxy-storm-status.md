<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md
---
The O2Ring restart-storm machinery publishes its state as `oxy_storm` on the ring's `/api/state` device object (`trips`, `last_trip`, `hold_until`, `hold_remaining_s`, `restarts_in_window`, `restarts_total`) — the hold shipped with its whole state in module dicts and one log line, so a hold that fired overnight left no trace a monitor or watcher could read, and "the hold worked" was indistinguishable from "the ring never stormed".
