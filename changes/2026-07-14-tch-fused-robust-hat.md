---
bump: minor
type: added
brief: TCH-FUSED-ROBUST-HAT-2026-07-14-BRIEF.md
---
Fused-weight artifact-robust three-cornered hat for the reference-free σ tools. ECGDSP/PPGDSP gain
`beatConfidence` (per-second density × SQI trust, AF-safe) + `ECGDSP.hrConfidence`; the sensor-trio
worker carries per-corner confidence and the sigma hat solves via `tchSigmasFused` (weighted-variance
TCH + gentle consensus floor), so a transient single-corner artifact no longer detonates the variance
estimator (the 2026-06-12 spurious-QRS burst inflated σ_H10 ~1.5→9.6 bpm). Ground truth: recovers the
planted σ exactly, unbiased, O(n), no corpus-tuned constant. Additive DSP exports (unwired in the node
paths ⇒ ECGDex/PpgDex outputs unchanged); the fused hat is a behavioral change to the analysis tools only.
