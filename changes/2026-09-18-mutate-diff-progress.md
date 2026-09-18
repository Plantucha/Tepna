<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: RESIDUE.md
---

`mutate_diff.py` printed nothing for a function whose mutants were all killed, which is the common
case, so the common case was the silent one. A function that finished in eight seconds and one that
hung for two hours produced identical output, and a run that died after two hours of silence could not
say where the time went. Each function is now announced before its mutants run and reported after with
its mutant count and elapsed seconds, flushed.
