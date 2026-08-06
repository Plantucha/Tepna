<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: O2RING-PHASE4-PREMISE-REVIEW-2026-08-06-BRIEF.md
---
Phase 4 was opened and deliberately not started; the review found a live defect worth more.

`O2PPG_FS_DEFAULT` has not been the timebase since CAPTURE-HOST-DEEP-AUDIT §A3 — `O2PpgGrid._re_estimate`
slews the step toward the observed rate, confirmed by per-night convergence over 17 nights. So the
constant change is a better starting guess, not a structural fix. "Strip markers at capture" would be
lossy and ~7% wrong, because `ppgdex-dsp.js` applies an isolation test precisely where a genuine 156 is
indistinguishable by value. The measured residual is an 8.00 ms slot per marker (23796 markers, 144
rows/beat on a 3.67M-row night) — a sawtooth locked to the heart rate that does not accumulate and has
not been shown to move an HRV number.

The live defect: `ppgdex-dsp.js` warns that closure, the three-cornered hat and PAT all accept a
drawn-axis leg. Closure was since guarded (WEARABLE-HOST-AXIS-FOLLOWUPS §F3) and the offline tools learnt
the rule, but the SHIPPED `_tchHat` still filters only on series length, and `pat-gate.js` /
`pat-feasibility-worker.js` have zero mentions of `timingSource`. That is the same failure mode that made
six nights of three-source closure fail "with all legs confident".

Docs only — no code, no bundle, no fixture.
