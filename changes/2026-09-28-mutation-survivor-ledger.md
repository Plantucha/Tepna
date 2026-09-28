---
bump: minor
type: added
brief: MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md
---

A mutation survivor no longer lives and dies with one PR. `tools/mutation-survivors.mjs` records every survivor a gate run reports into a committed ledger keyed on lane, module, function and the mutant's own diff pair — content, never a mutmut index — with the PR that reported it and its state, and its open count is a two-sided ratchet in the repo check. Ingest refuses a run it cannot attribute to a PR, refuses to read an absent measurement as an empty survivor list, and flags a survivor list as a lower bound while mutants went undecided. The first twelve entries are the real unanswered findings on `loss_audit.py::_has_worn_evidence`, re-derived because the only record of them had already drifted.
