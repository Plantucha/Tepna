---
bump: minor
type: added
brief: TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md
---

`AnalysisStats.tchSigmasPairwise` / `tchSigmasPairwiseFromVars` — a three-cornered hat with a ρ PER PAIR
instead of the classic independence assumption or `integrator-tch.js`'s single common-mode ρ. Nonlinear,
solved by Newton with an analytic Jacobian; refuses rather than inventing a σ when a (variance, ρ)
combination admits no consistent triple. Known-answer self-test over 6 planted triples. Executes R2 —
and answers its second clause NO: the respiration triplet does not re-solve credibly, because ρ_crit ≈
0.422 sits within 0.5 % of the measured ρ = 0.42. Kernel only; the shipped Integrator estimator is
untouched.
