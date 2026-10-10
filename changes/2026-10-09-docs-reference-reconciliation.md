---
bump: patch
type: fixed
---
Reference-doc reconciliation: align three documented values with their code definitions.

- OxyDex Reference: ODI-4 grade bands 4-tier → 3-tier. Code (oxydex-render.js:2137)
  uses `<5 good, <15 warn, ≥15 bad`; the ≥30 Severe tier exists nowhere in code.
- PulseDex Reference: CRS formula `(Coh·rMSSD·pNN50)/Stress×1000` →
  `(Coh·rMSSD·pNN50)/(Stress×1000)`. Code (pulsedex-dsp.js:265-266) divides by
  (Stress×1000); the doc was off by 10⁶.
- HRVDex Reference: VO₂max constant 15 → 15.3. Code (ecgdex-profile.js:182-184,
  hrvdex-dsp.js:782, hrvdex-profile.js:89,585, ppgdex-profile.js:164) uses 15.3
  (Uth–Sørensen 2004) everywhere.

ODI formula, 5–15 Hz band-pass, and PulseDex EFC composite verified MATCH —
no changes.
