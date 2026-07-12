<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-12 · **Created:** 2026-07-12 · **Executes:** `PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF.md` §2 → §1a

# CI sharding — the 4-minute `test` gate, split 4 ways

The `tests` workflow took **4m05s**, and *all* of it was one step: `node tests/run-tests.mjs`
(the other three steps in that job total **2 s**). That step ran single-threaded — **104% CPU on a
multi-core runner** — with ~75% of its time inside `ecgdex-dsp.js`
(`PROFILED-HOTSPOTS-CI-AND-DSP-2026-07-12-BRIEF` §1). It now runs as **4 parallel shards**.

**Measured on CI** (run `29198623082`): **4m05s → 1m20s** wall. The suite *step* itself went
**245 s → 63 s (3.9x)** — the 4.00x plan holds; the rest of the wall is ~7 s of job setup per shard plus
the 3 s aggregator. The four shards landed at 40/63/55/60 s (the spread is runner-to-runner speed
variance, not plan skew — locally the plan is dead even at 25.3 s each).

## What was actually wrong (§2 of the profiling brief, confirmed)

`DEX_GROUP` / `--group` **filtered the report, not the run.** `group()` called `fn(T)` immediately and
the filter was applied afterwards, at the bottom of `runDexTests`. So a "scoped" run did the whole
suite's work and then threw most of the output away:

| run | wall |
|---|---|
| full suite | 101.07 s |
| `DEX_GROUP=oxydex` | **100.68 s** ← everything still ran |

`run-tests.mjs` documented the opposite. That is why sharding was **not** a workflow-only change: a CI
matrix over `--group` patterns would have burned 4× the compute for ~0× the speedup.

## What shipped

1. **`group()` now skips EXECUTION**, not just the report (`tests/dex-tests.js`). An unselected group is
   still *declared* (so declaration indices stay stable and `totalGroups` stays honest) but its body
   never runs. This is the whole speedup — and it also makes `--group` finally mean what it always
   claimed, which is a real win for the dev loop (a scoped run is now seconds).
2. **`tests/shard-plan.mjs`** — the partition planner. Two properties, in priority order:
   - **Exactly-once (correctness).** Every declared group lands in exactly one shard, so the union of
     the shards **is** the unsharded suite. The partition is **index-based, never name-based**: a
     pattern shard silently drops any group no pattern happens to claim, and all N shards would go
     green having never run it. A shrinking gate is strictly worse than a slow one.
   - **Balance (speed).** Round-robin (`i % N`) is exactly-once but **badly unbalanced here** — the cost
     is concentrated in a few ECGDex groups that collide on one residue class: **42.7 s** worst shard at
     N=4, a mere 2.4×. So the planner **LPT bin-packs by measured cost** (`tests/group-timings.json`) →
     **25.3 s, 4.00×**.
3. **`tests/verify-shard-union.mjs`** — the shard gate's own gate, run on every push (**0.08 s**). It
   takes the free declaration inventory (`run-tests --list` executes zero groups) and *proves*
   `planShards()` partitions it for N = 1…12. `--deep` additionally runs the full suite **and** all 4
   shards for real and asserts the union is **assertion-for-assertion identical** to the unsharded run
   — same groups, same names, same verdicts. That is what proves the groups are order-independent (no
   group was quietly relying on state an earlier one left behind). `--deep` costs more than sharding
   saves, so CI runs the fast partition proof; run `--deep` when you change the partition scheme.
4. **`.github/workflows/tests.yml`** — a 4-way matrix, plus a `static` job (shard-union proof + the
   build/provenance checks, ~15 s, in parallel), plus an aggregator job named **`test`** so branch
   protection keeps one stable check name regardless of shard count.

## Why the obvious optimisation was NOT taken

The two heaviest groups (19.6 s + 14.6 s) each call `ECGDSP.genSynthetic({durSec: 3–6 h})` — regenerating
multi-hour 130 Hz records and running the full DSP. Memoising `genSynthetic` by param key would be a
large, easy win. **Deliberately not done:** several of those groups regenerate *on purpose*, to assert
byte-reproducibility (`deterministic genSynthetic → compute`). A cache would make those assertions pass
trivially — it would speed the gate up by **weakening** it. Sharding buys the same wall-clock without
touching what the suite proves. (`AUDIT-PROMPT.md`: correctness wins; a faster gate that proves less is
a regression.)

## New surfaces

| | |
|---|---|
| `node tests/run-tests.mjs --shard=2/4` | run one shard (1-based) |
| `node tests/run-tests.mjs --list` | declaration inventory, executes nothing (~0.07 s) |
| `node tests/run-tests.mjs --json` | machine-readable results |
| `node tests/run-tests.mjs --timings` | slowest groups — how you size the shard count |
| `node tests/verify-shard-union.mjs [--deep]` | prove the shards partition the suite |
| `node tests/run-tests.mjs --json \| node tests/gen-group-timings.mjs` | refresh the balance hints |

`tests/group-timings.json` is a **hint, not a contract**: a group missing from it still runs (median
weight, still exactly one shard), and a stale time degrades **balance only, never coverage**. So it going
out of date makes CI slower, never wrong — and it is deliberately **not** gate-backed. The shard count
lives in two places that must agree: `matrix.shard` in `tests.yml` and `CI_SHARDS` in
`verify-shard-union.mjs` (GitHub forbids `env:` inside a matrix literal).

## Gates

`run-tests.mjs` **0 failures, 134 groups / 2109 assertions** (2103 baseline + 6 new shard-selector self-tests) ·
`verify-shard-union.mjs --deep` **union ≡ full run, every verdict identical** ·
`build.mjs --check` clean · `verify-manifest.mjs` clean · biome clean.
**No runtime file touched — no `manifestHash` moved, no fixture re-recorded.**

## Follow-ups

- The floor is now the **single slowest group (19.6 s)**: past N=5 sharding stops paying (N=6 → 19.6 s).
  To go below ~1 min, that one group — `ECGDex stampless events`, a 6 h synthetic at 130 Hz — has to get
  cheaper or split, *without* weakening what it proves.
- `browser-gates.yml` / `no-network.yml` re-install Playwright from scratch on every run (~35 s of
  no-network's 50 s). An `actions/cache` on `~/.cache/ms-playwright` is the obvious next cut.
