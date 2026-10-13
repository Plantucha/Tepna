<!--
  DEFECT-BENCHMARK-2026-10-12-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
  Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
  project root, or http://www.apache.org/licenses/LICENSE-2.0
-->
**Status:** PROPOSED — 2026-10-12 · **Created:** 2026-10-12

# A frozen benchmark of past defects

## Why

The fleet changes its own process often: a new hook, a new skill, a new gate, a new model. No fixed test tells whether a change made the fleet better at the work. This brief proposes one. The tasks come from defects the repo already found and fixed. The owner ordered this unit on 2026-10-12, from an external review of Tepna.

## The population

`briefs/RESIDUE.md` holds the tasks. Each closed row names a defect, its evidence and the PR that fixed it.

| measure (2026-10-12, `origin/main`) | count |
|---|---|
| residue rows | 564 |
| rows closed as `fixed #N` | 367 |
| distinct fix PRs | 295 |
| fix PRs found on `main` by their `(#N)` subject | 293 |
| of those, fix commits that touch `tests/` or `capture-host/tests/` | 186 |

The 186 rows with a test in the fix are the first candidates. The fix test is the oracle: it fails on the parent commit and passes on the fix commit.

## One task

1. Check out the parent of the fix commit.
2. Give the solver the row's defect and evidence text, and nothing from the fix.
3. Let the solver write a change.
4. Apply the fix commit's test files on top of the solver's change.
5. Run the narrowest real check for those tests.

A task is valid only when step 5 fails on the bare parent and passes on the fix commit. The builder checks both before a task enters the set. The builder excludes a task that cannot reproduce that pair, and names the reason.

## The split

The builder freezes the set at one commit and writes it to `audits/DEFECT-BENCHMARK.json`. The builder states the split rule before it scores anything. A hash of the row key puts each task in the dev half or the held-out half. Nobody tunes a hook, a skill or a prompt against the held-out half. A session quotes a held-out result once per process change.

## The score

Each run emits one `tepna.verdict/1` object per configuration. It reports these measures beside the population:

- correctness: the fix test passes;
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

## Acceptance

1. `tools/defect-bench.mjs` builds `audits/DEFECT-BENCHMARK.json` from `RESIDUE.md` and `git log`, with the parent and fix commits per task.
2. The builder proves the fail-then-pass pair for every included task and lists each exclusion with a reason.
3. The builder writes the split from a stated hash rule, and a selftest shows the rule is stable.
4. A scorer emits one verdict object per configuration, with the held-out half reported apart.
5. One baseline run with no agent completes: the fix commit itself, which must score 100 % correct.
