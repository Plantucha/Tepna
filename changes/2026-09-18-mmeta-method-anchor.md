<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

`mmeta.generated_under_glob` matched `^def` at column 0, so it counted zero mutants for every class
method — mutmut indents a method's mutants inside the class body. The caller uses that count to tell
"nothing to mutate" from "generated but never tested", so for methods a genuine crash took the benign
arm and the run passed: the false coverage claim the guard was written to prevent. The message for a
zero count also asserted "no mutable operator", a cause it never checked; mutmut emits no mutants for
an `@property` either, so that wording reported a limitation of the tool as a property of the code.
