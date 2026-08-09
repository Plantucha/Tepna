<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Wire the JS diff-scoped mutation gate into CI, and publish a per-job CI timing breakdown — which immediately found the merge race is not where the docs assume.

TWO ADDITIONS, both closing gaps that were one file wide rather than missing capabilities.

1 · `.github/workflows/mutation.yml` — diff-scoped JS mutation on every PR. `capture-host-ci.yml` has
had the Python equivalent since #1090; the JS side had `tools/mutate.mjs --diff` (#1003) and no
workflow calling it. It is LEDGER-AWARE for free — `--diff` runs `classifySurvivors`, so a survivor
already recorded in `tools/mutate-equivalence.json` does not red the gate, which matters now that the
ratified target is `killed / DISTINGUISHABLE`. ADVISORY deliberately, on #1102's argument that "a gate
that runs when it has nothing to say trains people to ignore it": the classification covers 4 of 10
files today, so a blocking gate would stop PRs on survivors nobody has probed. Promote it when the
classification covers the files people touch.

   ⚠️ GitHub runs `run:` under `bash -e`, so `node …; echo "EXIT=$?"` never reaches the echo on the
   runs that matter. The exit code is captured under `set +e`, from the command itself, before
   anything else touches `$?` — CLAUDE.md §4b's rule, applied where it actually bites.

2 · `tools/ci-timing.mjs` + `.github/workflows/ci-timing.yml` — per-job p50/p90/max, the CRITICAL
PATH (a max, not a sum: optimising a job that is not the slowest buys nothing), and wait-from-run-
creation. Weekly + `workflow_dispatch`, never per-push — a per-push job would join the critical path
it is measuring. 17 known-answer selftests, no network.

MEASURED ON THE FIRST RUN, 25 runs of main, and two results are actionable:

  critical path   p50 2m38s · p90 12m32s · max 12m51s
  test (py3.12)   12m27s / 12m51s        the true ceiling — capture-host pytest, a 2-version matrix
  test (py3.13)   12m32s / 12m37s
  suite shard 1/6 10m01s                 ⚠ against shard 6/6 at 1m09s — EIGHT-POINT-SEVEN times
  suite shard 5/6  3m36s
  suite shard 3/6  1m44s · 2/6 56s · 4/6 1m15s · 6/6 1m09s

  · p90 (12m32s) EXCEEDS main's measured 7.2 min median merge cadence, so a PR is more likely than
    not to go stale before it is green. The race in CLAUDE.md §5 is now a measured number, not a
    projection.
  · THE SHARD PLAN HAS REGRESSED BADLY. `tests.yml`'s header records shards landing at 40/63/55/60 s
    and calls the N=6 plan "balance-bound at 4.00x". Shard 1/6 now takes 10m01s against shard 6/6's
    1m09s. The LPT packing is stale with respect to what the groups actually cost, and rebalancing it
    is worth ~6 minutes of the JS lane — the single cheapest CI win available.
  · The Python matrix, not the JS suite, owns the ceiling. Any effort spent on the JS lane below
    ~12m30 is invisible until that moves.

Also corrected in the tool before shipping: `wait` was first labelled `queue`, and the very first real
run falsified it — the `test` job showed a 10m05s "queue" for a 3-second job. It was waiting on
`needs:`, not on a runner. The column and its caveat now say so.
