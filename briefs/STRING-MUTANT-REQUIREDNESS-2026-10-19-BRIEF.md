<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** PROPOSED — 2026-10-19 · **Created:** 2026-10-19 · **Residue:** `2026-10-19-string-mutants-that-reach-an-interface-are-unmeasured`

# STRING-MUTANT-REQUIREDNESS — what the mutation gate sets aside, measured over six diffs

> The gate's own header states the reason for the exclusion: *"29 of the 33 survivors on capture.py's
> `_now` were mutations of log-message wording."* That number is a decade of this gate's design in one
> line, and nobody had re-measured it. Over six recent capture-host diffs the ratio inverts: **9 of 12
> excluded mutants change bytes a consumer reads, and only 3 are prose.**

## 1 · The question

`capture-host/tools/mutate_diff.py` excludes every string-literal mutant from the kill requirement.
mutmut wraps each literal in `XX` sentinels, so one rule covers a log message, a dict key, a `strftime`
pattern and a filesystem glob alike. #3669 made the exclusion VISIBLE: it counts the set-aside mutants,
names each one beside its file line, and balances `killed + survived + notRequired + emptyDiff` against
`decided`. Whether those mutants should be REQUIRED is a different question, and Heron put it on the
board (168, 169). No one can answer it without a rate, because a not-required mutant turned BLOCKING
lands on every open PR at once.

This brief measures the rate. **It does not move the bar** — that is the owner's call, and §6 gives the
cost.

## 2 · Method

Six merged commits that touch non-test `capture-host/*.py`, each measured as the gate would have seen
the PR's final state: `--base <the commit's own first parent>`.

```sh
git worktree add --detach /home/michal/wt-nrate<pr>-osp <commit>
# the counter ships in #3669, so the gate's three files and their two test files
# are overlaid from main onto the historical tree:
#   tools/mutate_diff.py · mutation_diff.py · mmeta.py
#   tests/test_mmeta.py · tests/test_mutation_diff.py
cd /home/michal/wt-nrate<pr>-osp/capture-host
.venv/bin/python tools/mutate_diff.py --base <commit>^ --report-only --json pr<pr>.json
```

Three deviations, each stated rather than hidden:

- **The overlay.** No sampled commit touches the three gate files, so the mutated population is
  unchanged. The two test files travel with them, because main's modules red the historical tests and
  mutmut needs a green baseline.
- **The base.** A merged squash carries the PR's own tests. A string mutant those tests kill never
  reaches the exclusion, so these counts are a **lower bound** on what the gate sets aside mid-PR. §7
  gives the measured instance.
- **One role is read lexically**, not from the AST. §5 names it.

## 3 · Result

| diff | status | generated | killed | survived | notRequired |
|---|---|---|---|---|---|
| #3593 `writers.resumable_set` | FAIL | 35 | 31 | 4 | 0 |
| #3627 `cpap_spool_decode` | PASS | 660 | 652 | 1 | **7** |
| #3640 `nights_index` | NOT_APPLICABLE | — | — | — | — |
| #3645 `capture` · `cpap_spool_caller` | PASS | 13 | 13 | 0 | 0 |
| #3650 `nightqc` · `nights_index` | PASS | 375 | 368 | 2 | **5** |
| #3654 `capture` · `stallsampler` | PASS | 190 | 188 | 2 | 0 |
| **five applicable** | | **1273** | **1252** | **9** | **12** |

`1252 + 9 + 12 = 1273`, so every generated mutant is in a bucket. #3640 examined nothing and the gate
says so, which is why the totals leave it out rather than counting a zero.

**The headline is the last two columns.** Over these five diffs the gate set aside **12** mutants and
reported **9** survivors. The exclusion is not a rounding error beside the gate's output; it is larger
than the gate's entire output.

## 4 · The twelve, each placed by its own diff key

| diff | line | the literal mutmut changed | mutants | role | placed by |
|---|---|---|---|---|---|
| #3627 | `cpap_spool_decode.py:327` | `"Decode committed AS11 Summary spool rounds to JSON lines."` | 1 | PROSE | `description=` keyword |
| #3627 | `:328` | `"the spool store root (holds cpap_spool_ledger.jsonl and committed/)"` | 1 | PROSE | `help=` keyword |
| #3627 | `:329` | `"SD-card STR.edf: compare usage per day, to the minute"` | 1 | PROSE | `help=` keyword |
| #3627 | `:338` | `"file"` in `print(json.dumps({"file": …, "error": "missing"}))` | 2 | INTERFACE | dict key |
| #3627 | `:345` | `"file"` in `print(json.dumps({"file": …, "error": f"truncated: {e}"}))` | 2 | INTERFACE | dict key |
| #3650 | `nights_index.py:748` | `"files"` in `r["files"] = {…}` | 2 | INTERFACE | subscript key |
| #3650 | `:827` | `"cpap-ble/DATALOG/????????"` in `for pat in (…)` | 3 | INTERFACE | path or glob pattern |

Seven distinct literals, three of them prose. mutmut emits more than one mutant per literal — an
`XX`-wrap and a case flip — so **count literals when sizing a rule and mutants when sizing a gate run.**

**One of the twelve is a defect of the kind this gate exists to catch.** `nights_index.py:827` feeds
`glob.glob`, and the case flip reads `"cpap-ble/datalog/????????"`. On a case-sensitive filesystem that
pattern matches nothing, so the whole `cpap-ble` scan for stampless folders silently finds no folders.
That is the same shape as the `diskguard.py` precedent the gate's header cites: full coverage, suite
green, behaviour reversed.

## 5 · The rule this measurement found decidable

Its syntax places every one of the seven literals, with no judgement call:

| the literal sits in | role | why |
|---|---|---|
| a dict key, a subscript key, either side of a comparison | INTERFACE | a consumer looks the name up |
| a value inside a `json.dumps`, `print` or `write` record | INTERFACE | the bytes leave the process |
| a `strftime` or `strptime` format | INTERFACE | a consumer parses it |
| a `join`, `split`, `startswith`, `strip` argument | INTERFACE | it is the separator or the affix |
| an argparse flag name or `dest=` | INTERFACE | a caller types it |
| a `help=`, `description=`, `msg=`, `epilog=` keyword | PROSE | only a human reads it |
| an argument to a logger or to `print` that is not a dumped record | PROSE | only a human reads it |
| a sequence element that holds `/`, `*` or `?` | INTERFACE | **lexical, not syntactic** — a path or glob a consumer matches |

The last row is the one rule read from the text rather than the tree, and it is the one a reader should
challenge first. It placed 3 of the 12 mutants. The AST alone cannot place a tuple element, because the
tuple names no consumer.

## 6 · The measured cost of moving the bar

If the INTERFACE roles become required and PROSE stays excluded, then over these five diffs:

- **the gate demands 9 more kills**, over 4 literals in 2 modules.
- **#3627 and #3650 flip from PASS to FAIL** until tests observe those literals.
- The tests owed are small: one asserts the `"file"` key of a printed error record, one asserts the
  `"files"` key of a night row, one asserts that the `cpap-ble` scan finds a stampless folder.
- **#3593, #3645 and #3654 do not move.** Three of five diffs pay nothing.

The cost is therefore bounded and the tests are the ones a reader would want anyway. What the rate does
NOT tell us is the cost on a diff that adds a new argparse surface, where the prose share is high and
the exclusion is right for every one of those mutants.

## 7 · What this does not show

- **#3654 reads 0 here and 6 in the reproduction** that found the counting defect. That run used
  `--base 8c2041022` against the pre-merge head `76b7109b3`. The merged squash carries the PR's own
  tests, and those tests kill the same string mutants. So the gate's exclusion count depends on the
  base and on the tests present, and §3 is a lower bound.
- **Five diffs is not a sample of the repo.** It is the five most recent merged diffs with a mutable
  python change. Two carry every exclusion; three carry none.
- **No mutant was re-run after classification.** The roles come from the AST and from the mutant's own
  diff key, never from a second mutation run.

## 8 · Acceptance

- [x] The measurement spans more than one diff, and publishes the per-diff numbers.
- [x] §4 names every excluded mutant with its literal, its line and its role.
- [x] §5 states the placing rule in advance, and labels the one lexical rule.
- [x] §6 measures the cost of moving the bar on the same diffs.
- [ ] The owner rules on whether the INTERFACE roles become required.
- [ ] If they do: the rule lands in `mutation_diff.py` beside `string_only_verdict`, with the selftest
      cases this brief's table supplies, and the residue row closes to this brief.

## 9 · Interlocks

`MUTATION-PROGRAM-2026-08-09-BRIEF.md` (the gate's programme) · `briefs/RESIDUE.md` row
`2026-10-19-string-mutants-that-reach-an-interface-are-unmeasured` (OPEN; it closes when the owner
rules) · board 163, 167, 168, 169 · the counting fix is #3669.
