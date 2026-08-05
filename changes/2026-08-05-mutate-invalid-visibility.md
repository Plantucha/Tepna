<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
A `clock.js` sweep sharing the box with another job reported `killed 79 survived 18` and read as if a quarter of the module's coverage had vanished. It had not: **25 of 122 mutants never ran.** Their suite child hit its timeout, was killed, produced no assertion output, and was correctly classified `INVALID` — but `invalid` appeared only in the JSON, so the progress line showed a collapsed kill count with nothing to explain it.

The count that changes how every other count should be read now sits beside them: the progress line carries `invalid N` whenever it is non-zero, and a run where invalid exceeds **both** 2 mutants and 5 % of the population prints a warning naming the honest denominator — *"79/97 is the honest rate; 79/122 is not"* — and points at load as the usual cause.

Both thresholds matter, and one alone would be wrong: 3 of 200 is noise, 3 of 10 is a broken run. Extracted as a pure `invalidWarning()` and pinned with **7** known-answer selftest cases (including the 1-of-123 regex-quantifier case that must stay silent, and a zero-tested divide-by-zero guard) — an alarm nobody has watched fire is not an alarm.

Tooling only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
