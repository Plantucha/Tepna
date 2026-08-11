<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-08-11 · **Created:** 2026-08-11

# MUTATION PROGRAM — FOLLOW-UPS

Executes-from: `MUTATION-PROGRAM-2026-08-09-BRIEF.md`. That brief set the target and the method; this
one records what executing it **discovered**, and the two things that need an owner decision rather
than more work.

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

## 2 · 🔴 THE 90 % TARGET NEEDS RE-RATIFYING — it is not reachable on this trajectory

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

**Recommendation: do the top 30–50, then re-evaluate** — past 100 you pay full price for single-digit
gains.

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

## Done when

- [ ] The owner has ratified, adjusted, or per-file'd the 90 % target against §2.
- [ ] Coverage-guided test selection (§6) exists, or is explicitly declined with a reason.
- [ ] The top 30 functions from §5 have tests, each with a measured before → after kill count.
- [ ] `functionRange` resolves arrow consts, or the limitation is recorded in the tool's header.
