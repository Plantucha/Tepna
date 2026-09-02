<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS · **Created:** 2026-08-14 · **DRAIN 2026-09-02 (Osprey):** verified **9 of 10** Done-when boxes ticked — the closest brief in this family to DONE. The single remainder is section 1c's uncorrected-denominator hypothesis for `cpapdex`/`glucodex`/`hrvdex`/`motiondex`, which still sit at **zero ledger entries** so their denominators remain uncorrected. **Owner: Osprey. Next step:** sweep those nodes to non-zero ledger entries, then the box closes and the brief flips DONE — one work-unit, no blocker.

# MUTATION — COVERAGE-DIRECTED SELECTION, AND WHAT THE REBOOT MUST NOT COST AGAIN

Executes-from: `MUTATION-PROGRAM-2026-08-09-BRIEF.md` · `MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md` §6.

**READ THIS FIRST IF YOU ARE PICKING THE PROGRAMME BACK UP AFTER A RESTART.** Written 2026-08-14 with
a reboot pending, deliberately front-loading the state that is expensive to rediscover. Everything
below is measured in this session unless marked otherwise.

---

## 0 · WHERE THE STATE LIVES NOW — and why the last reboot cost a day

Everything is on the DRIVE, under `.mutation-sweeps/` (gitignored, ~14 MB). Nothing that matters is
in `/tmp` any more. That was the whole point of #1235:

| path | what it is | cost to rebuild |
|---|---|---|
| `.mutation-sweeps/<file>.json` | 8 survivor inventories, all canary-passed | a sweep (hours) |
| `.mutation-sweeps/per-group.json` | the 470-group coverage map | ~10 min |
| `.mutation-sweeps/cov/coverage-final.json` | aggregate c8 coverage | ~25 min |

**Before the fix, the eight sweeps lived in `/tmp` and a restart wiped them — and the loss presented
as SUCCESS**: `▸ FLEET 0/0 distinguishable = NaN% · target 99%`, exit 0. An empty queue read as a
finished one. `tools/mutation-worklist.mjs` now exits 2 with `NO SWEEP DATA — the queue is UNKNOWN,
not empty` (#1235).

### 🔴 0a · THE SWEEPS WERE NEVER ACTUALLY LOST, AND THE HANDOFF SAID THEY WERE

A prior session's handoff stated "every sweep is gone". That was **wrong**, and it was believed for
most of a session because only the paths the tool named were checked. **13 readable sweeps** were
sitting on disk the whole time, gitignored:

```
/run/media/michal/647A504F7A50205A/Tepna/wt-descartes/.mutation-crawl/   ← NEWEST, use this
/run/media/michal/647A504F7A50205A/crawl-results-2026-08-09/
/run/media/michal/647A504F7A50205A/wt-crawl/.mutation-crawl/
```

This is `MUTATION-PROGRAM` §8's own rule — **"search the DISK, not just the repo"** — re-learned the
hard way, by a session that had read the rule. If a sweep looks missing, `find` before you re-sweep.

⚠️ `wt-descartes/.mutation-crawl/ppgdex-dsp.js.sweep.json` is **0 bytes**, truncated mid-write by the
restart. `tools/mutate.mjs --resume` exists (journal-backed, quarantines mutants that started and
never finished) — resume it rather than re-running it. The imported ppgdex inventory currently falls
back to the older 2026-08-09 crawl.

---

## 1 · THE FLEET IS 52.1 %, NOT 38.5 % — all eight files, every one CANARY-VERIFIED, 2026-08-15

```
FLEET  5124/9832 distinguishable = 52.1%   4708 survivors unresolved   target 99%
SPLIT  UNREACHED 499 (10.0%) - UNASSERTED 4489 (90.0%)
```

Every file re-swept with coverage-directed selection under the §3a fix, and **every one reports
`canary=PASSED`**. The published 38.5 % was stale by ~14 points — the programme was much further along
than its own headline said, exactly as `MUTATION-PROGRAM-FOLLOWUPS` §2 predicted it would be.

**90 % of survivors are UNASSERTED** — code the tests execute and do not check. §4's fleet-level
diagnosis, confirmed PER MUTANT by an independent method. A coverage floor buys almost nothing.

### 1a · Per-file — and the fleet number hides how differentiated it is

| file | killed / distinguishable | rate |
|---|---:|---:|
| `motiondex-dsp.js` | 344 / 359 | **95.8 %** — effectively AT the 99 % target |
| `glucodex-dsp.js` | 573 / 782 | **73.3 %** |
| `hrvdex-dsp.js` | 304 / 420 | **72.4 %** |
| `cpapdex-dsp.js` | 462 / 788 | 58.6 % |
| `ppgdex-dsp.js` | 644 / 1196 | 53.8 % |
| `oxydex-dsp.js` | 1328 / 2661 | 49.9 % |
| `integrator-dsp.js` | 863 / 1832 | 47.1 % |
| `ecgdex-dsp.js` | 606 / 1794 | **33.8 %** — the laggard |
| *(`pulsedex-dsp.js`)* | *182 / 531* | *34.3 % — NOT in `SWEEP_FILES`, excluded from the above* |

**One fleet percentage was hiding a 62-point spread.** `motiondex` is done; `ecgdex` holds 1188
unresolved survivors on its own. Per-file targets — §2a option (3) of the followups, raised and never
decided — look better justified by this table than by anything argued at the time.

### 1c · A CANARY THAT COULD NOT VERIFY PRODUCED A PLAUSIBLE WRONG NUMBER

`hrvdex-dsp.js` was swept three times. The first ran inside a 4-file batch with `canary=STALE` — the
recorded anchor had drifted onto a comment, so `findCanary` returned null and the run was UNGUARDED.
It reported **331 kills**. Two later runs, one of them `canary=PASSED`, reported **305 and 304**.

    run 1  canary STALE   (unguarded)   killed 331   <- 27 high, in range, wrong
    run 2  canary NONE    (unguarded)   killed 305
    run 3  canary PASSED                killed 304   <- imported

Nothing about 331 looked wrong. The only signal was the tool declining to say PASSED. **Do not import
a sweep whose canary did not pass**, however plausible the number.

Re-learning the canary was left to the TOOL (`delete` the entry; `saveCanary` fires only when the
state is `NONE`, recording from a real attributed kill). Hand-picking was not an option: the stale
anchor's text occurs at TWO lines in the current source, and §8's rule is that a non-unique anchor
mutates the wrong function. Verify the other entries survive the rewrite — this file's own comment
records a bug where saving one canary destroyed every other.

### 1b · REACHABILITY RANKS THE SAME TWO FILES §4 DID, BY A DIFFERENT METHOD

Unreached share of each file's survivors:

    pulsedex 37.5 %  ·  hrvdex 20.2 %  ·  ppgdex 14.5 %  ·  oxydex 9.5 %
    integrator 9.0 % ·  motiondex 6.5 % ·  glucodex 5.1 % ·  cpapdex 0.2 %

`FOLLOWUPS` §4 named **hrvdex and pulsedex** as the only two genuinely under-executed files, derived
from c8 statement coverage against kill rates. This partitions SURVIVORS against per-line execution
and ranks the same two first and second. Two methods, one answer.

**And `pulsedex-dsp.js` IS NOT IN `SWEEP_FILES`.** The file with the fleet's worst reachability and
(per §4) its lowest kill rate is absent from the queue, from §1's table, and therefore from every
headline number including the 46.4 % above. Adding it moves a ratified target's denominator, so it is
an owner decision, not a fix to be slipped in.

---

## 1c · SUPERSEDED — the 6-file figure this section originally carried

Rebuilt from the surviving sweeps, on the DISTINGUISHABLE denominator the ratified target uses:

| file | killed / distinguishable | rate | FOLLOWUPS §1 |
|---|---:|---:|---:|
| `hrvdex-dsp.js` | 245 / 420 | **58.3 %** | 45.5 % |
| `motiondex-dsp.js` | 202 / 360 | **56.1 %** | 41.1 % |
| `cpapdex-dsp.js` | 357 / 803 | 44.5 % | 41.7 % |
| `glucodex-dsp.js` | 326 / 781 | 41.7 % | 40.2 % |
| `pulsedex-dsp.js` | 182 / 531 | 34.3 % | not in §1 |
| **6 files** | **1581 / 3422** | **46.2 %** | fleet 38.5 % |

§2 predicted exactly this: *"the list shows VERIFIED state, not claimed state — kills from tests
written since do not appear until that file is re-swept."*

**`oxydex-dsp.js`, `ecgdex-dsp.js`, `integrator-dsp.js` have NO sweep and NO ledger entries.** They
hold 6135 of the fleet's 9606 distinguishable mutants. They are also the three worst published
performers — and the only three whose denominator was never corrected for equivalents. That is
unlikely to be a coincidence and is worth testing before more test-writing is aimed at them.

---

## 2 · WHAT WAS BUILT (committed; see the changeset)

- **`tools/per-group-coverage.mjs`** — the map: which group executes which line. One c8 run per
  group, parallel, ~10 min for 470.
- **`tools/mutation-reach.mjs`** — splits survivors into UNREACHED / UNASSERTED.
- **`tools/mutate.mjs`** — consumes the map; each mutant runs only the groups touching its line.
- **`tests/run-tests.mjs --group-index=N[,M…]`** — exact addressing by declaration index, because
  titles contain regex metacharacters and commas (the `--group=` OR separator).

Measured selection, median groups of 470: `integrator 6 (78×)` · `hrvdex 9 (52×)` ·
`cpapdex 14 (34×)` · `oxydex 23 (20×)` · `ecgdex 23 (20×)` · `ppgdex 30 (16×)`.

### 2a · Two invariants, both learned by breaking them

1. **SELECTION MAY ONLY NARROW, NEVER WIDEN.** A line executed at MODULE LOAD is touched by all 470
   groups (the runner loads every DSP before any group runs). Expanding to all 470 runs the whole
   suite against a timeout calibrated on the narrow tag-filtered run ⇒ killed ⇒ scored **INVALID**:
   never tested, absent from both the killed and survivor counts. Measured on hrvdex `--limit 24`:
   identical survivors, `killed` 14 → 13, one INVALID at L47. Load-time lines now fall back to the
   tag filter.
2. **IT MAY NEVER NARROW TO ZERO.** A run with no groups fails nothing, so every mutant reports
   SURVIVED — a sweep that fabricates findings while looking like a spectacular speedup.

Both tools **fail closed** everywhere: over-running costs time, under-running silently stops testing
code and reports the silence as progress.

**The canary covers this for free** — `picked.push(canaryMu)` sends it through the same per-mutant
path, so a broken selection makes it survive and the sweep refuses (exit 3).

---

## 3 · ⚠️ RETRACTED — "calibration is the dominant cost" was an artefact of an 8-mutant run

**An earlier draft of this section said calibration was ~90 % of a sweep and named it the next thing
to fix. That is WRONG and the fix is not worth doing.** Recorded rather than deleted, because the way
it was wrong is the more useful artefact.

The measurement was `integrator-dsp --limit 8 --jobs 4` = 339 s wall, of which ~312 s was calibration.
True, and meaningless: **a fixed cost looks enormous amortised over almost nothing.** Measured against
FULL sweeps on the same box:

| file | calibration | elapsed | share |
|---|---:|---:|---:|
| `oxydex-dsp.js` | 37 s | 96 m 35 s | **0.6 %** |
| `ppgdex-dsp.js` | 101 s | 66 m 20 s | **2.5 %** |

0.6–2.5 %, not 90 %. Do not spend a work-unit here.

**And calibrating on the union is not merely acceptable, it is REQUIRED** — the cheap alternative is
unsafe. A module-LOAD line falls back to the tag filter (§2a), which is slower than a typical selected
run, so a timeout sized on a representative selection would kill exactly those runs and score them
INVALID. That is the defect §3a describes, re-introduced by the "optimisation". The union bounds both
paths; the cost of that guarantee is ~1 % of a sweep.

⚠️ The two suspiciously CHEAP calibrations in that table's full run — ecgdex 3 s, integrator 1 s —
were the §3a bug itself, not efficiency. A calibration that gets *faster* than the work it is sizing
is a symptom, not a win.

### 3a · THE DEFECT THIS SHIPPED WITH, and what caught it

`suiteArgs` made the run-suite selector polymorphic (an ARRAY of declaration indices, or a tag
STRING). **Only the async runner was updated.** `runSuite` still hand-built `'--group=' + filter`, so
an array stringified to `--group=44,45,46` — read as three TITLE substrings, resolving to ONE
unrelated group, 12 assertions instead of 62 groups. Calibration timed that near-empty run, `timeoutMs
= max(30000, baseMs × 5)` collapsed to its 30 s floor, and every mutant on a slow file was killed by
the timeout and scored INVALID — never tested, absent from BOTH the killed and survivor counts:

    oxydex     2679 tested,   18 INVALID (0.7 %)
    ecgdex     1809 tested, 1324 INVALID (73 %)   canary FAILED -> result VOIDED
    integrator 1840 tested,  178 INVALID (9.7 %)
    ppgdex     1342 tested,   17 INVALID (1.3 %)

**The A/B that "proved" selection safe covered only the async path.** hrvdex `--limit 24`, identical
survivor sets, zero disagreements — a real measurement, generalised past what it examined. Same shape
as §4.4's finding that "unkillable" was an estimate nobody re-tested.

**THE CANARY IS WHY THIS IS A CAUGHT BUG AND NOT A PUBLISHED NUMBER.** It runs the same per-mutant
path, so it died with everything else, and the tool VOIDED ecgdex and reported `killed: null` rather
than a plausible-looking rate. An instrument that refuses beats one that answers.

---

## 4 · OPEN, in the order I would take them

1. **Fix calibration (§3).** Biggest remaining lever, and it is now the dominant cost.
2. **Sweep the three unswept files** — `oxydex` · `ecgdex` · `integrator`. Cheap now. This is also
   what would confirm or kill §1's hypothesis about uncorrected denominators.
3. **Resume the truncated ppgdex sweep** — `tools/mutate.mjs --resume`, not a re-run.
4. **Harvest declared equivalences into the ledger.** Seven equivalent mutants are declared in code
   COMMENTS (e.g. `tests/dex-tests.js` at the HRV-geometry group: *"`if (f[k] > maxC)` → `>=` is an
   EQUIVALENT mutant … Do not add an assertion chasing it"*), while `tools/mutate-equivalence.json` —
   the file the tooling actually reads — has **zero** entries for `oxydex`/`ecgdex`/`integrator`. The
   knowledge exists and is invisible to every tool, so those mutants are re-reported forever and each
   session risks "chasing" one by writing an assertion that cannot fail. ⚠️ Needs a sweep first: a
   ledger key is `{line, op, before}` and `before` is a 100-char DISPLAY field that is not reliably
   reconstructible (§2b lost 42 of 217 survivors to exactly that).
5. **Arid-line suppression** at mutant-generation time — nothing does this yet.

### 4a · Declines, with reasons — do not re-litigate without new evidence

- **Mutant subsumption / dominator-set reduction as a SPEEDUP.** Minimal sets are computed from a
  kill matrix you already have; they are post-hoc analysis, not an a-priori skip list. Reduction
  strategies barely beat random sampling.
  *Gopinath, Alipour, Ahmed, Jensen & Groce (2016), ICSE, doi:10.1145/2884781.2884787*;
  *Ammann, Delamaro & Offutt (2014), ICST, doi:10.1109/ICST.2014.13*;
  *Kurtz, Ammann, Offutt, Delamaro & Gökçe (2016), FSE, doi:10.1145/2950290.2950322*
- **A coverage floor to raise the kill rate.** Refuted by FOLLOWUPS §4 and independently confirmed
  here: only **5.9 %** of survivors are UNREACHED. The gap is assertion strength.
- **In-process mutant evaluation to kill V8 startup.** Measured: startup is **0.21 s** against a
  27.6 s scoped group — 0.8 %. Worth nothing.

### 4b · The Python lane — mostly does not need any of this

`capture-host` enforces `--cov-fail-under=100` (statement AND branch), so skipping unreached mutants
is worth **exactly zero** there, and mutmut already does per-mutant coverage-directed selection
natively. The one real gap: `tests_for()` picks test FILES by name substring and its own author
records it as "useless" for `capture.py`, the largest module. `--cov-context=test` is available in the
installed pytest-cov and would replace the heuristic with a measured mapping.

---

## 5 · Done when

- [x] Per-group coverage map built, and the 10–100× estimate measured rather than quoted.
- [x] Selection wired into `mutate.mjs`, proven verdict-equivalent (hrvdex `--limit 24`: identical
      survivors, `killed=14`, `invalid=0`).
- [x] Survivors split UNREACHED / UNASSERTED — 109 / 1725.
- [x] Queue rebuilt from the surviving sweeps: 46.2 % over 6 files -> **46.4 % over all EIGHT (§1)**.
- [x] §3 RETRACTED — calibration is 0.6-2.5 % of a full sweep, not 90 %; the union is required, not
      merely acceptable. Full-fleet wall-clock now measured rather than estimated.
- [x] `oxydex` · `ecgdex` · `integrator` swept. ecgdex+integrator RE-swept after §3a; both canaries
      pass and invalid fell 1324 -> 15 and 178 -> 8.
- [ ] The uncorrected-denominator hypothesis (§1c) still untested — those three remain at ZERO
      ledger entries, so their denominators are still uncorrected even though their sweeps are fresh.
- [~] ~~`cpapdex` · `glucodex` · `hrvdex` · `motiondex` re-swept WITH selection~~ — **OVERTAKEN
      2026-08-19 by `MUTATION-SUITE-FOLLOWUPS` §3d**: selection is quarantined (opt-in only) after
      interval coverage was built and per-line selection still lost 7 of 38 real kills on paired
      hrvdex sweeps (state-dependent paths · load-executed lines · non-behavioural reds). Re-sweeping
      WITH selection would ship those losses; the box's premise no longer stands. If the §3d
      union-with-tag design lands, this box revives under that mechanism.
- [x] Owner decision: does `pulsedex-dsp.js` join `SWEEP_FILES` (§1b)? **YES — decided 2026-08-23, and ALREADY SHIPPED**: `tools/mutation-worklist.mjs:83` carries it as the ninth entry, and the selftest pins the count (`all NINE DSPs are expected — pulsedex was the missing ninth for the whole first programme`). The owner's answer and the code converged independently; this box records the ratification.
- [x] ppgdex re-swept outright (no journal existed for the truncated run).
- [x] **Declared equivalences harvested into `mutate-equivalence.json` — 2026-08-19.** All five
      comment-declared equivalents located and reconciled against the current sweeps:
      · pulsedex:448 + ecgdex:1283 (`f[k] > maxC` tie) — **added**, class `equivalent`, proofs attached;
      · hrvdex elev-1500 + stress-floor — already present at DRIFTED line numbers under the weaker
        `no-distinguishing-input`; the text-anchored key matched them anyway (#1486 doing its job) and
        both are **upgraded to `equivalent` with their proofs**;
      · the oxydex cross-cap pair (declared 2026-08-12) has **no surviving mutants in the current
        sweep** — killed since; nothing to ledger;
      · the glucodex `meals` guard declaration does NOT cover the mutant that actually survives:
        the declared-equivalent `||→&&` form is gone, and the survivor is `negate: drop !` on
        `!meals.length` — which nulls every WITH-meals call and survives only because **nothing
        asserts the with-meals path of `analyze()`**. That is a REAL kill lead, not an equivalence;
        recorded here rather than mis-ledgered.
