<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex, PpgDex]
brief: CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md
---
ECGDex and PpgDex now emit **`movement_onset`** — the arousal fiducial an apnea leaves on an accelerometer.

**Why.** An apnea terminates in an arousal and the body moves, and that instant is the sharpest cross-device fiducial available. Measured on the real corpus, onsets from four inertial streams (H10 chest ACC; Verity arm ACC/GYRO/MAG) independently agreed on the same CPAP clock offset to within **12 s**, where the derived event channels spanned ~90 s. None of that reached `ganglior_events`, so the Integrator's clock fit — and `trio-batch --cpap`, which calls the same function — could only see the optical-artifact proxy.

**Not the same as `motion_artifact_segment`.** That impulse is emitted per detected BEAT, so it needs the PPG still readable — and a movement large enough to matter is large enough to blind the optics. It thins out exactly where the signal is strongest. `movement_onset` reads the inertial grid directly and is independent of beat detection.

**ECGDex** derives it from chest-ACC **jerk** (`|Δ|vm||`), not `|vm|`: the vector magnitude is dominated by gravity plus the always-present respiratory chest excursion, so thresholding it marks breathing, not movement. Computed in `accExtras` rather than the staging block, which only runs when epochs *and* stages both exist — a clock fit must not lose its best channel because staging was unavailable. Threaded into `gangliorEvents` as a new **last, optional** parameter, per the back-compat rule.

**PpgDex** derives it from `analyzeMotion`, on a new **unclipped** `onsetGrid`. The published `grid` saturates at 1.0 by design — a 0–1 index for epoch reporting, where "moving hard" and "moving very hard" are usefully the same — but that clip flattens peaks into a plateau a local-maximum test cannot read.

**The duplication is gated, not tolerated.** `ECGDex.src.html` does not bundle `ppgdex-dsp.js`, and a shared module for twenty lines would mean touching every co-load list, both orchestrators and the worker `importScripts` sets. So the detector lives twice and a new **`movement-onset-parity`** group asserts both return identical output on identical input — the same discipline `registry-defs-parity` applies to a projection. A divergence reds the suite instead of two nodes quietly disagreeing about when the subject moved.

**A rejected alternative, recorded because the number is instructive.** A median+MAD threshold was tried, on the sound reasoning that σ is not robust to the very outliers being detected. On a differenced jerk grid the quiet baseline is almost zero, so MAD collapsed and the detector fired **713** times in one night against 29 for mean+3σ. Here the heavy tail *is* the signal; a threshold that ignores it is blind, not robust. Reverted, with the reasoning left in the code.

**Tests** — 10 assertions: exact parity between the two nodes; four planted movements found at their planted instants; one long turn yielding **one** onset rather than forty (isolation is a condition, not a nicety — every extra hit on the same movement is a correlated vote dressed as independent evidence); a perfectly still night yielding **nothing**, since a detector that always finds something would hand the clock fit a channel of pure noise; an empty grid and a zero `dt` refused rather than fabricating or dividing; and the minimum gap actually binding.

**Known limitation, measured not assumed.** On a real night ECGDex emits **29** onsets and PpgDex only **3** — below the fit's own `minEvents`, so the Verity's three inertial streams still do not contribute in practice. Neither unclipping nor the MAD threshold moved it, so the cause is upstream of the detector and is not yet isolated. The chest channel works; the arm channel is emitted but not yet useful. Recorded here rather than presented as four working streams.

Re-bundled ECGDex, PpgDex, OverDex and Data Unifier (the orchestrators inline both DSPs), plus the analysis pages and `docs/`, which inline them too. Gates: suite **4406 passed** / 12 skipped · `build --check` clean (11 owned) · GATE A 9/9 · GATE B 13 reproducible.
