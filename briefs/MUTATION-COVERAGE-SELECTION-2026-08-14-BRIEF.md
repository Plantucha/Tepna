<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS · **Created:** 2026-08-14

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
| `.mutation-sweeps/<file>.json` | 6 survivor inventories | a sweep (hours) |
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

## 1 · THE FLEET NUMBER IS 46.2 %, NOT 38.5 % — the published figure is stale

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

## 3 · 🔴 THE NEXT THING TO FIX — calibration is now the dominant cost

`tools/mutate.mjs` sizes each mutant's timeout from ONE clean run of the **tag-filtered** group set
(`baseMs × 5`). That made sense when mutants ran that same set. They no longer do.

Measured: `integrator-dsp --limit 8 --jobs 4` = **339 s wall**, of which **~312 s is calibration** and
~25 s is the mutants. Calibration is ~90 % of a small sweep and it is measuring a set nobody runs.

Fix: calibrate against the SELECTED set (or the widest selection in the batch). Until then the
timeout is ~5× too loose, which also weakens §8's "a hang is its own verdict" rule.

**Consequence for planning: the tool header's "a full fleet re-sweep is ~24 h" is obsolete.** With
per-mutant cost cut 15–78× the fleet is low single-digit hours, dominated by per-file calibration.
Do not quote a number until §3 lands — it would be measuring the wrong term.

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
- [x] Queue rebuilt from the surviving sweeps: 46.2 % over 6 files.
- [ ] §3 calibration fixed, and a fleet wall-clock quoted from measurement.
- [ ] `oxydex` · `ecgdex` · `integrator` swept; the uncorrected-denominator hypothesis tested.
- [ ] ppgdex sweep resumed from its journal.
- [ ] Declared equivalences harvested into `mutate-equivalence.json`.
