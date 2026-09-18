<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: RESIDUE.md
---

The UNDECIDED refusal reported a total and six sample mutant names, which cannot separate "all of them
in one pathological function" from "spread across several" — two findings that need opposite
responses. It now prints the per-function distribution, read from the mutant names it already had. The
closing advice to raise `timeout_multiplier` is removed: an undecided mutant was never observed by a
test, so raising a bound until it fits converts "not measured" into "passed" without anyone learning
which mutants moved, which is what the refusal exists to prevent.
