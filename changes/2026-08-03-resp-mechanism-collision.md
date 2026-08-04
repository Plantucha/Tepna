---
bump: minor
type: fixed
nodes: [Integrator]
brief: TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md
---

Integrator respiration fusion no longer calls two RSA-derived estimates "independent". ECGDex
(`RSA (ECG)`) and PpgDex (`RSA (HF-peak of RR spectrum)`) read one mechanism off the interval
series, so a mechanism-level failure — Cheyne–Stokes, an irregular or paced rhythm, a respiratory
rate below the HF band — moves both corners together and their agreement is partly tautological.
`fuseRespirationRate` now classifies each source's `respRateMethod` and publishes additive
`mechanisms` / `mechanismsIndependent`; a single-family set is flagged in the note rather than
refused, and the note re-states that the ±2 br/min band it is graded against is Ryser 2022's
chest-ACC band, measured against an independent comparator. TCH-REFERENCE-VALIDATION R3.
