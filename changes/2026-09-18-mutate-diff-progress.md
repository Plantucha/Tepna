<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

`generated_under_glob` was anchored at column 0, so it counted zero mutants for every class method —
mutmut indents a method's mutants inside the class body. That inverted the guard it belongs to: the
caller uses the count to tell "nothing to mutate" from "generated but never tested", so for methods a
genuine crash took the benign arm and the run passed, which is the false coverage claim the guard was
written to prevent. Alongside it, `mutate_diff.py` printed nothing at all for a function whose mutants
were all killed, so a clean eight-second function and a two-hour hang produced identical logs; each
function is now announced before its mutants run and reported after with its count and elapsed.
