<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-08 · **Follows:** `MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md` · **Sibling of:** `CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md` · **Affects:** every `*-dsp.js`

# The JS fleet has never been measured — first coverage map, and it is not 84 %

`clock.js` has had four full mutation sweeps and sits at **84 %**. It is 414 lines. The nine
`*-dsp.js` files are **~31,000 lines of shipped signal processing** and have never been measured at
all. The Python side has had a ranked fleet map since 2026-08-04 and it is what decides which module
gets worked next; the JS side had nothing equivalent. This is that map.

It exists now only because `--bail` (#1003) made it affordable: exhaustively, the fleet is ~11,500
mutants ≈ 150 h. The sample below cost well under an hour.

---

## 1 · The map

60 mutants sampled per file (`thin()` spreads them deterministically across the file, so this is an
estimate of the whole, not the first 60 lines). Scoped to each file's own test tag. Bail on.

| file | in-tag groups | tag cost | killed | **rate** | mutants in file |
|---|---:|---:|---|---:|---:|
| **`hrvdex-dsp.js`** | 15 | 1 s | 17/60 | **28 %** | 490 |
| **`ppgdex-dsp.js`** | **49** | 24 s | 19/58 | **33 %** | 1176 |
| `motiondex-dsp.js` | 15 | 1 s | 22/59 | 37 % | 466 |
| `cpapdex-dsp.js` | **7** | 4 s | 24/60 | 40 % | 819 |
| `pulsedex-dsp.js` | 17 | 6 s | 25/59 | 42 % | 568 |
| `glucodex-dsp.js` | 16 | 2 s | 33/60 | 55 % | 836 |
| `oxydex-dsp.js` | 39 | 20 s | 35/60 | 58 % | **2680** |
| `ecgdex-dsp.js` | 48 | 137 s | 37/60 | 62 % | 1725 |
| `integrator-dsp.js` | **73** | 310 s | 40/59 | **68 %** | 1745 |
| *(`clock.js`, for scale)* | 47 | — | 97/117 | 84 % | 123 |

**The ranking is almost exactly the tag-size ranking.** Sorted by kill rate, the in-tag group counts
read 15, 49, 15, 7, 17, 16, 39, 48, 73 — monotone at the top and bottom, with `ppgdex` the single
conspicuous exception (§2). Whatever else is true, the fleet's coverage is mostly explained by how
much test surface each node was given, not by anything intrinsic to the signal it processes.

**Every rate here is a LOWER BOUND, and every run was UNGUARDED.** Both are structural, not
incidental — §4.

## 2 · What the numbers actually say

**The fleet is not near `clock.js`.** Six of the nine sit between 28 % and 55 %; not one reaches 70 %. The gap
is not marginal: on `hrvdex-dsp.js`, roughly **seven of every ten sampled edits to shipped HRV code
went unnoticed by its own tests.**

**`ppgdex-dsp.js` is the sharpest result, and it survives the obvious objection.** The natural way to
dismiss a low scoped rate is "the tag is too narrow — the killing tests live elsewhere". That cannot
be the explanation here: ppgdex runs **49 groups**, the second-broadest tag in the fleet, and still
kills only a third. Its coverage is thin on its own terms.

**`cpapdex-dsp.js`'s 40 % is the least trustworthy number in the table** and should not be quoted
without this sentence. It has the narrowest tag (**7 groups**, of which only **3** killed anything)
against the third-largest file (819 mutants). It is the one file where "the killers are outside the
tag" is a live hypothesis.

**Test weight tracks coverage, which is reassuring but was not guaranteed.** With all nine in, the
top three by kill rate are the three broadest tags — `integrator` (73 groups, 68 %), `ecgdex` (48,
62 %), `oxydex` (39, 58 %) — and the bottom is `hrvdex` (15, 28 %). A big tag is nonetheless only
*necessary*, not sufficient: `ppgdex` runs 49 groups, more than `ecgdex`, and kills half as often.

**`oxydex-dsp.js` — the flagship — lands mid-table at 58 %**, on the largest file in the fleet (2680
mutants). Its sample carries the widest error bar of the nine (60 of 2680, roughly ±12 points), so
the honest statement is "somewhere around half to two-thirds", and that is worth narrowing before
anything is concluded about the SpO₂ node specifically.

## 3 · Cost decides method — a 300× spread

The per-mutant floor is the tag's clean-run time, and it ranges from **1 s to 310 s across the fleet**:

- **1–6 s** (`hrvdex`, `motiondex`, `cpapdex`, `glucodex`, `pulsedex`) — **exhaustively sweepable.**
  All 490 of hrvdex's mutants cost minutes. There is no reason to sample these.
- **20–310 s** (`oxydex`, `ppgdex`, `ecgdex`, `integrator`) — **sample-and-triage only.**
  `ecgdex-dsp.js` exhaustively is ~65 CPU-hours *scoped*; `integrator-dsp.js` ~150; `oxydex-dsp.js`
  ~15 even at 20 s, because it is the largest file. None is a periodic audit anyone will run.

That second group is the argument for the **diff gate** (`--diff`, #1003) rather than an audit: the
Integrator is the fusion layer every node feeds into, so it is simultaneously the most consequential
file to have covered and the least practical to sweep whole. Gating the lines a PR touches is the
only form that fits the cost.

## 4 · Two caveats that are part of the result, not footnotes

**(a) Every rate is a scoped lower bound.** A mutant killed by a group *outside* the file's tag is
counted here as a survivor. That penalty was measured once — on `clock.js`, at **1 mutant in 127** —
but `clock.js` is inlined into every bundle, so its 47-group tag is unusually broad and that figure
almost certainly does not transfer. **The scoped-vs-full penalty for a DSP is unmeasured.** Until one
file is run both ways, the true rates are somewhere at or above the table.

**(b) Every run was unguarded.** No canary existed for any DSP, so the harness checked itself against
nothing — the exact gap that `clock.js`'s seeded canary closes. Each run *learned* a canary for next
time, so the second pass is the one that confirms these. Treat the table as a hypothesis.

That distinction is not pedantry here. **Every defect found today was in the checking machinery, not
in the code under test** — five of them, all self-inflicted, each surviving inspection and dying to a
comparison: non-zero exits scored as kills; 25 unrun mutants silently depressing a rate; a real
survivor hiding inside an `INVALID` count; a contention diagnosis that was wrong and was repeated;
and a canary serialiser that stored nothing while deleting every other file's guard (#1026) — found
only because this very sweep happened to write eight entries at once.

A first unguarded pass is exactly the shape those took. That is the argument for treating this table
as a hypothesis rather than a result, and for the second pass in §7.

## 5 · The invalids, named

The `invalids` list (#1017) earns its place immediately — five across the fleet, and the reasons
differ:

| file | reason | mutant |
|---|---|---|
| `motiondex-dsp.js` | timeout | `L285 [bool && → ||]` |
| `pulsedex-dsp.js` | timeout | `L1240 [num → 0]` |
| `ppgdex-dsp.js` | timeout | `L880 [num → 0]` |
| `integrator-dsp.js` | timeout | `L2101 [cmp < → <=]` |
| `ppgdex-dsp.js` | no-output | `L49 [num → 0]` |

Four of the five are **non-terminating** mutants — the `num → 0` pattern turning a loop increment into zero, the
same shape as `clock.js:211`. They are excluded from the denominators above rather than counted as
kills; see #1017 for why that is deliberately more conservative than Stryker/PIT/mutmut.

## 6 · Proposed order of work

1. **`hrvdex-dsp.js` first** — worst coverage (28 %) *and* cheapest tag (1 s). Sweep all 490, triage
   by enclosing function, probe for distinguishing inputs before writing anything.
2. **`ppgdex-dsp.js` second** — 33 % despite 49 groups is the strongest signal that tests exist but do
   not assert.
3. **`cpapdex-dsp.js`** — first resolve whether 40 % is real or a 7-group artifact, by running it
   unfiltered once. That single run also gives the fleet its missing scoped-vs-full penalty.
4. **`ecgdex` / `integrator` / `oxydex`** — do **not** schedule an exhaustive sweep. `integrator`
   alone is ~150 CPU-hours scoped. Cover them with `--diff` on every PR, and sample when a specific
   subsystem is suspected. These three are also the *best*-covered, so they are the worst use of an
   audit budget regardless.

## 7 · Done when

- [x] All nine DSPs sampled, with in-tag group count and tag cost recorded (§1).
- [ ] One file run **unfiltered** so the scoped-vs-full penalty is measured for a DSP rather than
      assumed from `clock.js` (§4a). Until then no rate here is quotable as coverage.
- [ ] A second pass on each file, **canary-guarded**, confirming or correcting the table (§4b).
- [ ] `hrvdex-dsp.js` swept exhaustively and its survivors triaged into real-gap / no-distinguishing-
      input / untestable, per the `MUTATION-EQUIVALENCE` §5 vocabulary.
- [ ] **Owner call:** is a fleet-wide target adopted at all? *(Partly settled 2026-08-08: the
      DENOMINATOR question is answered — `MUTATION-EQUIVALENCE` §5 is ratified, so any target here
      is read against DISTINGUISHABLE mutants, and `mutate.mjs` reports that rate. Whether a
      fleet-wide target is adopted AT ALL remains open and is this brief's to ask.)*
      `MUTATION-EQUIVALENCE` argued 90 % raw is
      unreachable even for `clock.js`. Setting one for 31,000 lines of DSP without first measuring the
      equivalent-mutant share would repeat that error at nine times the scale.
