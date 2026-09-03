<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [tooling]
brief: none
---
Two guards held the wrong halves of one problem: `docs-ledger` check 8 resolved row↔brief and could not
see a reference from one row to another, so the date-slug migration broke four pointers silently; and
`residue-ids` could see the row edits but not why, so it refused the repairs. check8h now resolves
row↔row (a bare `R<n>` is always dangling, a date-slug must name a real row), and `residue-ids` gains a
self-limiting pointer-repair exemption — one retired id for one backticked key that resolves, nothing
else, no rename map — which can never fire again once no `R<n>` survives.
