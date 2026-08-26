<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: PER-DEVICE-ADAPTER-PINNING-2026-08-26-BRIEF.md
---
The merge layer for the per-adapter daemon split (§3.6): each instance publishes `status.<instance>.json` with a `heartbeat_ms`, and `status_union.py` unions them for the monitor and nightqc. Nothing shares a file, so there is no locking and no writer contention. The union is taken over the EXPECTED instance set from config, never the found files — a dead instance is rendered `dead`/`stale` with its last-seen age rather than silently omitted, and the union carries its own `degraded` verdict so a consumer cannot render a healthy-looking view by accident. A status doc with no heartbeat is treated as dead, not live: an unaged status is one that cannot be shown to be current. An un-split box keeps writing plain `status.json` and reads back through the same union, so no consumer needs a flag-day.
