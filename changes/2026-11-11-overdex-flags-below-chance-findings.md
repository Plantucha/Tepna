---
bump: patch
type: fixed
brief: INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md
---

OverDex titled a below-chance finding "Confirmed Apnea Event" although the Integrator's null model does not assert it. The page now labels such a finding a candidate and says why.

The apnea index tile now states its null-model expectation when it is muted. The overlap tile reads "overlap, ≥2 nodes", because the value counts merged minutes where two recordings coincide. The HRV consensus line now splits the divergence into RMSSD and SDNN. The motion fold note no longer calls the Verity an arm sensor.

The change is render-side in `overdex-app.js`, so no Integrator export moves.
