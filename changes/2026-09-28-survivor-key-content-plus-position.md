---
bump: patch
type: fixed
brief: MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md
---

The survivor ledger's key becomes content plus position, so two distinct survivors in one function whose mutation text is identical are two findings instead of one. The occurrence ordinal is derived from the mutated line's position, which the gate's artifact already carries in each survivor's diff hunk; the raw line is recorded as a breadcrumb but kept out of the key, because a line shifts on any edit above it while an ordinal moves only when a twin appears or goes. Ordinal zero adds nothing to the key string, so every existing entry keys identically and the migration verifies that rather than assuming it.
