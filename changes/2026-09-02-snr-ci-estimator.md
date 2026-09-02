<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis-stats]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
DEEP-AUDIT-VI F16 — the sigma-no-reference live path rendered a FUSED-hat point (per-second DSP
confidences down-weighting artifact bursts) against a CI bootstrapped from the CLASSIC unweighted
hat: two estimators, and on an artifact-flagged window the rendered σ sat entirely outside its own
rendered 95 % CI (audit repro: σ_H10 = 1.009 against [7.296, 12.801]). The confidences were not even
stored on the window.

The CI's estimator now FOLLOWS the point's, and the bootstrap is single-sourced:

- New `AnalysisStats.tchBlockBootstrapCI(hh, vv, oo, {cH, cV, cO, B, blockS, rand})` — with
  confidence arrays present, every replicate resamples them in LOCKSTEP (same block indices) and
  runs `tchSigmasFused`; without them, every replicate runs classic `tchSigmas` (the committed-TRIOS
  path, whose point is classic, keeps its consistent pairing). `rand` injectable; result carries an
  `estimator` tag.
- The page delegates (`blockBootstrapCI` is now a one-line shim; delegation-parity row extended);
  `windowFromWorker` stores cH/cV/cO on the window; `aggregate` passes them; stats.json strips them
  like hh/vv/oo.
- Known-answer legs with a pinned LCG: the audit-shaped plant (confidence-zeroed burst) shows the
  fused point INSIDE its own fused CI, and — the measured indictment of the old pairing — OUTSIDE
  the classic CI on the same data. The 6 analysis tools re-bundled.
