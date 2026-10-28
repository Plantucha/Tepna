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

## 4. Next step

Read the `tools/mutate_diff.py --base origin/main` verdict in the scratchpad log. Then rebase with `node tools/rebase-safe.mjs`, close the row as `fixed #4040`, run `capture-host/check.sh` and `npm run check`, and post the undraft ask on queue thread 8.

## 5. Open questions

The owner may still want any deleted default back as a named module constant. Three of them were copies of `30.0` for one CPAP poll interval.

## 6. Blockers

The worktree sat 2 commits behind the ref, and `guard-stale-ledger.sh` denies the row closure until a rebase. Neither commit touches `capture-host`, so the capture-host green carries over the rebase and the JS gate does not.

## 7. The doc-search query

`node tools/doc-search.mjs "kill a default-literal mutant by observing the handover"` finds `briefs/MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md`, the equivalence ledger README, and board #1228.
