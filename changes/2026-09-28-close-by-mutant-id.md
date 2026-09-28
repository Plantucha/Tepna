---
bump: patch
type: fixed
brief: MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md
---

When a survivor ledger `close` label matches several entries, the refusal now names every candidate with its full qualified label and its mutant id, instead of reporting only a count — the missing information was that a label may be qualified with `lane:module::function`, which is what made a shared one-line mutation look unaddressable. `close` also accepts an entry's own mutant id as a shorter handle.
