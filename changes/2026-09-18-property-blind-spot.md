<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

mutmut generates no mutants for an `@property`, so the diff-scoped gate reported those functions as
"no mutable operator — nothing to test": a limitation of the tool stated as a property of the code.
Measured across capture-host, 45 properties all generate zero mutants, 15 of them have genuinely
mutatable bodies, and all 15 had those bodies changed this quarter. A property is now reported as NOT
EXAMINED, counted apart from functions that really have nothing to mutate, and named in the run
summary so a reader cannot mistake an unopened function for a clean one.
