---
bump: patch
type: fixed
brief: none
---

Both PAT foot ports take the worker's optional `pinnedFromRecompute` switch, so each runs the recompute counterfactual. Each port also binds `PATGate`, which the ported pinned-span refusal calls.
