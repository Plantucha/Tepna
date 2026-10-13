<!--
  DEFECT-BENCHMARK-2026-10-12-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** IN-PROGRESS — 2026-10-12 · **Created:** 2026-10-12

# A frozen benchmark of past defects

## Why

The fleet changes its own process often: a new hook, a new skill, a new gate, a new model. No fixed test tells whether a change made the fleet better at the work. This brief proposes one. The tasks come from defects the repo already found and fixed. The owner ordered this unit on 2026-10-12, from an external review of Tepna.

## The population

`briefs/RESIDUE.md` holds the tasks. Each closed row names a defect, its evidence and the PR that fixed it.

| measure (`f53ad543f`, the commit the builder froze) | count |
|---|---|
| residue rows | 569 |
| rows whose STATE cell is exactly `fixed #N` | 344 |
| distinct fix PRs among those rows | 275 |
| those PRs resolved to one commit on `main` by their `(#N)` subject | 341 rows · 1 ambiguous · 3 unresolved |
| of the resolved rows, fix commits that touch a test file | 231 |
| of those, a `capture-host/tests/test_*.py` oracle | 138 rows · 108 distinct PRs |

The first table of this brief read 367 rows and 295 PRs. Those two figures match a line-wide `fixed #\d+`
search, which this commit reproduces exactly: 372 rows at 569 rows of residue. A line-wide search counts a
row that merely quotes another row's closure in its evidence cell, so it over-counts the closed set. The
builder reads the STATE cell alone, and `lineWideRows()` in `tools/defect-bench.mjs` keeps the over-count
measurable rather than asserted. Every count here moves with each landing PR; the builder measures the
population at its own commit and stamps that commit into the verdict.

The 138 rows with a pytest oracle are the first candidates, because `capture-host`'s suite names one test
file per defect and runs in seconds. The builder names the three other lanes rather than dropping them silently:
`oracle-shared-suite` (80 rows — `tests/dex-tests.js`, one file every PR touches, so a fail-then-pass pair
there proves nothing about one row), `oracle-js-tree` (12), `oracle-other-test-path` (1). The fix test is
the oracle: it fails on the parent commit and passes on the fix commit.

## One task

1. Check out the parent of the fix commit.
2. Give the solver the row's defect and evidence text, and nothing from the fix.
3. Let the solver write a change.
4. Apply the fix commit's test files on top of the solver's change.
5. Run the task's named test ids — its `failToPass` list.

A task is valid only when step 5 fails on the bare parent and passes on the fix commit. The builder
checks both before a task enters the set, and it names a reason for every task it excludes.

The oracle is a set of test ids, not a test file. A file holds tests the task never touched, and in a
bare `git archive` extract some of them fail at both commits — a test that reads a git-tracked file
mode, or a module that lives outside `capture-host/`. Those ids are background. The builder subtracts
them, counts what it subtracted, and publishes the count beside the task as `backgroundAtParent`. It
then re-runs the remaining ids alone at both commits, because a test that fails only inside its own
file is order-dependent and would score the order rather than the fix.

## The split

The builder freezes the set at one commit and writes it to `audits/DEFECT-BENCHMARK.json`. The builder states the split rule before it scores anything. A hash of the row key puts each task in the dev half or the held-out half. Nobody tunes a hook, a skill or a prompt against the held-out half. A session quotes a held-out result once per process change.

## The score

Each run emits one `tepna.verdict/1` object per configuration. It reports these measures beside the population:

- correctness: every id in the task's `failToPass` list passes, and the background failures do not grow;
- escaped defects: the full gate for the touched area reds after the change;
- mutation: the touched lines keep or lose killed mutants, where the area has a mutation gate;
- refusal: the solver says "no fix without the box, the corpus or a design call" where the row needs one;
- cost: tokens and wall-clock.

A refusal on a task that needs the box or the corpus scores as correct. A fabricated fix on that task scores as wrong. The XERJ refusal floor (`tools/xerj-query.mjs`, 2026-10-12) shows the same rule on search: "no prior work" beats a weak hit.

## What this brief does not do

- It runs no agent. The owner rules agents out on the fleet's own budget. A configuration run happens only on owner order, on the API lane.
- It compares no external framework.
- It quotes no third-party figure until someone checks the source.

## Free baselines

A local model on the rig costs no API tokens. The ollama model `qwen3-coder:30b` is one candidate baseline. It is a different model, so its score is a floor for the method, not a measure of the fleet.

## Links

- A stale verdict is a defect this benchmark can catch. `tools/pr-compliance.mjs` check 7 (`quoted-verdict-is-fresh`, #3516) fails a PR body that quotes a verdict from code that no longer merges.
- `briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md` — the verdict shape.
- `briefs/HELD-OUT-BAND-CAMPAIGN-2026-09-22-BRIEF.md` — the fleet's earlier held-out rule.

## Built so far (2026-10-12)

`tools/defect-bench.mjs` covers acceptance items 1, 2 and 3. `--build` reads `RESIDUE.md` at its own
commit, resolves each `fixed #N` state cell to one commit on `main`, picks the oracle lane, and proves the
pair by extracting the parent tree with `git archive`, overlaying the fix commit's test files, and running
the task's test ids. It creates no worktree and moves no checkout. `--selftest` covers the split rule, the
parsers and the exclusion names. `--verdict-sample` prints the verdict object alone, which is what
`verify:verdict-adoption` parses.

The first full sweep ran at `f53ad543f8b6`: **95 tasks proven over 138 candidates and 344 closed rows**,
45 in the dev half and 50 in the held-out half, verdict `PASS`. Eighty-nine tasks carry an id-level
oracle and six carry a file-level one, 863 fail-to-pass ids in all, and 36 tasks carry background
failures their solver is not graded on — 491 ids of background in total.

Every one of the 249 exclusions carries a reason and a count:

| count | reason | what it means |
|---|---|---|
| 109 | `no-test-in-fix` | the fix commit touched no test file, so there is no oracle to run |
| 80 | `oracle-shared-suite` | the oracle is `tests/dex-tests.js`, whose narrowest check is a group filter this tool cannot derive from a diff yet |
| 33 | `file-not-green-at-fix` | the test file errors during collection inside a `capture-host`-only extract — 25 of the 33 error at the fix commit too, so the file reaches outside the extract |
| 12 | `oracle-js-tree` | a `tests/*.mjs` oracle needs the whole tree plus `node_modules` in the extract |
| 8 | `no-fail-at-parent` | the test passes on the parent already, so the fix changed nothing the test can see |
| 3 | `no-commit-for-pr` | the PR number in the state cell resolves to no commit on `main` |
| 1 each | `oracle-other-test-path` · `ambiguous-commit-for-pr` · `no-pass-at-fix` · `ids-pass-alone-at-parent` | a non-test path under `tests/`, two commits for one PR, a fix that repaired no id in its own file, and an id that fails only inside its file |

Two measurements cost real tasks and are worth naming. A file-level oracle threw away 38 of the
candidates the id-level one keeps: 19 of those 38 showed the same ~31 failures at both commits, and the
other 19 failed on tests that read the surrounding repository. And a `\S+` cut on pytest's own summary
line truncated a parametrized id — `test_an_unusable_version_report_is_absence_never_a_sha[echo '']`
became `…_a_sha[echo` — so pytest selected nothing, answered "no tests ran", and four tasks read as
defects that do not reproduce. Both numbers come from the same sweep, not from an estimate.

Acceptance item 5 holds by construction rather than by result: a task enters the set only when its ids
pass at the fix commit, so the no-agent baseline scores 100 % correct on every included task. That is a
property of the inclusion rule, and it is worth naming as one — it measures that the oracle works, not
that anything solved anything.

Acceptance item 4 is not built. No solver has run, so there is no configuration to score.

Two extensions stay unbuilt and named. Eight of the 33 `file-not-green-at-fix` tasks collect at the fix
commit and fail only on background, so taking the fix's passing ids as the oracle would recover them.
And a wider extract would carry the files the other 25 reach for, at eight times the bytes per task —
`capture-host` alone archives to 14.6 MB against 114.7 MB for the tree without `uploads/`, measured
2026-10-12 — and it would not help a test that reads a git-tracked file mode, because an extract is not
a git repository.

## Acceptance

1. `tools/defect-bench.mjs` builds `audits/DEFECT-BENCHMARK.json` from `RESIDUE.md` and `git log`, with the parent and fix commits per task.
2. The builder proves the fail-then-pass pair for every included task and lists each exclusion with a reason.
3. The builder writes the split from a stated hash rule, and a selftest shows the rule is stable.
4. A scorer emits one verdict object per configuration, with the held-out half reported apart.
5. One baseline run with no agent completes: the fix commit itself, which must score 100 % correct.
