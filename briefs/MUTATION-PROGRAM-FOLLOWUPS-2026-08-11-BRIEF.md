<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-08-11 · **Created:** 2026-08-11 · **DRAIN 2026-09-02 (Osprey):** verified 3 ticked / **11 open** Done-when boxes — the largest open surface in the family and correctly still PROPOSED. **Owner: Osprey. Next step:** triage the 11 into keep/drop before any execution; a follow-ups brief this wide is a backlog, not a work-unit.

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

> ⚠️ **SUPERSEDED IN PART — see §6-bis (2026-08-31). The naive form described below was BUILT, hit the
> estimate, and is QUARANTINED as unsound. Do not build it again. What remains unbuilt is a
> *different* design, named in §6-bis.**

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

## 6-bis · WHAT ACTUALLY HAPPENED TO §6 — built, measured, quarantined (recorded 2026-08-31)

§6 reads as a pending build. It is not, and leaving it that way is a live trap: a reader following it
today re-implements a thing that exists and was **rejected for fabricating SURVIVED findings** — the
worst failure this programme has, wearing the shape of a 78× speedup.

**It was built.** `tools/per-group-coverage.mjs` builds the map; `pgmapFor()` in `tools/mutate.mjs`
applies it; the flag is `--use-coverage-map`.

**§6's estimate was right.** Measured 2026-08-14 on the real map — median groups per mutant:

| module | groups | speedup |
|---|---|---|
| `integrator-dsp` | 6 | **78×** |
| `hrvdex` | 9 | **52×** |
| `ppgdex` | 30 | **16×** |

§6 estimated 10–100×; the estimate holds. **The speedup was never the problem.**

**It is quarantined because per-line selection is UNSOUND.** Paired sweeps on hrvdex: **7 of 38
tag-kills became survivors under selection.** Re-confirmed 2026-08-19 against the interval-coverage
collector — *better collection did not make it sound*, which is the result that matters, because the
obvious response to a bad map is a better map. Three mechanisms, each proven separately:

1. **State built by earlier groups** — lines 801, 869 are absent from the killing group's SOLO
   interval and present when the tag set runs together.
2. **LOAD-executed lines** — 158/174/487/537/1319 are in no group interval *by design* (the baseline
   discard), yet their mutants change load state and die under tag.
3. **Integrity/audit interactions** — fixed separately via `tests/expected-skips.json`, and the
   fabricated 22/22 "kills" they produced are why every number here was re-measured.

**A selection that narrows too far does not run slowly — it reports SURVIVED for mutants that die.**
`mutate.mjs`'s own guard says it plainly: *"not a slow gate, it is a sweep that fabricates findings,
and it would look like a spectacular speedup while doing it."* Hence every failure path returns `null`
and falls back to the tag filter: no map, unreadable map, file absent, line attributable to nothing.
Selecting too many groups costs time; selecting none costs the measurement.

**So what IS still worth building — and this is the part §6's title gets right, about the wrong thing:**

> **UNION-WITH-TAG** — a superset of the tag set can never lose a tag kill — **plus the vetted zeros.**

That design is specified in `pgmapFor`'s comment and is **not yet built**. Until it is, the map stays a
**diagnostic, not a filter**, and selection stays opt-in behind `--use-coverage-map`.

⚠️ **A map keyed on LINE NUMBERS goes stale for reasons as small as a comment.** #1422 inserted 16
comment lines into `oxydex-dsp.js` and shifted everything below line 1023; applied after that, a
present, well-formed, stale map produces the same fabricated SURVIVED as an empty one, and quietly.
Identity verification is why `pgmapFor` re-checks per file rather than per run.

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

- ~~**`functionRange` cannot resolve arrow consts.**~~ ✅ FIXED 2026-08-19 — all THREE copies
  (probe-equivalence · killcheck · mutation-worklist's scanner) now resolve `const NAME = (…) =>`
  (async and single-param-no-parens included) and `const NAME = function`, and a CONCISE arrow
  (`=> expr`) is its own single-line range rather than a fake file-long one. probe-equivalence's
  copy also inherited killcheck's full metacharacter escaping (it still escaped `$` alone).
  11 new selftests across the three; planted removal of the arrow alternative reds each copy's own
  tests (verified as assertion failures, not crashes). Known accepted miss, documented in code:
  a MULTI-line concise body under-claims to one line rather than over-claiming.
- **oxydex and integrator have no battery at all** — 1763 and 934 survivors, 0 % claimable.
- **`capture.py` is NOT auditable at current cost — measured 2026-08-31, see §8-bis.** ~~is unaudited~~
  The bullet used to read "is unaudited", which invites the reader to go audit it. It was attempted;
  the cost is the finding.
- **cpapdex `selfTest` holds 122 survivors** (a quarter of that file) in *test scaffolding*. Whether
  mutants in a self-test belong in the denominator at all is a question this brief raises and does not
  answer.

## 8-bis · `capture.py` WAS ATTEMPTED — the cost is the finding (2026-08-31)

§8 listed `capture.py` as "unaudited", which reads as *nobody has got to it yet*. It has been got to.
A full day went into it, and the outcome is a number rather than a survivor list.

**Two blockers, in two environments, and conflating them cost most of that day.**

**CI's blocker was the gate being unable to SEE the module**, and it is fixed. Seven PRs:

| PR | what it fixed |
|---|---|
| #1982 | two holes in `mutation-source-scan` — module-object `getsource`, and a per-FILE `SANCTIONED` exemption that blanket-cleared the largest test file |
| #1985 | no per-mutant timeout was configured; mutmut's own `timeout_multiplier` left at 15 |
| #1992 | the baseline ran a DIFFERENT selection than the mutants — `deselect_args()` was wired to the mutmut config and not to `clean_run_seconds` |
| #1995 | a refusal named no test; the report was captured and discarded |
| #1997 | the refusal printed an assertion's first line and dropped its body |
| #1998 | **the root cause** — `_all_scripts()` walked mutmut's generated `mutants/`, seeing 48 scripts where the tree has 24 |
| #2000 | the mutation job never installed `shellcheck-py`, so the scratch resolved the runner's older `/usr/bin/shellcheck` |

**Local's blocker was never the clean run**, and that is the distinction the brief should carry:
shellcheck is absent locally, so that test SKIPS and the baseline passes. What remains is pure **stats
phase cost**:

> **6 h 54 m elapsed, still in `Running stats`, output frozen at 48,409 bytes — byte-identical across
> FOUR independent runs**, including ones stopped at 3 h. Generation alone measures 1,933,726 ms
> (32.2 min) for the single file.

CI, with the gate finally able to see, then hit caps and cancellations at 4–11 h without producing a
survivor list either.

**So: the gate can now SEE `capture.py`, and neither environment can AFFORD to measure it exhaustively.**
Those are different sentences and only the first was ever in doubt.

⚠️ **The corollary that matters more than the cost.** #1954 and #1959 both merged with
`mutation (diff-scoped)` RED, and that red was **`REFUSING — could not measure`**, never *survivors
exist*. No survivor list for `capture.py` has ever existed. Any note recording those PRs as leaving
unkilled mutants is wrong: they left an **unmeasured gate**, and there may be no work there at all.

**What would change this** is the stats cost, not more fixes — the same problem §6-bis's **UNION-WITH-TAG**
addresses on the JS side, which has no Python analogue built. Standing decision: measurement runs
**locally and offline**, never as a public CI PR; the cost above is why.

---

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

## 10 · FOUR CLUSTERS KILLED, AND THE THREE THINGS THAT ONLY THE RE-APPLY STEP FOUND (2026-08-12)

99 mutants killed across four PRs — #1190 CPAPDex `selfTest` conjunctions (32), #1192 Clock §2.7
boundaries in all four node-local parsers (34), #1193 `computeVO2maxEstimate` (17), #1194
`computeKarvonenZones` (16). Every count is a *measured* before → after, per §5's requirement.

### 10.1 · One defect shape, three disguises

All four clusters are the same bug: **an assertion that passes for a weaker reason than it claims.**

| shape | the mutant that proves it | why the old assertion could not see it |
|---|---|---|
| `ok('…', A && B)` | `&&` → `\|\|` | passes on `A` alone; `B` was never checked |
| far-out-of-range clock inputs | `mi > 59` → `mi >= 59` | minute 99 is still rejected — only minute **59** can see the bound move |
| pseudo-tested function | any mutant at all | the suite runs it and reads nothing it returns |

§7 says this programme keeps re-learning that a gate must be *seen to fail*. These are three more
instances, and two of them had a **comment in the source already describing the hazard** — the
`selfTest` cluster and the §2.7 guard both did. Documenting a hazard is not measuring it.

### 10.2 · THE FIXTURE IS THE USUAL CULPRIT, NOT THE CODE

In three of the four clusters the re-apply step found survivors, and **every one was a weakness in
the new test's fixture** rather than a missing assertion:

- **Constant inputs cannot test an order statistic.** Every VO₂max fixture held HR constant, so
  neither "which percentile" (`0.05` → `0.5`) nor "were the >120 samples filtered" could change any
  output. A spread night — 100 @50, 1700 @80, 400 @130 — kills both.
- **A bound masked by a later guard is not pinned.** `n < 3600` survived an empty rows array
  because a `length < 60` guard below refuses it anyway. Pin a bound with an input that *only* that
  bound refuses.
- **A guard tested only where its operands agree is not pinned.** `vo2est && vo2est.hrRest` → `||`
  survived because the fixture always carried an `hrRest`. With `{}` the mutant takes `undefined`,
  every zone becomes `NaN`, **and the function still returns a well-shaped object** — the worst
  available failure. Only the shape where the two operators disagree can catch it.
- **Rounding is invisible at the wrong point.** `Math.round` → `Math.floor` survived until an edge
  landing on `.6` was asserted; every other edge fell on `.0/.2/.4`, where the two agree.

**Practical rule for §5 work: after writing the test, re-apply the mutant. If it does not go red,
the fixture is too kind.** Three of four here would otherwise have shipped as "comprehensively
tested" on green output.

### 10.3 · A SCOPED KILL RATE IS AN UPPER BOUND — some recorded survivors are artifacts

`h < 0` → `h < 0 && h > 23` in glucodex reads as a **survivor** in the per-file sweep and is **RED**
under `--group=node-local-clock`. It was never offered to the group that kills it. This is the same
scoping caveat §5 records for coverage, and it applies to **kill verdicts** too: an unknown fraction
of the fleet's recorded survivors are tests-not-run rather than tests-not-written. Before writing a
test for a survivor, check it against the contract-named groups, not just the file-named one.

### 10.4 · FOUR MUTANTS PROVEN EQUIVALENT — recorded so they stop being counted

Documented in place, each with its proof, and each with an explicit *do not add an assertion for
this*:

- `cpapdex-edf.js` `mo < 1`, `dd < 1` — subsumed by the date round-trip three lines below.
  `mo = 0` builds `Date.UTC(y, -1, dd)` (the previous December) and fails the year check; `dd = 0`
  builds the last day of the previous month. Both fields are 2-digit, so a negative value cannot be
  constructed at all.
- `oxydex-dsp.js` `hrRest < 30` — unreachable: the still-HR filter is `hr > 30 && hr < 120`, so no
  sample below 31 ever reaches the percentile.

These belong in the *equivalent* bucket of §2's `tested − invalid − equivalent` denominator.

### 10.5 · TOOLING: an unscoped `String.replace` measures the WRONG function, confidently

A verification harness written for §10 reported 13/17 kills. All four "survivors" were **its own
bug**: `if (n < 1800) return null` occurs three times in `oxydex-dsp.js`, and `String.replace` with a
string argument replaces only the FIRST — so it mutated `computeRMSSDarc` and reported the result
under the name of a function it had never touched. Scoped to the function body by brace-matching,
the same run gives 17/17.

This is the third instance of this exact class in the programme (`killcheck.mjs`'s unescaped regex,
two clobbered test groups). **Any tool that locates code by string or regex must scope to the
function it names and fail loudly when the pattern is absent or ambiguous** — a `hits > 1` count is
worth printing.

### 10.6 · A CONTRACT ASYMMETRY THE TESTS SURFACED

`computeVO2maxEstimate` gates hrRest at `> 100`; `computeKarvonenZones` gates the **same value** at
`> 80`. Defensible — a training zone off a resting HR above 80 would be nonsense — but undocumented
until now. Both bounds are pinned independently rather than assumed to match.

### 10.7 · MEASUREMENT HYGIENE: never hand-mutate source while a sweep is running

`extreme-mutate` and `killcheck` build their workers with `cp -al` **hard links**, so a worker's
files share inodes with the checkout. Editing a source file in place during a sweep is therefore
visible to every in-flight worker, and can flip verdicts in a run that reports no error. One fleet
Descartes run was discarded for this. **Serialize manual mutation against sweeps, or run them from
different checkouts.**

## 11 · THE DESCARTES FLEET, MEASURED — 543 functions, 24 pseudo-tested (2026-08-12)

Extreme mutation (one mutant per function; **pseudo-tested** = COVERED and yet every applicable
mutant survives, i.e. the suite runs it and reads nothing it returns) across all eight DSPs, each
under its own `--group=<file>-dsp`:

| file | functions | pseudo-tested | partial | not-reached | tested | pseudo % of reached |
|---|---|---|---|---|---|---|
| oxydex | 143 | **5** | 6 | 8 | 124 | 3.7 % |
| ecgdex | 70 | **4** | 1 | 4 | 61 | 6.1 % |
| ppgdex | 88 | **3** | 1 | 16 | 68 | 4.2 % |
| hrvdex | 37 | **1** | 0 | 20 | 16 | 5.9 % |
| pulsedex | 50 | **2** | 1 | 18 | 29 | 6.3 % |
| glucodex | 61 | **4** | 0 | 4 | 53 | 7.0 % |
| cpapdex | 51 | **5** | 0 | 1 | 45 | 10.0 % |
| motiondex | 43 | **0** | 1 | 2 | 40 | 0.0 % |
| **FLEET** | **543** | **24** | **10** | **73** | **436** | **5.1 %** |

The 24, in full — this is the §5 work-list for assertion strength, ordered by file:

`oxydex` setHooks · _flagSev · fmtTimeFull · oxyPBConf · oxyBuildEpochSeries ·
`ecgdex` triangularIndex · fragmentation · surgeEscalation · accAnalyze ·
`ppgdex` pad2 · fmtClockSec · sqiAt · `hrvdex` _hrvClockS · `pulsedex` cohEst · _pdForeignUnitCol ·
`glucodex` _ckZoneMin · postprandial · agp · carbCategory ·
`cpapdex` _p2 · fmtClock · fmtDate · fmtDateTime · _leakCV

Three things this table is **not**:

- **`not-reached` is not dead code.** 73 functions read zero executions under their file-named
  group, and §10.3's caveat applies at full force: another group may reach them under a contract
  name, and the browser render lane is invisible to c8 entirely. It is an upper bound on what is
  unguarded, nothing more.
- **A low pseudo-tested count is not a strong suite.** It says every function has *at least one*
  assertion that notices *something*. `computeDerived` was never pseudo-tested and still carried 95
  survivors.
- **The percentages are not comparable across files** — see §11.1.

### 11.1 · 15.4 % OF THE SURVIVOR POPULATION IS NOT PRODUCTION CODE

Attributing every survivor in the five banked sweeps to its enclosing function:

| file | survivors | inside test-support | largest survivor function |
|---|---|---|---|
| cpapdex | 472 | **201 (43 %)** | `selfTest` 125, `_synthEdfSet` 57 |
| glucodex | 503 | 65 (13 %) | `genSynthetic` 65, `clean` 62 |
| motiondex | 258 | 21 (8 %) | `respiratoryEffort` 31, `genSyntheticACC` 21 |
| hrvdex | 244 | 0 | `computeDerived` 95 |
| pulsedex | 391 | 0 | `parseRRInput` 43 |
| **total** | **1868** | **287 (15.4 %)** | |

"Test-support" = `selfTest`, its `ok`/`near` helpers, and the synthetic fixture builders.

**This is not an argument to exclude them.** The `near()` precedent in `cpapdex-dsp.js` is decisive
the other way: a comparator that has quietly become more permissive weakens all 70-odd assertions
running through it, and mutation is the only thing that finds it. #1190 killed 32 such mutants and
they were real.

It **is** an argument that a single fleet percentage blends two different quantities. cpapdex's
kill rate is computed over a population that is 43 % checking-apparatus; hrvdex's over one that is
0 %. Those two numbers are not measuring the same thing, and §1's fleet figure inherits the blend.
**Report production and checking-apparatus rates separately, or report the split beside the total.**

## 12 · SIX MORE CLUSTERS, TWO REAL DEFECTS, AND WHEN *NOT* TO RE-RECORD (2026-08-13)

Continuing §10's programme: ~194 mutants killed across 17 PRs. §9.4 is resolved (owner chose
`getHooks()`, #1206) and that unblocked the profile-gated `computeDerived` branches, which were the
largest single survivor cluster in the fleet.

### 12.1 · THE BLIND-FIXTURE TAXONOMY, three shapes longer

§10.2 listed six. Three more, each measured:

- **A SELF-SIMILAR series cannot test a lag.** `ac_pairs.push([x[j], x[j+1]])` mutated to
  `[x[j], x[j]]` survives a rising ramp, because correlating a ramp with the *next* day gives 1 and
  correlating it with *itself* also gives 1. An alternating series makes `y = 60 − x`, so the honest
  answer is −1 while self-pairing still says +1.
- **A ONE-ELEMENT result cannot test a scale factor.** `tMin: k * 5 → k * 1` survives whenever the
  only surviving epoch is `k = 0`.
- **A clamp whose FLOOR coincides with its TRIGGER is untestable from below** — and that is
  equivalence, not a gap. `stress_high` fires at stress ≥ 70 and its ramp is `(stress−50)/50`,
  which is exactly 0.4 at 70, so `Math.max(0.4, …)` never binds. Its `hrv_low` sibling *is*
  load-bearing (rMSSD 19 ⇒ 0.05) and is pinned. Check the sibling before recording either.

### 12.2 · `undefined` IS A THIRD STATE, AND IT HID A REAL DEFECT

`computeDerived(rowsArg)` honoured its argument in only ONE of its three passes; the day-to-day and
rolling-window passes iterated the module's `allRows`. Its own header promised the opposite
("EVERY d_* column", "a PURE headless surface"). So `HRVDex.derive(rows)` returned **ten** columns
as `undefined` — not NaN — and in the app it computed those windows over APP STATE and wrote them
onto rows the caller never passed. Fixed in #1211 (owner's call); the no-argument path is unchanged
by construction.

**The generalisable part:** this file's whole discipline is *absent must be visibly absent*, and
`undefined` slips through it. It is not `NaN`, so a non-finite enumeration skips it; it renders
blank; `x != null` is FALSE for it and TRUE for NaN. **A column that is never assigned is invisible
to exactly the gates written to catch fabricated values.** Grep for assignment coverage, not just
value correctness.

### 12.3 · VERIFY THE BLAST RADIUS BEFORE RE-RECORDING A CHARACTERISATION

The fix moved 57 assertions in a group that is explicitly a characterisation. Re-recording it is the
sanctioned workflow — and is also exactly how a real regression gets laundered into a golden. So the
literals were not touched until this had been checked mechanically:

> for all 35 column-set expectations, the new set is the old set plus a subset of the ten window
> columns, and NO per-row column changed.

**Do that check first, every time a fix moves a golden.** It is ten lines of script and it is the
difference between "the expectations followed the fix" and "the expectations absorbed a bug".

Two mechanical notes that cost time: a bare string replace over `tests/dex-tests.js` hits SEVERAL
arrays at once (9 of 39 literals silently skipped), so patch by unique text or scope to one array by
line range; and an earlier draft *excluded* the newly-visible columns from the enumeration, which
would have discarded power the fix had just bought — four of them discriminate on the zeroed seed.

### 12.4 · "NO CHECKS REPORTED" IS NOT A CI FAILURE

A PR whose `mergeStateStatus` is `DIRTY` runs **no** `pull_request` workflows, so `gh pr checks`
reports "no checks reported on the branch" and the PR reads as broken. It is conflicted, not failing,
and the responses are opposite — rebase versus debug. Check `mergeStateStatus` before reading a
check list as a verdict. (Related: the `land-pr` tool already distinguishes these; a human reading
the PR page does not. `land-pr` can still exit on its own network error — a TLS handshake timeout
killed one run here — which is a different thing again from either.)

### 12.5 · THE COMPARATOR COULD NOT SEE THE DIFFERENCE IT WAS ASKED ABOUT

`T.eq` compared `JSON.stringify(got) === JSON.stringify(want)`, and JSON maps `NaN`, `+Infinity` and
`−Infinity` **all** to `"null"` — at every depth, so a `{offsetMin: null}` expectation accepted a NaN
offset and `[null, 1]` accepted `[NaN, 1]`. Measured across the suite: **263** top-level
`eq(x, null)` assertions, plus 8 null fields and 6 null array slots.

**248 of those 263 are in the clock group** — whose §2.6 rule *is* "a missing stamp must be visible
(null), never fabricated". The rule was asserted almost entirely through the one comparator that
could not tell a null from a fabricated NaN. And the sharpest instance in the repo asserted
NaN-refusal *through* the collapse:

```js
T.eq('…NaN is refused', C.parseTimestamp('23:45', { dateAnchorMs: NaN }), null)
```

Had `parseTimestamp` returned the NaN straight through instead of refusing it, that test passed.

Two process points, both earned:

- **The first fix was shallow** — it tagged only the top-level value, leaving every field and array
  position blind, and the blast-radius claim ("reds zero") was therefore true of the 275 and
  *untested* for the rest. Caught in review by the vigil-box session. When hardening a comparator,
  the depth at which the collapse happens is the whole question.
- **`eq` cannot assert its own failure** — a failing assertion reds the suite — so its guard group
  pins the RULE (all four values pairwise distinct, at four depths) and includes an anti-vacuity
  assertion that a bare `JSON.stringify` *does* still collapse them. The implementation is proven
  separately, by a measured mutant kill.

### 12.6 · A UNANIMOUS-AGREEMENT RULE CANNOT DETECT A COMMON-MODE ERROR

Contributed by the vigil-box session from the PpgDex `orient()` defect (#1200), and recorded here so
nobody spends a cycle writing a test that cannot exist:

> PpgDex's consensus-polarity pass compares the three LED channels and acts only on a DISSENTER,
> returning 0 when they are unanimous — deliberately, so it stays export-inert. Optical polarity is a
> property of the DEVICE, so when `orient()` chose wrongly it chose wrongly for all three channels at
> once. Unanimously-wrong and unanimously-right are the same input to that rule, so no test written
> against the consensus pass can distinguish them, at any threshold, on any corpus.
>
> Do not chase: a test asserting that consensus detects an inverted pulse cannot exist while the rule
> is defined over inter-channel disagreement. The defect was common-mode, so EVERY inter-channel
> agreement metric was blind to it — which is why it survived from the detector's introduction to
> 2026-08-13 across 20 real nights, 10 of them wrong.
>
> What did detect it: an argument from outside the channel-agreement frame entirely — systole is
> faster than diastole in every cardiac waveform, so the correct polarity is the one whose median
> foot→peak rise is a smaller fraction of the beat interval. No moment, no threshold, no amplitude
> term, and no reference to the other channels. The general form: when a check is defined over
> agreement between replicas, it is blind by construction to anything that moves the replicas
> together, and the escape is a constraint from the physics rather than a better statistic over the
> replicas.

This is the strongest equivalence class in the ledger, because it is not about one operator: it says
an entire *family* of tests is void for an entire *family* of defects. Worth checking against any
consensus, quorum or cross-channel-agreement rule in the fleet before writing tests for it.

⚠️ It also bears on §11.1's numbers: a mutant inside a consensus rule that only ever fires on a
dissenter may be equivalent for a corpus in which the replicas agree, and *killable* on one where
they do not. Corpus-dependence is a third bucket beside "equivalent" and "a real gap".

**THE FLEET AUDIT, run 2026-08-13.** Every consensus / quorum / cross-channel-agreement rule
outside PpgDex, checked against the rule above:

| rule | verdict |
|---|---|
| `integrator-tch.js` — the three-cornered hat itself | **already documented, thoroughly.** Its header states TCH "cancels common-mode by construction → false confidence", that it measures precision and not trueness, and that positive common-mode noise cannot be detected reference-free without an externally supplied `rho`. Nothing to add. |
| `integrator-dsp.js` `fuseStagingConsensus` | **weaker exposure.** It reports an inter-node REM gap, but the legs are NOT replicas — they use different `stagingMethod`s — and it already fails closed (`disagreement: null`) when the `remFractionBasis` differs. A shared staging error is conceivable but the legs are heterogeneous by construction. |
| `analysis-stats.js` `_consensusTrust` (and its `sensor-trio-worker.js` twin) | **THE SIGN-FLIPPED CASE, undocumented — see below.** |

`_consensusTrust(hh, vv, oo, C)` weights each epoch by the RANGE across the three devices —
`max − min` — giving full weight when the range is at or below the median and tapering to zero as
it grows. It then feeds `tchSigmasFused`.

A range is a DIFFERENCE, so a bias shared by all three cancels out of it exactly: the weighting is
blind to common-mode by construction, the same way the estimator downstream is. But it is worse
than blind in one sub-case. Where the shared error also COMPRESSES the spread — three devices
clipping, saturating or railing to the same value — the range goes to ~0 and the epoch receives the
MAXIMUM weight. So the epochs most contaminated by common-mode error are the ones the trust
function selects hardest, and they are then fed to an estimator that cancels common-mode by
construction.

This is not proposed as a code change: it is a methodological caveat on an analysis tool, and the
right treatment is the one `integrator-tch.js` already models — say it in the header where a
consumer reading the number will see it. Recorded here rather than acted on because the analysis
lane is not this brief's subject and the statistic itself is not wrong, only narrower than it looks.

## Done when

- [ ] The owner has ratified, adjusted, or per-file'd the 90 % target against §2.
- [ ] Coverage-guided test selection (§6) exists, or is explicitly declined with a reason.
- [ ] The top 30 functions from §5 have tests, each with a measured before → after kill count.
- [ ] `functionRange` resolves arrow consts, or the limitation is recorded in the tool's header.
- [ ] §9.2 — the export `date` field has a test, or the reason it cannot is recorded.
- [ ] §9.4 — `setHooks` restoration is resolved before profile-gated branches are attempted.
- [ ] §10.3 — the fleet's survivor lists are re-checked against contract-named groups, so the
      scope-artifact fraction is known rather than assumed.
- [ ] §10.5 — every string/regex-locating tool in `tools/` scopes to the named function and fails
      loudly on an absent or ambiguous pattern.
- [ ] §11 — the 24 pseudo-tested functions have tests, each with a measured before → after
      (the method is proven: oxydex went 7 → 5 and the diff named exactly the two that were fixed).
- [ ] §11.1 — the fleet kill rate is reported with its production / checking-apparatus split, or
      the decision to keep one blended number is recorded with a reason.
- [x] §9.4 — RESOLVED 2026-08-13: `getHooks()` on HRVDex and OxyDex (#1206), which unblocked the
      profile-gated `computeDerived` branches (#1208, #1209).
- [x] §12.2 — DONE 2026-08-13: every `*-dsp.js` / `*-cross.js` / `*-edf.js` scanned for the shape
      (a function aliasing `arg || moduleArray` that still reads the module array in its body).
      HRVDex was the only site; fixed in #1211, and it now assigns 62 of 62 columns where it did 52.
- [x] §12.6 — DONE 2026-08-13: the fleet's other consensus / quorum / agreement rules audited. TCH
      already documents its own common-mode blindness; `fuseStagingConsensus` is weakly exposed
      (heterogeneous legs, fails closed on basis mismatch); `_consensusTrust` is the undocumented
      sign-flipped case and is written up in §12.6.
- [ ] §12.6 follow-up — `analysis-stats.js` `_consensusTrust` gains a header caveat in the shape
      `integrator-tch.js` already uses, or the decision not to is recorded with a reason.
