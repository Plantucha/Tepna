<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

Make capture-host raw-data loss, backoff, gate and event-loop state observable and every radio-recovery gate failure-safe: `rows_lost` + `fsync_max_ms` on all 8 writers, `_retry_sleep` publishing attempt / next-retry with ±10 % jitter, `_RECOVER` cleared on every exit path, `STATUS.gates` / `.loop` / `.tasks`, tree walks off the loop, four bare tasks supervised.
