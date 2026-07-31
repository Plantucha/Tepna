<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: removed
nodes: [Integrator]
brief: INTEGRATOR-APNEA-TYPING-REVIEW-2026-07-22-BRIEF.md
---
Withdraw the Integrator's obstructive-vs-central apnea type — chest-ACC effort amplitude does not separate the two classes, so the split is now null and every desat is untyped.

`minor`, not `major`: `summary.apneaTyping` keeps its shape and gains fields (`typingWithdrawn`,
`withdrawnReason`, `effortCovered`). `obstructive`/`central` become permanently `null` rather than a
count — but `usable` was already the documented read-gate on that split and it is now always `false`,
so a consumer following the published contract loses nothing it was entitled to read. It is not
`patch` because the export's meaning genuinely changed and a reader must be told.
