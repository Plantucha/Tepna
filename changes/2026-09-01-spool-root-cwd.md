<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
A relative `cpap.spool_pull.root` now resolves against the box root, never the daemon's cwd — the verbatim consumption wrote the only copy of a pulled AS11 spool into vigil's /opt checkout on 2026-09-01, which then silently blocked every hourly auto-deploy (dirty-tree refusal); the example config carried the trap and now documents the semantics.
