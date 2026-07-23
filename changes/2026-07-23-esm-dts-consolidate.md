<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: ESM-MIGRATION-FOLLOWUPS-II-2026-07-16-BRIEF.md
---
Consolidate the seven per-node `<node>-globals.d.ts` into one `node-globals.d.ts` (FOLLOWUPS-II item 4): after the item-3 DI pass they held only permanent public-API namespace attaches + a few guarded siblings, so they merge into one grouped file. Type-only — no bundle, no fixture moves; tsc + suite green.
