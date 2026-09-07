<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tools]
brief: MUTATION-COVERAGE-SELECTION-2026-08-14-BRIEF.md
---

`equivalent` — the strongest class in the mutation equivalence ledger — was missing from `EXCUSING`,
so it stayed in the distinguishable denominator and was reported as a real gap: a TODO to write a
test killing a mutant whose own entry carries a proof that no such test exists. Added to `EXCUSING`
and to the ledger's `_README` vocabulary; the selftest now pins both directions and is plant-verified.
