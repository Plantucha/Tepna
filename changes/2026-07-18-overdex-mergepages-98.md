<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [overdex]
brief: TEST-AUDIT-FINDINGS-FOLLOWUPS-2026-07-18-BRIEF.md
---
Close hollow gate #98 — extract a synchronous, exported OverDexWalk.mergePages(pages) from the async readEntries paging loop and pin it with a known-answer (100 + 3 pages → 103, order preserved). The `all = all.concat(page)` → `all = page` (drop-all-but-last-page) mutation silently lost every directory listing beyond 100 files and no test caught it; re-bundled OverDex.
