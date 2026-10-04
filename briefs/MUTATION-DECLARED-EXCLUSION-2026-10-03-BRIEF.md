<!--
  MUTATION-DECLARED-EXCLUSION-2026-10-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS (BUILT in this PR — the declared list, the one verdict transition, the unmeasured ledger and its growth gate all land here with tests. It stays IN-PROGRESS rather than DONE for one reason: the acceptance item "the diff gate runs clean on `main` with the exclusion in place" cannot be demonstrated while `stage_root_reads` clobbers the staged equivalence ledger — every capture-host mutation run currently refuses before reaching a mutant, on five open PRs as well as this one. Flip to DONE when that fix is on `main` and one diff-scoped run on a `capture.py` function reports NOT_APPLICABLE rather than UNKNOWN.) · **Created:** 2026-10-03

# A cost that is not the diff's should be declared once, not rediscovered every PR

**Owner ruling 2026-10-03: "Build the exclusion."** This brief is what was built and, more importantly,
what it is forbidden to do.

## The problem, stated as a measurement

`mutmut run <glob>` applies the glob when it **runs** mutants, never when it **generates** them. So a
one-function diff on `capture.py` still generates the module's entire population: **562,427,047 bytes**
of mutants, and a traced stats pass of **≥ 7556 s** against a clean run of **≤ 1337 s** — against a
`GATE_BUDGET_SEC` of 7200.

`budget_exhaustion_verdict` reports that correctly: `UNKNOWN`, "the refused ones are unmeasured, not
failed". The verdict is right and **unactionable**. Every PR that touches that function rediscovers the
same fact, pays the same two hours, and gets the same red. #3238 is the clean case: its scope was ideal
— one 87-line function, one keyword argument — and the gate still reached no mutant. 618 spinner lines
carried **zero `N/M` ticks**, which is what proves nothing was tested rather than merely slow.

## What was built

| property (owner's) | where |
|---|---|
| a declared **bounded** list of function keys with reason / date / **measured** cost | `capture-host/tools/mutate-exclusions.json`, read by `mutation_diff.parse_exclusions` |
| `NOT_APPLICABLE` in the verdict **without turning FAIL into PASS** | `mutation_diff.declared_exclusion_status` |
| `unmeasured` ledger ingestion **with a growth gate** | `capture-host/tools/mutate-unmeasured.json`, `--record-unmeasured`, `tests/test_mutation_exclusions.py` |
| the brief names what **retires** it | this file, and `retiredBy` inside the JSON |
| **no second status printer** | the existing `emit` path only; the new flag writes a ledger and prints no verdict |

### The safety argument, which is the whole design

`declared_exclusion_status` is allowed **exactly one transition**: `UNKNOWN → NOT_APPLICABLE`. It

* returns the status untouched unless it is `UNKNOWN`, so **it can never rewrite a `FAIL`**;
* **never returns `PASS`** under any input — asserted over the entire status enum × blocking ∈ {0,1};
* short-circuits while **anything is blocking** — a survivor outranks every declaration, always;
* acts only when **every** refused function is declared; one undeclared refusal and the run stays
  `UNKNOWN`, because a partial declaration must not speak for the rest;
* **fails closed** on a refusal line it cannot decode exactly, and on a method glob whose decoded bare
  name could match a module-level function of the same name. A false match is the escape hatch this
  design exists to refuse.

A malformed or missing exclusion file yields the **empty set**, loudly. A broken file must never be able
to *grant* an exclusion.

### Why the list is short, and why `timeline` is not in it

Residue row `2026-09-28-five-timeline-functions-were-never-mutated-and-the-ledger-cannot-hold-that`
prompted this work, and the obvious move — declare its five `timeline` functions — would have recorded a
fact **nobody measured**. That run (36399889018) had **17 functions in one scope**; four were never
attempted because the budget was eaten, not because they are unmeasurable. #3254 then mutated
`timeline._placed` **alone** and decided all 51 of its mutants in **1392 s**, comfortably inside the
budget.

So the declared list holds **only `capture.py`**, whose cost is different in kind: module-level,
independent of the glob, unreachable by any narrowing of the diff. The four `timeline` functions are
instead ingested as `undeclared` rows in the unmeasured ledger — which is what that residue row actually
asked for, a trace where the survivor ledger can hold none.

**The sharper rule this produced, worth keeping:** *gap vs equivalence, and measurable vs unmeasurable,
are per-MUTANT and per-SCOPE questions — never properties of a function.* Within one 29-line function a
line-1 mutant was a test gap while a middle-of-function mutant was a true equivalence. An exclusion keyed
on a function is therefore a declaration about **cost**, never about testability.

## Acceptance

1. ✅ The declared set is exactly the committed census, and `EXCLUSION_BOUND` **equals** it — headroom
   would make the bound decoration, so the next exclusion costs a deliberate raise.
2. ✅ `parse_exclusions` refuses: wrong schema, glob or bare-module key, missing reason or date, a cost
   with no provenance or no source, more entries than the bound. Fourteen refusal shapes asserted.
3. ✅ Every declared key names a function that **exists** (AST-checked) — a stale key reads as a live
   declaration and grants nothing.
4. ✅ The safety property asserted in **both** directions.
5. ✅ The unmeasured ledger does not grow silently; every `declared` row is actually declared.
6. ✅ Both ledgers are byte-canonical `json.dumps(indent=2, ensure_ascii=False) + "\n"`.
7. ⏳ One diff-scoped run on a `capture.py` function reports `NOT_APPLICABLE` — **blocked**, see Status.

## What retires this

**`briefs/MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md`** (PROPOSED, sized on paper, not built).
Scoping **generation** to the diff removes the cost this exclusion exists to declare. Every key here then
becomes measurable and `mutate-exclusions.json` goes to empty. **This is dated debt, not a design** — and
the bound is what keeps it from quietly becoming one.
