<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-09 (all three §3 items closed. ⚠️ **The last one REFUTED its own hypothesis and §2's diagnosis with it:** ρ̂ (the residual correlation against CPAP-as-truth) and the ρ at which σ(CPAP) vanishes are **the same algebraic expression**, so the measured ρ can never sit anywhere but exactly on the singularity — for any data. Verified to 0.000e+0 pooled, ≤6.1e-16 per night, and 6.11e-16 over 200 random triples. The "0.5 % from ρ_crit" was rounding; there was no gap to explain. Per-night ρ spans −0.007…0.978 and all 9 solvable nights still land on their own ρ_crit with margin 0.0000, so pooling was never the problem. The estimator, refusal path and `rhoCrit` are untouched and sound. See §5.) · **Created:** 2026-08-04 · **Spawned-by:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` §8a (R2, executed) · **Relates:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-2026-07-03-BRIEF.md`, `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`

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
- [x] **MEASURED 2026-08-04 — there is NO margin to pick, so the sensitivity is published instead.**
      This item hedged correctly: the sibling lesson applies, and the regimes do not separate.

      | distance from ρ_crit | 0.200 | 0.100 | 0.050 | 0.020 | 0.010 | 0.005 | 0.002 |
      |---|---|---|---|---|---|---|---|
      | σ(collapsing corner) | 1.618 | 1.227 | 0.902 | 0.584 | 0.417 | 0.296 | **0.188** |
      | dσ per 0.01 of ρ | −0.030 | −0.051 | −0.080 | −0.133 | −0.183 | −0.242 | **−0.324** |

      **Smooth and monotonic all the way in.** No point at which σ becomes "suddenly" unidentifiable, so
      any refusal threshold would be taste wearing a number — exactly what
      `EDR-THRESHOLD-MARGIN-FOLLOWUPS` §3 warns against after the same thing happened with the RR-
      regularity constants.

      **So the question is re-framed, and that is the deliverable.** Not *"how close to ρ_crit is too
      close"* but **"how precisely is ρ known?"** — which only the caller can answer, so the solve now
      publishes the arithmetic rather than a verdict:

      - `nearest.sigmaPerRho` — the local dσ/dρ, in bpm per 0.01 of ρ.
      - `nearest.rhoFor0p1` — the ρ precision needed to pin σ to ±0.1 bpm.

      At the measured ρ = 0.42 that is **−0.324 bpm per 0.01**, i.e. **ρ must be known to ±0.0031**. A
      night-level ρ estimated from one recording is nowhere near that precise, so **σ(CPAP) is not
      identifiable here — and would not be even if the operating point sat further from the boundary**.
      That is a stronger and more useful statement than a refusal flag.

      **Gated** — `analysis-stats · rho-crit` grows to 18 assertions, with the anti-vacuity leg carrying
      the meaning: far from the boundary the same field reports **−0.030** and tolerates **±0.0338**, a
      10× contrast against the operating point.
- [x] **REFUTED 2026-08-09 — and the real cause is worse than a mis-specification: ρ was measured
      circularly, so it can NEVER be anywhere but the singularity.** See §5.

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

---

## 5 · EXECUTED 2026-08-09 — ρ̂ and ρ_crit are the SAME EXPRESSION. The knife edge is an identity.

The open item asked whether one constant ρ per pair is the mis-specification: *"if it varies by epoch,
the night-level value can sit near ρ_crit while no epoch does."* Both halves were run
(`tools/tch-per-epoch-rho.mjs`, over the 78 epochs / 16 nights the reference-validation tool extracts).

**The hypothesis is refuted, and the reason is not about pooling at all.**

### 5.1 · What the per-night solve shows

ρ varies **enormously** between nights — far more than the hypothesis needed:

| | pooled | per-night min | median | max |
|---|---|---|---|---|
| ρ(ECG,PPG) | 0.6222 | **−0.007** | 0.648 | **0.978** |

And it changes nothing. Of 16 nights: 4 refused (n < 4 — ρ is not estimable on one epoch, and imputing
one would be inventing a number), 3 admit **no solution at all** at their own ρ, and **all 9 that solve
return σ(CPAP) = 0.0000 with a margin to their own ρ_crit of 0.0000.** Nine out of nine. Not "near" the
singularity — *on* it.

### 5.2 · Why: the estimate assumes what the solve is asked to determine

ρ was estimated as the correlation of the two residuals against CPAP **treated as truth**. Write the
three difference variances as `vCE`, `vCP`, `vEP`. Since `(E−C) − (P−C) = E−P`:

```
Cov(E−C, P−C) = [vCE + vCP − vEP] / 2
⟹  ρ̂ = corr(E−C, P−C) = [vCE + vCP − vEP] / (2·√vCE·√vCP)
```

Now ask the model where σ_C vanishes. With ρ(CPAP,·) = 0 and σ_C = 0: `vCE = σE²`, `vCP = σP²`,
`vEP = σE² + σP² − 2ρ σE σP`, hence

```
ρ|σ_C = 0  =  [vCE + vCP − vEP] / (2·√vCE·√vCP)
```

**The same expression.** Estimating ρ as a residual correlation against one corner held as truth forces
that corner's σ to zero — for any data, any corpus, any epoch length. Measured: the two agree to
**0.000e+0** pooled and to ≤ 6.1e-16 on every individual night, and a self-test over **200 random
triples** (data this tool did not measure, so it cannot be read as a property of the corpus) holds to
6.11e-16.

### 5.3 · What this retracts, and what it leaves standing

**§2 of this brief is wrong about the cause.** It reasoned: *"That the measured ρ lands 0.5 % from ρ_crit
is far more likely to mean the model is mis-specified for this triplet than that the physics chose that
number."* Neither. It lands there **by construction**, and the "0.5 %" was rounding — §8a reported ρ as
0.42 against a ρ_crit of 0.42199; recomputed at full precision they coincide exactly. There was never a
0.5 % gap to explain.

**What still stands, and is now better founded:** σ(CPAP) is **not identifiable from this triplet** —
§3's second box reached that conclusion from the sensitivity (±0.0031 of ρ needed to pin σ to ±0.1 bpm)
and it is right, but the sharper statement is that *no ρ measured this way carries information about
σ_CPAP at all*. The estimator, the refusal path and `rhoCrit` are all sound and are untouched by this;
the known-answer recovery to 1e-6 on six planted triples is unaffected, because there ρ is **planted**,
not estimated from the residuals.

**What a non-circular ρ would have to look like:** it must come from outside the triplet's own residuals
— a mechanism argument (R3 already establishes ECG and PPG are both RSA, so they are mechanistically
correlated *a priori*), a fourth corner, or an independent pairing. Any ρ derived from these three
series with one of them held as truth is this identity again wearing different variable names.

### 5.4 · One number that did not reproduce, recorded because it matters

**§8a's variances no longer reproduce.** §8a's ρ = 0 row implies `vCE ≈ 8.91`, `vCP ≈ 11.57`,
`vEP ≈ 11.91`; measured today they are **16.43 / 17.96 / 13.02**, and the pooled ρ is **0.622**, not
0.42. The corpus and the respiration estimators have both moved since 2026-08-04 (`d987cdc2` is the
most recent estimator change). Only σ(PPG) at ρ = 0 survives unchanged, at 2.70.

This does not weaken §5.2 — the identity is algebraic and holds for **any** variances, which is exactly
why it is worth stating as an identity rather than as a corpus result. But it does mean **§8a's specific
table should not be re-quoted**: re-run the tool.

### 5.5 · Follow-up

The identity deserves a suite assertion in the `analysis-stats · rho-crit` group, so that nobody
re-derives a "measured ρ" this way again. It is **not** in this PR: `tests/dex-tests.js` is being
modified by a concurrent work-unit, and a two-line insertion there is exactly the conflict
`CLAUDE.md` §2c warns costs a test group. It lives as a self-test inside
`tools/tch-per-epoch-rho.mjs` meanwhile, which runs on every invocation and fails the process.
