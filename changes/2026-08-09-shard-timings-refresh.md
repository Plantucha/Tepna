<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Refresh the shard cost hints — they described 164 groups against 419, and the CI lane was 8.7x unbalanced because of it.

`tests/group-timings.json` had gone stale by 61 %: 164 groups recorded, 419 declared. The 255 missing
ones all took the MEDIAN weight, so the LPT planner was bin-packing a 40 %-complete picture of the
suite's cost. Measured effect (tools/ci-timing.mjs, 25 runs of main): `suite (shard 1/6)` 10m01s
against `shard 6/6` 1m09s.

Refreshed from a full run: 419 groups, 481.2 s total. LPT at N=6 now plans
209s/58s/54s/54s/54s/54s — a makespan of 3.5 min against the 10m01s observed, so ~6.5 min comes off
the JS lane.

TWO CLAIMS IN `tests.yml`'s HEADER ARE FALSIFIED AND ARE NOW CORRECTED THERE:

  · "balance-bound at 4.00x (makespan ≈ total/6)" — it is GROUP-bound. `fitClockClosure — three
    clocks must close to zero` alone costs 208.9 s of 481.2 s, i.e. 43 % of the entire suite in ONE
    group. The makespan IS that group; total/6 (80 s) is unreachable at any shard count, and adding
    shards does nothing. Splitting it is the only thing that moves the floor.
  · The hint file's "drift is safe by construction" is true — it degrades balance, never correctness —
    but safe here meant SILENTLY EXPENSIVE. Nothing reported per-shard timings, so a 61 % stale file
    cost ~6.5 min per run for an unknown number of runs.

⚠️ This does not improve total CI wall. `test (py3.12)`/`(py3.13)` run ~12m30 each and own the
critical path; the JS lane is invisible below that. Recorded in the header so the next person measures
before optimising.
