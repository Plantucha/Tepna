---
bump: patch
type: changed
brief: none
---

Delete the sixteen capture-host literal defaults that no call ever takes, so those parameters become required. Each deleted default now has a test that observes the value where the code hands it over. `nightqc.constant_runs` walks its samples with `enumerate`, so the mutation gate can decide its mutants.
