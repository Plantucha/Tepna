<!--
  MUTATION-DECLARED-EXCLUSION-2026-10-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS (first built #3258 2026-10-03 as a per-function list; **re-shaped the same day on OWNER RULING — "One module-level declaration"** — after the first PRs to need it showed the per-function form was wrong, and after #3238 exposed a defect in the shipped version. Both land in this PR with tests. Still not DONE: the last acceptance item is one real diff-scoped run reporting `NOT_APPLICABLE` on a `capture.py` PR, which #3238 provides once this lands — stamping DONE before that run is exactly what §📌 forbids.) · **Created:** 2026-10-03

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
| a declared **bounded** declaration with reason / date / **measured** cost | `capture-host/tools/mutate-exclusions.json`, read by `mutation_diff.parse_exclusions` |
| `NOT_APPLICABLE` in the verdict **without turning FAIL into PASS** | `mutation_diff.declared_exclusion_status` |
| `unmeasured` ledger ingestion **with a growth gate** | `tools/mutate-unmeasured.json`, `--record-unmeasured`, `tests/test_mutation_exclusions.py` |
| the brief names what **retires** it | this file, and `retiredBy` inside the JSON |
| **no second status printer** | the existing `emit` path only; the flag writes a ledger and prints no verdict |

### The safety argument, which is the whole design

`declared_exclusion_status` is allowed **exactly one transition**: `UNKNOWN` or `NOT_RUN` →
`NOT_APPLICABLE`. It

* returns the status untouched for every **settled** status, so **it can never rewrite a `FAIL`**;
* **never returns `PASS`** under any input — asserted over the whole status enum × blocking ∈ {0,1};
* short-circuits while **anything is blocking** — a survivor outranks every declaration, always;
* acts only when **every** refused function is declared;
* **fails closed** on a refusal line it cannot decode exactly, and on a method glob whose decoded bare
  name could match a module-level function of the same name;
* is wired **only** into the budget-refusal and declared-module paths, so a crash, a memory refusal or
  a generation timeout cannot reach it whatever status they carry. That wiring does more of the safety
  work than the status check ever did.

A missing or malformed exclusion file yields the **empty set**, loudly: a broken file must never be able
to *grant* an exclusion.

## 🔴 Two defects in the version that shipped as #3258, and what they cost

**1. The guard read `status != "UNKNOWN"`, so it never fired on the canonical case.**
`budget_exhaustion_verdict` answers `NOT_RUN` when `decided == 0` and `UNKNOWN` only when `decided > 0`.
A diff whose **entire scope** is one declared function decides nothing — so #3238, the first PR to
exercise the exclusion for real, produced `NOT_RUN` and stayed red. I had built and tested only the
**mixed** case (some functions measured, some refused).

⚠️ **My own test asserted the defect as a contract.**
`test_it_acts_ONLY_on_UNKNOWN_so_it_can_never_rewrite_a_FAIL` listed `NOT_RUN` among the statuses the
function must refuse. So 60 passing tests, a clean mutation run over the exclusion's own six functions,
and 100 % statement-and-branch coverage all agreed with me. **A test can pin a defect in place**, and
the only thing that found this one was pointing the instrument at the first real case.

**2. The check was in the right logic and the wrong place.** It was consulted at the budget-refusal
point — *after* `clean_run_seconds` and after the budget was spent. #3238 measured **7693 s** to reach a
refusal whose answer sat in a committed file before any work started. Declaring saved the declaring PR
nothing, and since a later diff rarely touches the same function, it saved the fleet nothing. The check
now runs at **selection**, where the scoped stems are already known, so a declared module costs seconds.

Neither defect filed a residue row: both were found and fixed inside one session, and §📌 rows are for
defects that outlive the PR that found them. They are recorded here instead.

## Why ONE module key, and not a list of functions

The cost is a property of the **module**. `mutmut run <glob>` applies the glob when it **runs** mutants
and never when it **generates** them, so every `capture.py` diff pays for the whole module's population
whatever it touched. N function keys each citing one module-level measurement dressed **one fact as N**,
and the bound each of them raised became decoration. The owner ruled one module-level declaration.

**What that costs, stated plainly, because a one-line declaration should not hide it:** `capture.py` is
**13,673 lines**, with **229 module-level defs** and **290 functions** counting nested ones and methods,
and the declaration covers **all of them**. So the gate prints that count — recomputed from the module's
own AST, never quoted — together with how many of the diff's own functions fell under it, **on every
run**. The blind spot is re-counted per PR rather than agreed once and forgotten. (The "226 functions" in
`MUTATION-SCOPED-GENERATION-2026-09-28` was measured on 2026-09-28 and is already stale, which is itself
the argument for counting rather than quoting.)

**E7's two function keys are gone, not kept as examples.** The module key matches first, so they could
never fire again, and a declaration that can never fire is the stale-key hazard
`test_every_declared_key_names_a_function_that_EXISTS` exists to catch. Their two measurements — one by
time, one by memory, taken by independent mechanisms — are the module entry's `cost.source`.

### Why `timeline` is in no declaration at all

Residue row `2026-09-28-five-timeline-functions-were-never-mutated-and-the-ledger-cannot-hold-that`
prompted this work, and declaring its functions would have recorded **a fact nobody measured**: that run
had **17 functions in one scope**, and #3254 later mutated `timeline._placed` **alone** and decided all
**51** of its mutants in **1392 s**. Their unmeasurability was an artifact of **scope size**. They are
`undeclared` rows in the unmeasured ledger instead — the trace that row actually asked for.

**The rule this produced:** measurable-vs-unmeasurable, like gap-vs-equivalence, is a **per-mutant and
per-scope** question, never a property of a function. A declaration is about **cost**, never testability.

### One more thing the speed-up nearly broke

Moving the check to selection removed the budget refusal for a declared module — and
`unmeasured_rows` reads that refusal list. Without `declared_module_rows`, the ledger would have
recorded **nothing** for the one module whose blind spot it exists to enumerate. Making the gate faster
would have silently deleted the record of what the gate stopped measuring (§∅: an absent row is not an
absent gap).

## Acceptance

1. ✅ The declared set is exactly the committed census, and `EXCLUSION_BOUND` **equals** it (now 1).
2. ✅ Exactly **one** module key is permitted; a second raises. Checked independently of the bound —
   with the bound at 1 the bound check *masked* this rule, so it now runs after the per-entry rules.
3. ✅ A module key requires `cost.scope: module` **and both module measurements**; a function key
   requires `cost.scope: function`. Nineteen refusal shapes asserted.
4. ✅ `declared_module` matches a bare module key only — a function key is invisible to it, because
   reading one as the other is how a statement about one function would excuse 290.
5. ✅ The safety property asserted in **both** directions, including on `NOT_RUN`.
6. ✅ The covered-function count is **measured from the AST** and asserted to exceed the brief's stale
   226.
7. ✅ A declared module's skipped functions reach the unmeasured ledger as `declared` rows, ingested by
   a real run only.
8. ⏳ One real diff-scoped run reports `NOT_APPLICABLE` on a `capture.py` PR — #3238 provides it once
   this lands. **Not stamped until that run exists.**

## What retires this

**`briefs/MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md`** (PROPOSED, sized on paper, not built).
Scoping **generation** to the diff removes the cost this exclusion exists to declare. Every key here then
becomes measurable and `mutate-exclusions.json` goes to empty. **This is dated debt, not a design** — and
the bound is what keeps it from quietly becoming one.
