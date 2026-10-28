# Heron · unit 108 `defkills`

## 1. Unit

Give each of the 79 mutation survivors a kill or a recorded excuse. Rewrite the scanner the mutation gate cannot decide. The unit closes row `2026-10-21-sixteen-literal-defaults-are-taken-by-no-production-call`. Unit 106 landed the code half.

## 2. Branch and worktree

Branch `claude/defkills-hrn` in `~/wt-defkills-hrn`, carried from `hold/defaults16-hrn` onto `c2d769c2c`. Code commit `19a198cfd`, carried signature commit `541f9836d`. PR #4040, draft.

## 3. Exact stopping point

74 survivors red a new test. 4 sit in `capture-host/tools/mutate-equivalence.json` as `untestable-by-design`. The scanner rewrite orphans the last one. Six test files gained legs. `nightqc.constant_runs` walks with `enumerate`, and it matches the old walk over 59364 checked cases with 0 mismatches.

Hand plants, one mutant per fresh tree:

| set | verdict |
|---|---|
| `nightqc.py` | 27 of 27 KILLED |
| `as11_link.py` | 19 of 20 KILLED, 1 recorded |
| `cpap_live.py` | 13 of 13 KILLED |
| `geo.py` | 10 of 10 KILLED |
| `adapter_pool.py`, `cpap_harvest.py` | 4 of 4 KILLED |
| the equivalence claims | 4 of 4 SURVIVED, 0 red legs |

The gate then named ONE survivor the hand census had missed. It sits in the rewritten scanner itself: `nightqc.x_constant_runs__mutmut_18` moves the TRAILING run test from `>=` to `>`.

The walk emits a run at the sample that ends it. A run reaching the last sample therefore leaves the loop unemitted, and the trailing copy of that test emits it on its own comparison. The middle-run case pinned the loop copy and said nothing about this one. `test_constant_runs_counts_a_TAIL_run_at_exactly_min_run` now pins three positions, and a plant of that exact mutation reds it with 1 red leg and no other.

The run that found it reads `killed 617`, `survived 5`, `excused 4`, `undecided 0` over 639 generated mutants. `undecided 0` is what the `enumerate` rewrite bought.

## 4. Next step

Re-run `capture-host/check.sh` in full and `tools/mutate_diff.py --base origin/main` on THIS commit. The gate builds its scratch from the commit and never from the tree. The mutation verdict must read 0 survivors and 0 undecided. Then push with the lease and correct the thread 8 ask. Entry #1820 claimed the census accounted for every survivor, and the gate had already found one more.

## 5. Open questions

The owner may still want any deleted default back as a named module constant. Three of them were copies of `30.0` for one CPAP poll interval.

## 6. Blockers

The worktree sat 2 commits behind the ref, and `guard-stale-ledger.sh` denies the row closure until a rebase. Neither commit touches `capture-host`, so the capture-host green carries over the rebase and the JS gate does not.

## 7. The doc-search query

`node tools/doc-search.mjs "kill a default-literal mutant by observing the handover"` finds `briefs/MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md`, the equivalence ledger README, and board #1228.
