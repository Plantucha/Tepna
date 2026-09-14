<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

`mutate.mjs` sized its worker pool from core count alone, but each worker is a full node test suite,
so the pool is memory-bound in practice: measured at the core-derived 16 workers it peaked at
16.57 GB, about 1.04 GB per job. That is fine on a 59 GB box with nothing else running and fatal on a
CI runner or a laptop, and nothing in a core-derived figure can tell those apart. `defaultJobs` now
takes an optional available-memory argument and treats it as a CEILING — it can only lower a pool on
a machine that reports being short, never raise one, and a host that cannot report memory keeps the
previous behaviour byte-for-byte. `mutation-crawl.mjs` no longer computes a competing default of its
own; it forwards `--jobs` only when a caller pins one, so there is a single sizing rule rather than
two that drift.
