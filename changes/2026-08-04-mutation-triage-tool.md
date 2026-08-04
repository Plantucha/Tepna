<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---

capture-host: `tools/mutate_triage.py` — states a module's mutation CEILING, not just its kill rate, so
nobody aims at a number that is arithmetically impossible. Its decision logic is split into
`mutation_triage.py`, inside the coverage floor, because a wrong bucket sends someone chasing an
unkillable mutant or dismisses a real defect. Plus `_pull_once` contract tests: 15 mutants.
