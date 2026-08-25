---
bump: patch
type: added
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Add close_harvest_decision(), composing pull_deadline and flush_gate into §14's close-triggered
sequence. Pure, so the ordering — not armed, no close, deadline gone, then the flush gate — is pinned
by tests rather than living inside an await loop. Scope is not a parameter: §14b measured which=latest
as the only scope that fits the wait-for-flush window.
