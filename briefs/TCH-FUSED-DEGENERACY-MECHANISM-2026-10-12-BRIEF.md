<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-10-12 · **Promoted from:** residue `2026-09-16-tch-degeneracy-is-estimator-not-data` (owner ruling 2026-10-12, relayed) · **Answers:** `OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` §D7 · **Relates:** `TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md` (DONE 2026-09-26), `TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04-BRIEF.md`, `TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md`

# Why the fused hat goes degenerate and the unweighted one does not — the mechanism, derived

**D7 was not a choice between two estimators.** The owner ruled on 2026-09-17: *derive the mechanism
first.* Adopting an estimator because it fails less often, without knowing why the other fails, is the
kind of choice that ages badly in a paper — and the two intuitive explanations were both tested and
refuted, so the remaining mechanism was never going to be guessed. This brief carries the derivation
the ruling asked for, the one cheap run that discriminates it, and the options with what each changes.

## 1 · What is already measured and must not be re-measured

Same corpus, same epochs, same granularity, weighting the only factor that moved:

| estimator | negative-variance nights |
|---|---|
| fused (per-corner DSP confidence × consensus trust) | **12 / 64** |
| unweighted (the same code path, weights disabled) | **0 / 64** |

`node tools/tch-fused-corpus.mjs --dir uploads/trio`, 2026-09-16, 118 nights read / 64 solved. Each
night is solved **twice through one estimator** — `tch-fused-corpus.mjs:202-203` calls
`AS.tchSigmasFused(hh, vv, oo, cH, cV, cO)` and then the same function with `one, one, one` — so the
comparison carries no second implementation and no second corpus.

**Two hypotheses were tested and REFUTED.** Neither may be re-proposed without new evidence:

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
assumes all three variances are estimated over ONE sample.** The fused path does not satisfy that
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

**The asymmetry is sharper than "different weights".** `cO` is pinned at 1 for the O2Ring — *"a smoothed
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
computations — the exclusion *rates* may be discussed side by side, the **σ magnitudes may not**.

## 4 · The three measurements that decide it

All three run on the committed trio corpus, read-only, no DSP change. Costs are from the 2026-09-16 run
(118 nights, both estimators, ~4 min wall).

- **M1 · Which corner.** Report `negVar.{h10,verity,o2}` per excluded night. Pre-stated criterion: if
  **≥ 9 of the 12** negatives sit on the O2Ring corner, §2's asymmetry prediction is supported; a spread
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
3. §2's derivation is either supported or refuted **by name**, and a refutation is written back into this
   brief rather than into a new one.
4. The owner picks A, B or C on the evidence; the residue row closes to this brief's filename.
5. No σ is quoted from a `hasConf: false` night, in this brief or anywhere downstream.

## 7 · Out of scope

Re-measuring 12/64-vs-0/64. Re-proposing clock alignment or epoch artifact. Comparing `tch-multinight` σ
magnitudes with `tch-fused-corpus` σ magnitudes. The new-generation fused triple (σ 2.87 / 1.18 / 0.68,
ρ\* 0.576) — that is with the owner as a planted-σ check and decides nothing here.

**Rule 0:** `node tools/doc-search.mjs "three-cornered hat negative variance fused weighting degeneracy mechanism"` → `OWNER-DECISION-QUEUE-2026-09-03-BRIEF.md` (0.033), `INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md` (0.032), `sigma-no-reference-analysis.js` (0.030), `papers/sigma-no-reference.html` (0.030), `analysis-stats.js` (0.016) — read 2026-10-12; no prior brief carries the derivation, D7 § carries the ruling.
