<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-08-11 · **Created:** 2026-08-11

# MUTATION PROGRAM — FOLLOW-UPS

Executes-from: `MUTATION-PROGRAM-2026-08-09-BRIEF.md`. That brief set the target and the method; this
one records what executing it **discovered**, and the decision the owner has since made on the back
of it (§2: the target is now **99 % of distinguishable**, raised from 90 %).

The whole fleet is now measured for the first time. Everything below is a measurement or a refutation
of something this programme previously believed.

---

## 1 · THE FLEET IS FULLY SWEPT — 38.5 %, and the estimates it replaced were worthless

All eight JS DSPs, every one canary-guarded:

| file | tested | killed | equiv | distinguishable | rate |
|---|---:|---:|---:|---:|---:|
| `integrator-dsp.js` | 1748 | 806 | 0 | 1740 | **46.3 %** |
| `hrvdex-dsp.js` | 489 | 191 | 69 | 420 | 45.5 % |
| `ppgdex-dsp.js` | 1204 | 464 | 129 | 1060 | 43.8 % |
| `cpapdex-dsp.js` | 819 | 331 | 26 | 793 | 41.7 % |
| `motiondex-dsp.js` | 466 | 171 | 42 | 416 | 41.1 % |
| `glucodex-dsp.js` | 835 | 314 | 48 | 782 | 40.2 % |
| `oxydex-dsp.js` | 2680 | 899 | 0 | 2662 | 33.8 % |
| `ecgdex-dsp.js` | 1755 | 526 | 0 | 1733 | 30.4 % |
| **FLEET** | **9996** | **3702** | **314** | **9606** | **38.5 %** |

**The 60-mutant sample is one-sidedly optimistic in its upper range and must not be quoted.** Above a
sampled ~42 % it over-stated on 5 of 5 files, by +16.5 to +31.6 points; at or below 40 % it was
accurate (−6.0, −0.3, −0.4). See the parent brief's retraction: the stronger claims made from seven
files ("one population near 34 %", monotone error, r = −0.46) were **broken by the eighth** and are
withdrawn there.

---

## 2 · ✅ THE TARGET IS **99 % OF DISTINGUISHABLE** — owner-ratified 2026-08-11, RAISED from 90 %

The concern below was raised, heard, and the bar was **raised rather than lowered**. Recorded so the
scope is not mistaken for an accident:

> **at ANY kill/classify split, ~98.5 % of the outstanding survivors must be RESOLVED** — killed if
> killable, classified as equivalent if not. There is no ratio that avoids the work.
>
> ```
>  equivalents found   kills needed   survivors resolved
>       0 %               5497          5497 / 5590   98.3 %
>      30 %               3837          5514 / 5590   98.6 %
>      60 %               2177          5531 / 5590   98.9 %
> ```
>
> Classifying aggressively changes the KILL count enormously and the RESOLVED count barely at all.
> So the work is not "choose a strategy" — it is **every survivor, one at a time**.

`tools/mutation-worklist.mjs` is the queue, regenerated from the sweeps and the ledger on every run
rather than transcribed. **499 functions hold 5885 unresolved survivors.** The top 30 are 37 % of the
work; the remaining 469 are the other 63 %, so unlike a 55 % target there is no point at which the
tail can be skipped.

⚠️ **The list shows VERIFIED state, not claimed state.** It reads the last sweep, so kills from tests
written since do not appear until that file is re-swept. `parseJSONL` still lists 144 and
`computeSmartSummary` 162 although both now have tests killing 80 and 72. Re-sweeping is therefore not
optional bookkeeping at this target — it is how progress becomes real, and §6's 10–100× test-selection
work is what makes re-sweeping affordable enough to do after every batch.

### 2a · The original concern, retained



The target is *90 % of distinguishable mutants killed*. Measured against the real denominator:

- **5904 unclassified survivors** remain. 90 % needs **~4943 more kills**.
- Closing it by classification instead would require calling **5493 of those 5904 equivalent** — 93 %
  of every survivor in the fleet. Measured equivalence rates run **0 %** (glucodex's whole analyse
  pipeline: 0 of 166) to **66 %** (`detectClampSaturation`, 23 of 35). Classification alone tops out
  near **50–55 %**.
- **Even converting every one of the 492 functions at the best rate this programme has achieved
  (`parseJSONL`, 56 %) lands at 72.7 %, not 90 %.**

So 90 % is a large sustained test-writing programme — plausibly 300+ test groups — not a bookkeeping
exercise. **The decision the owner needs to make is whether 90 % is still the target**, and the honest
options are:

1. **Keep 90 %** and accept it as a multi-month programme with its own schedule.
2. **Re-target to ~55–60 %**, which the Pareto curve in §4 reaches in ~50–100 test groups.
3. **Per-file targets** — capture-host already exceeds 90 % on two modules (§3), so a uniform number
   across languages and file kinds may be the wrong shape of goal entirely.

This brief does not pick one. It records that the current number was set before anything was measured.

---

## 3 · THE PYTHON SIDE IS AT 74.6 %, AND IT IS THE MODEL

`capture-host`, 19 of 47 modules audited (2026-08-02, mutmut, 100 % statement+branch baseline):

```
8074 mutants · 5998 killed · 2039 survived · 74.6 %
nightarchive 94.2 %   polar_pmd 89.9 %   nightqc 81.0 %   host_clock 81.7 %
```

**Two Python modules already meet the 90 % goal.** Nothing in JS is close. Caveats: the audit covers
19 of 47 modules — `capture.py` (4772 lines, the largest file in the project) is **not** among them —
and it predates ~9 days of change.

---

## 4 · WHAT THE JS GAP IS *NOT*: coverage. It is ASSERTION STRENGTH

The obvious hypothesis was that JS kills less because it is under-covered — capture-host enforces
`--cov-fail-under=100`, JS had no coverage tooling at all. **c8 was added to test this and refuted
it** (#1163):

```
Python  100 % branch (enforced)  ->  74.6 % kill
JS       77.3 % branch           ->  38.5 % kill
```

A 23-point coverage gap cannot explain a 36-point kill gap. **The JS suite executes the code and does
not check the result.** Every finding in the parent brief is an instance: `applySessionCorrections`
offsets of `[1, 0, −1]` too small to separate an operand swap; `beatRegularity` never scoring below
1.0; cpapdex `selfTest` asserting `fail === 0` while its own assertion count silently dropped.

**Consequence: do not impose a coverage floor expecting the kill rate to move.** It will not. Two
files *are* genuinely under-executed and are the exception worth acting on:

| file | statements | functions |
|---|---:|---:|
| `hrvdex-dsp.js` | 74.2 % | **40.0 %** |
| `pulsedex-dsp.js` | 82.8 % | 59.7 % — and the fleet's lowest kill rate, 31.9 % |

⚠️ **c8 measured nothing at first and looked fine doing it.** `run-tests.mjs` loads every DSP through
`vm.runInContext(code, ctx, { filename: file })` with a RELATIVE path, and c8 keeps only files
resolving under the project root — so the first run reported **499 statements** (the harness) and
omitted every DSP it had just exercised. Absolute filename: **56 800**. Anyone adding coverage to a
`vm`-based harness will hit this.

---

## 5 · WHERE THE REMAINING WORK IS — and where it stops paying

492 functions hold the 5860 remaining gaps, distributed steeply:

| decile | functions | gaps | per function |
|---|---:|---:|---:|
| 1st | 49 | 2836 | **57.9** |
| 2nd | 49 | 926 | 18.9 |
| 5th | 50 | 339 | 6.8 |
| 10th | 50 | 50 | **1.0** |

The first 49 functions are worth **58× more per unit of work** than the last 49. Projected at
`parseJSONL`'s 56 % conversion:

```
top  10 functions -> 45.6 %      top  50 -> 55.2 %      top 200 -> 66.7 %
top  30 functions -> 51.6 %      top 100 -> 60.6 %      all 492 -> 72.7 %
```

**Diminishing returns bite after ~50 functions.** There is a second axis: within a function, 2–3
passes and it saturates (`parseJSONL` 61 → 46 → 80; `applySessionCorrections` 5 → 6 → 7 of 8).

⚠️ **THIS SECTION'S ADVICE IS SUPERSEDED BY §2, and the difference matters.** It was written for a
55–60 % target, where the tail is skippable and "stop after 50" is the right call. **At 99 % it is
not** — the top 30 are 37 % of the work and the other 469 functions are the remaining 63 %. There is
no point at which the tail can be abandoned.

What survives is the ORDERING, not the stopping rule: work the list in rank order because the early
functions are 58× denser, so the fleet number moves fastest at the start and morale-per-hour is
highest there. But the projection above (72.7 % if every function converts at 56 %) says the plain
approach does not reach 99 % — so §6's re-sweep economics stop being an optimisation and become a
prerequisite, and the tail functions will need the cheaper per-function loop that only fast
re-sweeping makes possible.

---

## 6 · THE ONE OPTIMISATION WORTH BUILDING BEFORE MORE TESTS

Sweeps re-run the **entire** test group per mutant. `integrator` is 310 s × 1748 = **13.8 h**. But a
mutant on line N can only be killed by a test that EXECUTES line N — so with per-test coverage data
you run 5 tests instead of 300. This is the standard mutation-testing optimisation and **c8 is the
prerequisite, now in place**.

Estimated 10–100×: the 13.8 h integrator sweep becomes 15–30 minutes. That changes the programme from
"one file overnight" to "the whole fleet in an afternoon", which is what makes re-sweeping after every
batch of tests practical — and re-sweeping is how any target above ~50 % gets verified at all.

**GPU does not help and is not close.** This is branchy interpreted JS across thousands of short-lived
processes — task-parallel with heavy control flow, not data-parallel float throughput. The bottleneck
is V8 startup and branching. More cores scale near-linearly; that is the only hardware lever.

---

## 7 · THE LESSON THIS PROGRAMME KEEPS RE-LEARNING

**When a battery or a test measures nothing, the cause is a missing SHAPE, not insufficient breadth.**
Seven instances, each found by measurement and each initially misdiagnosed as "widen the battery":

| case | what was actually wrong |
|---|---|
| `parseCSV` | stamps were dash-separated; **0 of 300 rows parsed**, 14 inputs → 4 answers |
| `genSynthetic` (ecgdex) | artifact spans sit at **t = 88 min**; every fixture was shorter |
| `beatRegularity` | each beat takes the **min** of two deviations — a lone irregular interval scores 1.0 |
| `applySessionCorrections` | offsets `[1, 0, −1]` too small; needed 90/110/130 to give `[+20, 0, −20]` |
| `validateHR` (ecgdex) | `ecgHrSeries` is a **numeric array indexed by second**, not `{tMs, hr}` objects |
| `computeSmartSummary` | returns `{ranked, top5, …}`, not an array; and `sleepEff` is in a dead `else if` |
| `parseJSONL` | **both arms**: populating every optional block killed FEWER (46) than stats-only (61) |

That last one is the sharpest: **more realistic data made the test worse.** Optional blocks are
`obj.X ? {…} : null`, so present and absent are different paths and a fixture is only ever on one.
Testing both: **80**.

**The diagnostic is printed on every probe run and should be read first** — `battery N inputs, M
distinct answers`. M a small fraction of N means the inputs are being rejected at a guard, not that
they are insufficiently varied.

---

## 8 · SMALLER ITEMS

- **`functionRange` cannot resolve arrow consts.** `const rmssd = (a) => {}` is invisible to it, so
  those families claim nothing. Surfaced by `probe-coverage`'s unresolved-`fn` warning; costs coverage
  in every battery. One regex.
- **oxydex and integrator have no battery at all** — 1763 and 934 survivors, 0 % claimable.
- **`capture.py` is unaudited** — the largest file in the project.
- **cpapdex `selfTest` holds 122 survivors** (a quarter of that file) in *test scaffolding*. Whether
  mutants in a self-test belong in the denominator at all is a question this brief raises and does not
  answer.

## 9 · FINDINGS FROM EXECUTING §5 ON hrvdex `computeDerived` (2026-08-12)

`computeDerived` went **149 → 93 surviving, 56 killed (38 %)** across #1180 / #1181 / #1182. The
survivors fell into three shapes, and each needed a *different* kind of input rather than more of the
same — that sequence is the reusable part.

| shape | why the previous fixture could not reach it | what reached it |
|---|---|---|
| single-operand guards `a && b` | a row where everything is present takes the same branch under `&&` and `\|\|` | each seed zeroed IN TURN (falsy **and** on the `> 0` boundary) |
| dead fallback arms | `typeof DexUnits !== 'undefined'` is permanently true — the `else` arms never execute | `env.withGlobalRemoved('DexUnits', fn)` |
| branches selected by held-constant state | every row stamped 03:00; every `_vlf` a number | varying hour, `_spanMin` across the all-night threshold, `null` vs `0`, PAIRS zeroed, an ORDERING operand (`_vlf > _totalPow`) |

### 9.1 ⚠️ `instanceof` IS REALM-SCOPED — a fleet-wide harness trap

`hrvdex-dsp.js:718` reads `r._date instanceof Date ? r._date.getUTCHours() : 8`. The DSPs run in a vm
context created from a bare `{}`, so it carries **its own intrinsics**: a host-constructed
`new Date(ms)` is not `instanceof` that realm's `Date`, the guard is false, and the code takes the
`: 8` default. Three fixtures stamped 08:00 / 12:00 / 18:00 all took the **morning** arm and produced
identical numbers. Nothing threw and nothing warned.

`env.realmDate(ms)` now exists in both runners. In Node it must be evaluated INSIDE the context
(`vm.runInContext('(ms) => new Date(ms)', ctx)`); `ctx.Date` is not an own property of a contextified
sandbox and reading it yields `undefined is not a constructor`.

**Blast radius: five sites, all hrvdex `_date`** — `-dsp:718` (fixed), `-app:408` and `-app:437`,
`-render:1345` and `-render:1490`. Any future fixture handing a `Date` to any of them has the same
hole.

### 9.2 The CSV and JSONL export DATE field is untested — `grep -c '_date:' tests/dex-tests.js` = 0

No test anywhere sets `_date`, so `exportCSV`'s `Date` column and `exportJSONL`'s `date` field have
only ever been exercised on the else-branch: `''` and `null`. This is a user-visible export surface
with zero coverage, and it is not the realm bug — it is simply absent.

Not attempted here because both exporters take **no arguments**: they read module-level `rows` and
drive a download, so covering them needs state injection or a DOM harness rather than a fixture. That
is the work-unit, and it is worth doing — an export field that has never been produced is exactly the
class of gap §7's payload work keeps surfacing.

### 9.3 A discrimination check earns its place every time

Each of the three groups opens with an assertion that the *manipulation changed the answer*. It fired
three times in one session: the fully-populated row was itself producing NaNs (twice — a row count
was the obvious fix and the wrong one; the VO₂ window is DATE-KEYED); removing `DexUnits` had to be
shown to move `d_si` before the fallback values meant anything; and the circadian hours were identical
twice over, first because `circAdj` feeds `d_rmssd_circ` rather than the column asserted on, then
because of §9.1. Without it, all three groups would have passed while comparing something to itself.

### 9.4 What is left, and why it is not more of the same

93 survivors remain, concentrated on **profile-dependent thresholds** —
`p_prof.hrmax_manual > 0 && >= 140 && > _hrRestR + 45`, `p_prof.elev <= 1500`. Those need
`setHooks({ getProfile })`, and **`setHooks` has no getter, so there is no way to restore the previous
hook**. No test in the repo uses it today. Either the DSP grows a way to read the current hooks, or a
group accepts that it must reinstate a *known* profile rather than the *previous* one — a decision
worth making deliberately rather than discovering halfway through.

## Done when

- [ ] The owner has ratified, adjusted, or per-file'd the 90 % target against §2.
- [ ] Coverage-guided test selection (§6) exists, or is explicitly declined with a reason.
- [ ] The top 30 functions from §5 have tests, each with a measured before → after kill count.
- [ ] `functionRange` resolves arrow consts, or the limitation is recorded in the tool's header.
- [ ] §9.2 — the export `date` field has a test, or the reason it cannot is recorded.
- [ ] §9.4 — `setHooks` restoration is resolved before profile-gated branches are attempted.
