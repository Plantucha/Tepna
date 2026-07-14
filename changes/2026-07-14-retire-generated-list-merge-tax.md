<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite, tooling]
brief: CPAP-REAL-CORPUS-FOLLOWUPS-II-2026-07-13-BRIEF.md
---
Make the `docs-ledger` + `release-ledger` gates Node-lane only and delete the committed `tests/{docs-ledger,changes}-list.txt` snapshots, their generators, and `list-format.js` — killing the regenerate-on-every-PR merge tax (both gates now read `briefs/` + `changes/` straight from the filesystem; the browser lane SKIPs them).
