<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ci, tests]
brief: CI-SHARDING-2026-07-12-BRIEF.md
---
Shard the CI `test` gate 4 ways — **4m05s → 1m20s** — and prove the shards still add up to the full gate.

The `tests` workflow spent **all** of its 4m05s in one step (`node tests/run-tests.mjs`; the other three
steps total 2 s), running single-threaded at 104% CPU on a multi-core runner. It now runs as a 4-way
matrix. **Measured on CI: 4m05s → 1m20s** — the suite *step* itself 245 s → 63 s (3.9x; locally the plan
is dead even at 25.3 s per shard, a clean 4.00x). The residual wall is job setup + the aggregator.

- **`group()` now skips EXECUTION, not just the report** (`tests/dex-tests.js`). It called `fn(T)`
  immediately and filtered afterwards, so a "scoped" run did the whole suite's work and discarded most of
  the output — full suite 101.07 s vs `DEX_GROUP=oxydex` 100.68 s (PROFILED-HOTSPOTS §2). That is why
  sharding could not be a workflow-only change. `--group` now finally means what it always claimed, so a
  scoped dev run is seconds rather than a minute and a half.
- **`tests/shard-plan.mjs`** — the partition planner. **Exactly-once first:** every declared group lands
  in exactly one shard, so the union of the shards *is* the unsharded suite. Index-based, never
  name-based — a pattern shard silently drops any group no pattern claims, and all N shards would go green
  having never run it. **Balance second:** round-robin is exactly-once but badly unbalanced here (the
  heavy ECGDex groups collide on one residue class — 42.7 s worst shard at N=4, only 2.4x), so the planner
  LPT bin-packs by measured cost from `tests/group-timings.json` → 25.3 s, 4.00x.
- **`tests/verify-shard-union.mjs`** — the shard gate's own gate, on every push (0.08 s): it takes the free
  declaration inventory (`--list` executes zero groups) and *proves* the plan partitions it for N = 1…12.
  `--deep` runs the full suite **and** all 4 shards for real and asserts the union is assertion-for-assertion
  identical to the unsharded run — same groups, same names, same verdicts — which is what proves the groups
  are order-independent. A gate that silently shrinks is worse than a slow one, so this is not assumed.
- **New surfaces:** `--shard=i/N`, `--list`, `--json`, `--timings`, and `gen-group-timings.mjs`.
  `group-timings.json` is a **hint, not a contract** — a missing or stale entry degrades shard *balance*,
  never coverage, so it is deliberately not gate-backed.

**Deliberately NOT done:** memoising `ECGDSP.genSynthetic` (the two heaviest groups regenerate 3–6 h
synthetic records). Several of those groups regenerate *on purpose*, to assert byte-reproducibility — a
cache would make those assertions pass trivially, speeding the gate up by weakening it.

CI-only + tests. No runtime file touched, no `manifestHash` moved, no fixture re-recorded.
