---
bump: minor
type: added
brief: none
---

Advisory gates now emit a machine-readable verdict beside the prose one, so a downstream reader keys
on a status instead of parsing an English sentence.

`  advisory-state: mypy=RISEN format=EMPTY_SCOPE`

**Additive. Not blocking** — §P3 owns that flip and it flips at 0.

## The defect: a verdict that exists only as prose

The mypy leg computes its direction and then states it in a sentence. Nothing else carries it — **not
the exit code**: measured across two real runs, the leg exits **1 in both** the risen and the
at-baseline case, because mypy exits non-zero whenever any error exists and there are 41. An aggregate
keyed on exit status sees the two cases as identical.

That is how a RISEN count reached `main` and then surfaced on a later branch as that author's fault.

## A reader of the prose has no correct predicate — that is the finding

| predicate | failure |
|---|---|
| anchored — `^\s*mypy: .*RISEN` | breaks on any reflow that keeps the word but moves it → **false green** |
| loose — `grep -c RISEN` | matches `test_A_RISEN_COUNT_IS_NAMED_AS_RISEN`, which pytest prints in its short summary when that test **fails** → **false alarm**, the test *about* the token masquerading as the condition |

Every predicate is narrower or broader than what is guaranteed: the test promises the word appears
**somewhere**; a reader needs it **as the mypy verdict**. Not untidy — unwinnable.

## Why `key=value`, and why that is structural

`=` **cannot occur in a Python identifier**, so `mypy=RISEN` is unforgeable by a test name however that
test is worded. The false-alarm mode above is excluded by construction rather than by care.

## Additive on purpose — the hazard this unit could have introduced

Every `  mypy: …` line is **byte-unchanged**, verified in the diff. Folding a status into that line, or
reflowing it to make room, would have kept the word, passed `test_A_RISEN_COUNT_IS_NAMED_AS_RISEN`
(which only needs it *somewhere*), and **silently returned 0 for a reader anchored to that prefix** —
the same anchored-pattern failure, introduced by its own fix. A test now pins that anchor in both
directions.

`AT_BASELINE`, never `NOT_RISEN`: `test_A_COUNT_AT_THE_BASELINE_SAYS_SO_WITHOUT_ALARM` asserts "RISEN"
is **absent** from the whole run, so a token merely containing the word would have reded it.

## Siblings — named either way, since an unexamined sibling is not a clean one

Two advisory legs exist: **mypy** and **format**. `run_advisory` derives a state from `rc` for any leg
that does not set one, so `format` is covered without knowing the seam exists, and so is the next
advisory anyone adds. The two manually-appended legs (mypy-not-installed, format-empty-scope) append
their own states, which also pins the parallel arrays against desynchronising.

The override is what a *direction-reporting* leg needs: mypy's `rc` is 1 in both states, so the derived
default would be `ISSUES` either way and carry no direction at all.

## Tests

Six added, four mutations, all killing:

| mutation | fires |
|---|---|
| drop the state line | 2 |
| `NOT_RISEN` for at-baseline | 3, including the pre-existing negative assertion |
| remove the rc-derived default | the sibling-default test |
| remove the override | 2 |

⚠️ **One of my tests was vacuous and mutation is what caught it.** The sibling test first inspected only
the sandbox's state line — where `format` takes its EMPTY_SCOPE branch and never calls `run_advisory`,
so removing the default entirely left it green. Replaced with a harness that extracts `run_advisory`
and calls it directly. **A surviving mutant means either a vacuous test or a mutation that missed the
invariant**, and I had one of each in this unit.

⚠️ **And the harness caught my own model of the seam.** My first version set `ADVISORY_STATE` before the
call; `run_advisory` clears it on entry, so only a callee in the *same shell* can set it. That is
exactly why `mypy_advisory` is a shell function while the format leg is an external process — and why
the external one must take the derived default.

`check.sh` EXIT=0: 7383 passed, coverage 100.00%. Its first real emission reads `mypy=RISEN`, reporting
the live regression #2671 fixes.
