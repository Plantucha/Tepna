<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: DOCS-LEDGER-CHECK3B-BLIND-ROW-2026-08-01-BRIEF.md
---
`docs-ledger` check3b keeps each DOCS-INDEX row's status equal to its brief's header status. A row carrying **no** status marker was silently skipped (`if (!m) return;`) and the group then reported **"in sync"** — so deleting a status cell left every gate green. That is how it was found: a shell-quoting slip ate a cell and only reading the diff caught it.

Re-measuring split the brief's 48 blind rows into **36 genuinely status-less** and **12 that stated a status the regex could not see** — `*(**DONE 2026-07-14**)*`, `*(✅ DONE …)*`, `(**DONE …**)`. That second group is a **defect the brief did not identify**: rows with data to compare that were never compared. Recovering them surfaced **zero** new mismatches, so the index was honest — but the gate could not have known that, which is the whole objection.

Takes option (1) rather than the recommended dated cutoff: the quiet window existed, and every backfilled status is read from the brief header by script rather than transcribed. Matcher loosened, 36 rows backfilled, and a missing marker is now its own assertion so the failure names which of the two things broke.

Mutation-verified both ways — deleting a cell reds the presence check *while the equality check still reports "in sync"*, which is the original bug visible in a single run. Now total over all 219 single-brief rows with an executable status: no cutoff, no grandfather list.
