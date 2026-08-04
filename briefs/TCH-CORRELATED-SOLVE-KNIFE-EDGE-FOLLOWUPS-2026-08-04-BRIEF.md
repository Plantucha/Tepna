<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-04 · **Spawned-by:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` §8a (R2, executed) · **Relates:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-2026-07-03-BRIEF.md`, `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`

# The correlated solve is right; this triplet sits 0.5 % from the singularity that makes it meaningless

## 1 · What R2 established

`AnalysisStats.tchSigmasPairwise` / `…FromVars` implement the per-pair model
`Var(xᵢ − xⱼ) = σᵢ² + σⱼ² − 2ρᵢⱼσᵢσⱼ`, Newton-solved with an analytic Jacobian, and **refusal is a
first-class outcome**. The estimator is not in question: the known-answer self-test plants σ and a
per-pair ρ, rebuilds the three difference variances from the model exactly, and recovers the planted σ
to **1e-6 across six triples**, including all-pairs-correlated and mixed-sign ρ.

**What fails is this corpus, and it fails structurally.** Sweeping ρ(ECG,PPG) on the §4 variances:

| ρ(ECG,PPG) | σ CPAP | σ ECG | σ PPG |
|---|---|---|---|
| 0.00 (classic) | 2.07 | 2.15 | 2.70 |
| 0.30 | 1.33 | 2.67 | 3.13 |
| **0.42 (measured)** | **0.19** | 2.98 | 3.40 |
| 0.50 | *no solution* | — | — |

> **ρ_crit ≈ 0.422. The measured ρ = 0.42 sits within 0.5 % of the correlation at which σ(CPAP) hits
> zero, and past which the model has no solution at all.**

σ(CPAP) moves in the *predicted* direction — the common-mode path's 2.71 was indeed wrong in sign for a
corner outside the correlated pair — but it does not land anywhere credible. It collapses.

## 2 · Why this is a finding and not a bug

A σ of 0.19 bpm for a CPAP-derived corner is not a precision claim; it is the non-negativity boundary
seen from the inside. **Anything within a hair of ρ_crit produces an arbitrarily small σ for the
uncorrelated corner, and the estimator has no way to distinguish that from a genuinely quiet sensor.**
This is the same failure shape the classic hat has at negative variance — `tch-multinight` already
excludes those nights *"because the boundary member's σ is ~0 by construction, not by measurement"* —
except that here the collapse happens at a *positive* σ, so no negativity check catches it.

That the measured ρ lands 0.5 % from ρ_crit is far more likely to mean **the model is mis-specified for
this triplet** than that the physics chose that number. A single ρ per pair, constant across a night, is
the obvious suspect.

## 3 · What is owed

- [x] **DONE 2026-08-04 — every correlated solve now carries `rhoCrit`, and it reproduces §8a's
      independently-derived boundary exactly.**

      ⚠ **This item said "closed-form". Do NOT implement it that way — I did not.** A second derivation
      of the boundary is a second implementation of the model, free to disagree with the very σ it
      qualifies; the sensor-trio power tool shipped exactly that duplication and needed a parity gate to
      bind it back (`sensor-trio · tch-parity`). `rhoCrit` instead **bisects the real solver** — it asks
      the thing that produces the σ where it fails, so the answer cannot drift from what it describes.

      **Known-answer: the whole §8a sweep reproduces to the digit**, from pair variances reconstructed by
      inverting the classic hat on §8a's own ρ=0 row:

      | ρ(ECG,PPG) | σ CPAP · ECG · PPG | §8a |
      |---|---|---|
      | 0 | 2.07 · 2.15 · 2.70 | 2.07 · 2.15 · 2.70 |
      | 0.30 | 1.33 · 2.67 · 3.13 | 1.33 · 2.67 · 3.13 |
      | 0.42 | **0.19** · 2.98 · 3.40 | 0.19 · 2.98 · 3.40 |
      | 0.50 | *no solution* | *no solution* |

      and the bisection lands on **ρ_crit = 0.42199**, margin **0.0020** — against §8a's ≈ 0.422, derived
      by a different route.

      Reported for **every** pair, including ones at ρ = 0: *how far independence sits from collapse* is
      information even when no correlation was measured. `nearest` is the smallest move in any single ρ
      that breaks the solve. Additive field, so every existing caller is byte-unchanged.

      **Gated** by `analysis-stats · rho-crit` (13 assertions, both lanes). Two mutants confirm failure
      by value: returning `null` (4 legs) and skipping the bisection refinement, which reports 0.47
      instead of 0.422. The **anti-vacuity** leg is the one that gives "tiny" meaning — a well-conditioned
      triple reports margin **0.500** against the real triplet's **0.0020**, a 250× separation.

      ⚠ The first implementation **blew the stack**: `tchRhoCrit` probes the solver ~120 times, each probe
      re-entered `tchRhoCrit`, and the `_noCrit` guard was set on the caller's object rather than on the
      one actually passed. Guard the object you hand over, not the one you were handed.
- [ ] **Refuse, do not report, inside a margin of ρ_crit.** Pick the margin from the data, not by taste:
      measure how σ(uncorrelated corner) varies with ρ near the boundary and refuse where the derivative
      makes σ unidentifiable. Record the measured sensitivity beside the choice — and note the sibling
      lesson from `EDR-THRESHOLD-MARGIN-FOLLOWUPS` §3: state a margin only where the two regimes actually
      separate; where they do not, publish the sensitivity instead of inventing a boundary.
- [ ] **Test whether one constant ρ per pair is the mis-specification.** ρ(ECG,PPG) is estimated over a
      whole night; if it varies by epoch, the night-level value can sit near ρ_crit while no epoch does.
      Re-estimate per epoch and re-solve; if the per-epoch solves are stable while the pooled one
      collapses, the model is the problem and the triplet is fine.

## 4 · Explicitly NOT owed

- **Re-tuning ρ to move off the singularity.** The measured value is the measured value; choosing a
  different one to obtain a publishable σ is the failure this whole brief family exists to prevent.
- **Abandoning the correlated solve.** It passes its known-answer test to 1e-6. The estimator is sound;
  the input triplet is degenerate. Those are different problems and only the second is open.

## Cross-references
- Parent: `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` §8a — R2's sweep and the ρ_crit derivation.
- `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` — its power curves use the *classic* (ρ = 0) hat, so they are not
  affected by this; the `sensor-trio · tch-parity` gate binds that tool to the gated kernel.
- Failure-shape sibling: `tch-multinight`'s negative-variance exclusion — same boundary, opposite sign.
