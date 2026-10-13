<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS (§8 MEASURES M1–M3 on 2026-10-12 and REFUTES §2's O2Ring-corner prediction. All 25 fused negatives sit on the Verity corner, none on the O2Ring. M2 removes 20 of them, so the per-pair measure asymmetry IS the mechanism. Its route runs through V_HO, not V_HV. §5's precondition for option C fails. The owner picks A or B.) · **Created:** 2026-10-12 · **Promoted from:** residue `2026-09-16-tch-degeneracy-is-estimator-not-data` (owner ruling 2026-10-12, relayed) · **Answers:** `OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` §D7 · **Relates:** `TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md` (DONE 2026-09-26), `TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04-BRIEF.md`, `TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md`

# Why the fused hat goes degenerate and the unweighted one does not — the mechanism, derived

**D7 was not a choice between two estimators.** The owner ruled on 2026-09-17: *derive the mechanism
first.* Adopting an estimator because it fails less often, without knowing why the other fails, is the
kind of choice that ages badly in a paper — and the two intuitive explanations were both tested and
refuted, so no guess could have reached the remaining mechanism. This brief carries the derivation
the ruling asked for, the one cheap run that discriminates it, and the options with what each changes.

## 1 · What is already measured and must not be re-measured

Same corpus, same epochs, same granularity, weighting the only factor that moved:

| estimator | negative-variance nights |
|---|---|
| fused (per-corner DSP confidence × consensus trust) | **12 / 64** |
| unweighted (the same code path, weights disabled) | **0 / 64** |

`node tools/tch-fused-corpus.mjs --dir uploads/trio`, 2026-09-16, 118 nights read / 64 solved. Each
the tool solves each night **twice through one estimator** — `tch-fused-corpus.mjs:202-203` calls
`AS.tchSigmasFused(hh, vv, oo, cH, cV, cO)` and then the same function with `one, one, one` — so the
comparison carries no second implementation and no second corpus.

**I tested two hypotheses and REFUTED both.** Neither one returns without new evidence:

1. **Clock alignment.** Combined H10↔Verity `offsetMadMs` over 19 folded nights: 3hat-EXCLUDED median
   **206.2 ms** vs ESTIMATED **213.1 ms** — indistinguishable, and the excluded set is if anything
   slightly *better* aligned.
2. **Epoch artifact.** Per-epoch tri-node HR spread over 63 nights: EXCLUDED median **7.6 %** of epochs
   > 3 bpm vs ESTIMATED **4.8 %**; medians of spread identical at **1.00 bpm**. The individual nights
   kill it outright — `2026-08-23` (54.8 % > 3 bpm) and `2026-08-25` (61.1 %) both ESTIMATE FINE, while
   `2026-09-15`, the *least* disagreeing night in the corpus (1.3 %), is EXCLUDED.

## 2 · The mechanism, derived from the estimator

The classic hat is a half-sum identity over three pairwise difference variances
(`analysis-stats.js:151`):

    σ²_H = ½(V_HV + V_HO − V_VO)        σ²_V = ½(V_HV + V_VO − V_HO)        σ²_O = ½(V_HO + V_VO − V_HV)

A corner goes negative exactly when the triangle inequality fails on those three numbers. **The identity
assumes one sample behind all three variances.** The fused path does not satisfy that
assumption (`analysis-stats.js:926-959`):

    wHV = t·h·v        wHO = t·h·o        wVO = t·v·o
    cv  = threeCorneredHat( _wvar(dHV, wHV), _wvar(dHO, wHO), _wvar(dVO, wVO) )

`_wvar` (`analysis-stats.js:770`) normalises by `Σw` — it is a variance under *its own* weighted
probability measure, with its own weighted mean. So the three inputs to the half-sum are estimates under
**three different measures**, one per pair. The night need contribute nothing: the triangle inequality
can fail by construction.

With the weights disabled all three collapse onto the
identical sample, which is why `one, one, one` gives 0/64 — and that zero is a property of the common
measure, **not** evidence that the unweighted estimator is better conditioned on real data.

**The asymmetry runs sharper than "different weights".** `tch-fused-corpus.mjs:198` pins `cO` at 1 for the O2Ring — *"a smoothed
device integer, cannot over-detect ⇒ trust 1"* (`tools/tch-fused-corpus.mjs:198`). So in the corpus run
above:

    wHV = t·h·v   (a product of TWO sub-unit confidences)
    wHO = t·h     wVO = t·v   (ONE each)

A product of two numbers in (0,1] stays systematically smaller than either factor, so a different —
higher-confidence — subset of beats dominates `V_HV` than dominates the two O2Ring pairs. `V_HV` enters
`σ²_O = ½(V_HO + V_VO − V_HV)` with a **minus** sign, which makes the O2Ring corner the one most exposed
to the asymmetry.

That is a prediction, not a result: this brief does not yet know which corner carried
the 12 negatives, and `tchSigmasFused` already returns `negVar` per corner, so the answer is one re-run
away (§4 M1).

**The alternative mechanism is already modelled elsewhere and is not excluded.** Classic TCH also assumes
mutually independent corner errors; `analysis-stats.js:151`'s own header records ρ(ECG,PPG) = 0.42 for a
respiration triplet and notes that a violated independence assumption *"does not fail loudly; it MOVES
VARIANCE between corners"*.

Weighting re-weights the beats over which each pair's correlation acts, so it can move the effective
ρ_ij as well as the measure. §4's M2 separates the two.

## 3 · The caveat that constrains every option

`tch-fused-corpus.mjs:273-276` prints it on every run: nights carrying no per-beat `conf` fall back to
**c = 1**, so *"their 'fused' column is the unweighted hat wearing the fused label"*. A consumer must therefore filter the
2026-09-16 run's σ on `hasConf`, and re-derive any fused σ for publication with `tools/trio-batch.mjs`
on a build that exports `rr.conf` / `ppi.conf`.

**The 12/64-vs-0/64 count survives the caveat intact** — it counts negative corners, and a night that
fell back to c = 1 contributes to *both* columns identically, so it cannot manufacture a difference
between them.

Second non-comparability, recorded here so the next session need not re-discover it: `tch-multinight.mjs`'s 9/67 exclusions are
the **epoch-granularity classic** hat; `tch-fused-corpus.mjs` pools ~16.5 k units/night. Different
computations. A reader may compare the exclusion *rates* side by side, and never the **σ magnitudes**.

## 4 · The three measurements that decide it

All three run on the committed trio corpus, read-only, no DSP change. Costs are from the 2026-09-16 run
(118 nights, both estimators, ~4 min wall).

- **M1 · Which corner.** Report `negVar.{h10,verity,o2}` per excluded night. Pre-stated criterion: if
  **≥ 9 of the 12** negatives sit on the O2Ring corner, that upholds §2's asymmetry prediction; a spread
  across corners refutes it as the *sole* mechanism. Cost ~4 min; the field already exists.
- **M2 · One common weight.** Recompute with a single vector `w = t·h·v·o` applied to all three pairwise
  variances — one measure, confidence information retained. Pre-stated criterion: **0 negative nights**
  means the mechanism is the per-pair measure asymmetry and §5's option C becomes available; **any
  negatives remaining** means a second mechanism (correlated errors, M3) is also live. Cost ~4 min plus a
  ~20-line estimator variant.
- **M3 · Correlated solve.** Run the pairwise-ρ hat (`integrator-tch.js`) on the nights M2 leaves negative.
  Pre-stated criterion: if the Newton solve converges to three positive σ on **every** remaining night,
  the residue is correlation, not weighting. Cost ~10 min.

Each emits one `tepna.verdict/1` object with the criterion above as `criterion`, pre-stated here **before**
any of the three has run on these nights, per `VERDICT-CONTRACT-2026-09-21-BRIEF.md` §1.

## 5 · The options, and what each changes

| | option | what it changes | what it costs |
|---|---|---|---|
| **A** | **Unweighted hat is canonical**; fused retired to a diagnostic | every published σ loses the DSP confidence information; `sensor-trio-night.js:639` and the worker point both re-point; the N15 power numbers are re-stated on the unweighted estimator | a re-fold is **not** needed (both columns come from one run), but every σ already quoted as fused is withdrawn |
| **B** | **Fused stays canonical**, exclusions documented as an estimator property | nothing in code; `"σ unavailable"` gains a named reason that says *estimator*, not *night* | the paper carries a 19 % exclusion rate it cannot explain — the position D7 was opened to avoid |
| **C** | **Fused with ONE common weight** (available only if M2 returns 0) | `tchSigmasFused` gains a common-measure path; confidence is kept AND the half-sum assumption holds; σ magnitudes move, so every fused fixture re-verifies | ~20 lines + a re-fold at the new `codeDigest`; `analysis-stats.js` is a compute module, so this moves `computeHash` |
| **D** | **Neither until the mechanism is derived** | nothing; D7 stays an analysis unit | the three runs in §4 — under 20 min of compute |

**Recommendation: D then C.** §4 is cheap enough that choosing between A and B before running it would be
choosing in the dark, and §2 makes C the only option that does not discard information.

## 6 · Acceptance

1. M1, M2, M3 run with the §4 criteria unchanged from this brief, each emitting one `tepna.verdict/1`.
2. The corner distribution of the 12 negatives is on record.
3. M1–M3 uphold or refute §2's derivation **by name**, and a refutation goes back into this
   brief rather than into a new one.
4. The owner picks A, B or C on the evidence; the residue row closes to this brief's filename.
5. Nobody quotes a σ from a `hasConf: false` night, in this brief or anywhere downstream.

## 7 · Out of scope

Re-measuring 12/64-vs-0/64. Re-proposing clock alignment or epoch artifact. Comparing `tch-multinight` σ
magnitudes with `tch-fused-corpus` σ magnitudes. The new-generation fused triple (σ 2.87 / 1.18 / 0.68,
ρ\* 0.576) — that is with the owner as a planted-σ check and decides nothing here.

**Rule 0:** `node tools/doc-search.mjs "three-cornered hat negative variance fused weighting degeneracy mechanism"` → `OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` (0.033), `INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md` (0.032), `sigma-no-reference-analysis.js` (0.030), `papers/sigma-no-reference.html` (0.030), `analysis-stats.js` (0.016) — read 2026-10-12; no prior brief carries the derivation, D7 § carries the ruling.

## 8 · M1–M3, MEASURED 2026-10-12 — §2's structure holds, its route is refuted by name

```sh
node tools/tch-degeneracy-d7.mjs --dir uploads/trio --json     # three tepna.verdict/1 objects + per-night rows
node tools/tch-degeneracy-d7.mjs --selftest                    # 42 planted assertions, no corpus
```

The §4 criteria are unchanged. `tools/tch-degeneracy-d7.mjs` calls the production `tchSigmasFused` for
all three columns and re-implements no estimator; for M2's single weight it passes
`g = √(cH·cV·cO)` to all three corners, which makes `w_HV = w_HO = w_VO = t·cH·cV·cO` exactly.

**The population moved, and this section reports it rather than hiding it.** §1's run read 118 night
directories and solved 64.
This corpus holds 147 and solves 90 — the committed fold has grown since 2026-09-16. §4's "≥ 9 of 12" is
therefore carried as the **share** 0.75, which is that ratio, not a number fitted to this run.

| | measurement | status | result |
|---|---|---|---|
| **M1** | which corner carries the fused negatives | **FAIL** | **25 of 25 negative corners are Verity (PpgDex)**; h10 0, O2Ring **0**. 25 of 90 nights (27.8 %), all `hasConf: true` |
| **M2** | one common weight `t·cH·cV·cO` | **FAIL** | **5 of 90 nights stay negative** — 20 of the 25 are removed, and the 5 that remain move to the **h10** corner |
| **M3** | pairwise-ρ hat on M2's residue | **PASS** | all 5 converge to three positive σ at a minimum ρ of **0.19 – 0.26** |

### 8.1 §2's prediction is refuted, and the correct route is measured

§2 predicted the **O2Ring** corner, reasoning that `w_HV = t·h·v` carries two sub-unit confidences, so a
higher-confidence beat subset dominates `V_HV`, which enters `σ²_O` with a minus sign. The corner
is **Verity**, with nothing on the O2Ring corner at all. Under the uniform-⅓ null that
`TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` §6.2 used to refuse an attribution at n = 8,
`P(X ≥ 25 | 25, ⅓) = 1.2 × 10⁻¹²` (3.5 × 10⁻¹² if tripled for having named the leading corner after
looking). At that n the attribution is a finding by §6.2's own standard.

§2's **structure** survives — the per-pair measure asymmetry is the mechanism, and M2 removing 20 of 25
negatives is the direct evidence. Its **route** does not, and the tool measures the correct one. The
corpus pins `cO = 1` (`tools/tch-fused-corpus.mjs:201`), so `g² = cH·cV·cO = cH·cV` and the common weight
**is** `w_HV`: `V_HV` is unchanged (median relative shift 0, max 3.6 × 10⁻¹⁵ — a control, and it holds),
and M2 re-estimates only the two single-factor pairs. Moving them onto the two-factor measure changes
`V_HO` by a median of **−8.5 %** (−12 % to −16 % on the negative nights) and `V_VO` by **−1.4 %**. So the
pair estimated under the *looser* measure is `V_HO`, not `V_HV`, and
`σ²_V = ½(V_HV + V_VO − V_HO)` is the half-sum that `V_HO` enters with a minus sign. **The exposed corner
is the one opposite the single-factor pair most inflated by its own measure — Verity, as measured.**

### 8.2 §5's precondition for option C is NOT met

§5 makes C available only if M2 returns 0. It returned 5, so the brief's own rule bars C, and this
section proposes no replacement — §6.4 leaves the pick to the owner. What the measurement adds to the choice:

- The per-pair asymmetry accounts for **20 of the 25** exclusions. One common measure would cut the fused
  exclusion rate from 27.8 % to 5.6 %.
- The residual 5 sit on the **h10** corner, which is where the unweighted hat's own negatives sit
  (2026-07-06, 07-08, 07-09), so the residue is not an artifact of weighting.
- M3 resolves all 5 at ρ ≥ 0.19–0.26. `correlated` sweeps ρ upward and stops at the **first** value
  admitting a non-negative solution, so that is a **lower bound** on the common-mode correlation, never an
  estimate — ρ is not identifiable reference-free
  (`CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14` §1). At that first ρ the smallest corner sits **at** the
  boundary by construction, which is why the Verity σ in those five triples reads 0.0003–0.019 bpm. That
  is the search stopping, not a sensor measured as perfect, and §6.2's "~0 by construction, not by
  measurement" is the same caveat one estimator earlier.

### 8.3 Two numbers in §1 moved with the corpus, and §7 keeps them out of scope

§7 excludes re-measuring 12/64-vs-0/64, and this unit did not set out to. Both columns come from one run,
so recomputing M1 on 90 nights recomputes the control too, and it moved: fused **25/90 (27.8 %)** against
§1's 12/64 (18.8 %), and unweighted **3/90 (3.3 %)** against §1's 0/64. Reported because it moved, not as
a re-measurement — the 2026-09-16 numbers stand for the 2026-09-16 corpus. §1's *claim* is unaffected:
the fused estimator still excludes roughly eight times as many nights as the unweighted one.

### 8.4 Acceptance

1. ✅ M1, M2, M3 ran with §4's criteria unchanged, each emitting one `tepna.verdict/1`.
2. ✅ The corner distribution is on record — in `result.negativeCornerCounts` and per night in
   `result.nights`.
3. ✅ §8.1 refutes §2 **by name** — the O2Ring corner is not the exposed one — and carries the corrected
   route, in this brief rather than in a new one.
4. ⬜ **Open — the owner picks A or B** (C's precondition failed). §8.2 is the evidence.
5. ✅ Nobody quotes a σ from a `hasConf: false` night. All 90 solved nights in this corpus carry per-beat
   `conf`, and the five σ triples in §8.2 are all `hasConf: true`.

**Rule 0:** `node tools/doc-search.mjs --read "TCH fused degeneracy mechanism D7 measurements M1 M2 M3"` → this brief (0.620), `OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` (0.584), `briefs/RESIDUE.md` (0.574), `DOCS-INDEX.md` (0.570) — read 2026-10-12.
