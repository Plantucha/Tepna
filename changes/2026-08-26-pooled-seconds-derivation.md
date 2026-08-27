---
bump: patch
type: added
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

`SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` §10 — the pooled-seconds hat is **derived before any code is
written**, and the derivation answers the question that decides the unit's size.

The three-cornered hat is **linear** in the pairwise variances (`σ_A² = ½(V_AB + V_AC − V_BC)`), and a
variance pooled over nights decomposes as `V_pool = Σ w_n·Var_n + [Σ w_n·μ_n² − (Σ w_n·μ_n)²]` —
seconds-weighted within-night plus a **between-night bias** term. So the solve commutes with any linear
pooling: *pool then solve* ≡ *solve then seconds-weighted-mean*. **A median is not linear**, so
median-over-nights fails to commute *and* drops the between term — it differs for two independent
reasons, which is the formal content of `tch-fused-corpus.mjs`'s printed caveat.

Verified in source rather than assumed: `sigma-no-reference-analysis.js:412` concatenates **per-second**
differences across all windows; `AnalysisStats.blandAltman` takes the SD over that whole array against
one global mean, so it is a true pooled variance (within + between), seconds-weighted by construction —
not an average of per-window SDs, which would have invalidated the composition. `analysis-stats.js`
carries `module.exports`, so the kernel is Node-importable and the analysis-tools-inline trap does not
apply to it; `tools/tch-fused-corpus.mjs` already folds the corpus in Node.

**Consequence: the assigned unit is plumbing + validation + attribution, not estimator design.**

It also yields a falsifiable account of the σ_Verity spread (1.42 / 3.51 / 0.94–1.03), which is the real
deliverable — explain the three, don't mint a fourth. The gap between estimators over the same nights is
predicted exactly as `½(B_AB + B_AC − B_BC)` with `B_XY` the across-night variance of the pairwise bias,
and three weighting choices are in play (equal-night median, seconds-pooled, per-second confidence).
Thresholds are **pre-stated**: the attribution holds only if the predicted gap matches the observed one
in sign and within uncertainty; a real-but-too-small between term is a partial answer and must be
reported as one, with the residual named.
