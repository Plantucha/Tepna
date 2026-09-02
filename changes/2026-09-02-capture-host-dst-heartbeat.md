<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
capture-host: the liveness heartbeat is stamped from real wall time instead of the capture frame, so a DST transition with a recording open no longer breaks the up-but-wedged check — measured end-to-end, a daemon wedged for 30 minutes read `live, age_ms 0` for the whole session after fall-back, and a healthy one read `stale, age 3600000` from ~61 minutes after spring-forward.
