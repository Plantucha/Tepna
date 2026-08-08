<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
`INVALID` mutants — the ones whose suite run produced no assertion output, so nothing about them was proven — were reported as a **bare count**. A bare count cannot be reconciled against anything, which made a mutant that never ran indistinguishable from one that ran and died.

Not hypothetical. Two consecutive full sweeps of `clock.js`, on **byte-identical source**, reported 19 and 20 survivors. The extra one was `L30` — `tzOffset()`'s `* 60000`, whose loss makes every numeric epoch resolve to the raw UTC instant instead of local civil time, a four-hour error against Clock Contract §2.1. It had been sitting in the earlier run's invalid bucket the whole time. **A real coverage gap hid inside the count, and the run that missed it looked like the clean one** — it matched the prediction exactly, so it was reported as a reproduction rather than a discrepancy. It surfaced only because a third sweep disagreed by one.

`invalids` is now listed alongside `survivors` with the same `{line, op, before, after}` shape, so two runs are comparable mutant-by-mutant in **both** buckets.

Naming them immediately corrected a wrong diagnosis on the record. The 5 invalids on `clock.js` had been blamed on a contended box; a later run on an idle machine produced the same 5, and listing them shows why:

| reason | mutant |
|---|---|
| unparseable | `L147` — `/^\d{10,13}$/` → `{10,0}` |
| throws at load | `L413` ×2 — the `typeof module !== 'undefined'` guard |
| **non-terminating** | `L211` — `t += 86400000` → `t += 0` |
| **non-terminating** | `L390` — `while (hi2 - lo2 > 1)` → `>= 1` |

Two are **infinite loops**, which time out on any machine regardless of load. So each invalid now carries a `reason` — `timeout` (killed by the clock: `code === null`, a signal set) versus `no-output` (exited with a status, never loaded). They look identical in a count and have nothing else in common.

Timeouts stay **out** of the denominator rather than being scored as kills, which is more conservative than Stryker/PIT/mutmut, all of which count a timeout as killed. The reason is local: this harness also times out under CPU contention, so "hung" here does not reliably mean "the mutant hangs". Recording the reason lets a reader tell a genuine infinite loop from a busy afternoon — guessing between them is exactly what produced the wrong diagnosis.

Tooling only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
