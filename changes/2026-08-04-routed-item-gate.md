---
bump: patch
type: added
brief: DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md
---

`docs-ledger` gains **check3d**: a brief that says an item is ROUTED to another brief must have a target
that actually accepts it — either the target names the source, or the routing cites a `§` the target
really has. Three items were found routed into silence today (6, 16 and 26 days), one of them to a brief
that has since closed. Eight self-tests, both acceptance paths and all three failure modes.
