---
bump: patch
type: changed
brief: CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md
---

Three of four Done-when items answered on the 2026-08-13 clock-leg sign disagreement. **The
contradiction is real** — it is not the unwrap, not a fragment mismatch, and not an artifact of leg C's
uncertainty once that uncertainty is actually measured.

- **Hypothesis 1 (unwrap/aliasing) REFUTED.** `legC` picks a whole-RR wrap once at block 0 then tracks,
  so only a mid-night slip can invert a sign. There is none: total lag change **−0.187 RR** over 270 min,
  largest single step **0.29 RR** (below the ½-RR ambiguity threshold), and the end-to-end rate (−12.6)
  agrees with the reported median-of-pairs (−14.6).
- **Hypothesis 2 (fragment mismatch) REFUTED.** The exact files leg C used — starting 15 s apart, spanning
  285.5/285.9 min — give H10 **−20.1** and Verity **−26.4** vs host, a fragment-matched prediction of
  **+6.3 ppm** against the median-based +6.5. Same interval.
- **Leg C's uncertainty is unreported AND autocorrelated.** The tool prints a bare ppm. Fitting the
  tracked series: residuals wander with **ρ₁ ≈ 0.70** on two of three nights, so effective n collapses
  (36 → 6.2) and a naive OLS SE understates by up to **2.4×**. Anyone quoting leg C's ppm should quote an
  autocorrelation-corrected CI; the block count is not the sample size.
- **The disagreement survives at 3.94σ.** With both sides' uncertainties, 08-13 is −13.5 vs +6.3, diff
  −19.8, σ_tot 5.03. By contrast 07-20 is consistent at 0.27σ and 08-09 marginal at 2.04σ — so the
  disagreement is **night-specific, not systematic**, which is the sharpest constraint on any remaining
  explanation.

Also records a correction owed to `CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT: its band set leg C's uncertainty
to **zero**, justified by the ±0.0 ppm planted-recovery selftest — but that selftest measures estimator
*bias* on synthetic data, not the variance real lag wander induces. Folding SE_C in widens the bands
(08-09: 4.16 → 4.69; 08-13: 0.71 → 7.26) and **changes no verdict**; PASS 3 / FAIL 2 stands and the
band↔verdict separation remains perfect. Reported because a correction that does not change the answer
still has to be reported.

Surviving hypotheses: a genuine mid-night device event (weakened — no step in the tracked series) and a
per-path sign convention (which must now explain agreement to 0.27σ on one night and 3.94σ disagreement
on another, from the same code path).
