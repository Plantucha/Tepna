---
bump: patch
type: changed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Record the transactional pull layer's first production execution (§13). The 04:52 deferred restart
printed the arming diagnostic naming both flag states (§12a item 1), and the 05:12 pull wrote
inventory.jsonl's first four rows, DISCOVERED -> DOWNLOADING -> VERIFIED -> COMMITTED with sha256
identical across the last two (§12a item 2). §23's first real deltas: whole harvest 8.862 s, atomic
commit 0.009 s, and 8.825 s of download+verify that is exactly the blob T3 splits.
