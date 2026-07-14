<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, tooling]
brief: none
---
Gate a lead-faulted H10 corner in the sensor-trio σ solve: a bad ECG lead for a whole night yields a large positive σ_h10 that TCH reports honestly but that is not a device σ (2026-06-12: σ≈9.5 bpm, decorrelated from both partners while O2·Verity still agree), silently inflating the H10 aggregate. A pure `h10FailureClass()` (sibling of the Verity gate) fingerprints it — σ>5 AND rHO,rHV<0.5 AND rVO≥0.5 — and nulls ONLY the H10 corner (its independent error cancels out of the O2/Verity estimates), keeping the night; both real-night lanes (`sensor-trio-worker.js`, `sensor-trio-power-analysis.js` loadReal) and a nulled corner's bootstrap CI are now point↔CI consistent, fixing the neg-night cosmetic where a nulled h10 still reported a CI.
