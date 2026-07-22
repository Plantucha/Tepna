<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [MotionDex]
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---
Replace MotionDex's respiratory-rate estimator with spectral ridge tracking. The shipped
zero-crossing rate was measured at **MAE 3.59 br/min** against a real ResMed CPAP `Flow.40ms`
breath-by-breath reference over 26 nights / 172 h / 19,193 epochs — *worse than predicting a
constant* (1.50). Its dominant defect was the band-pass: `x − MA(10 s)` then `MA(1.5 s)` is a
difference of boxcars whose peak gain sits at 0.137 Hz (8.2 br/min) with a −3 dB band of
≈0.077–0.235 Hz, so a true 16 br/min (0.267 Hz) rate falls outside the passband and the estimator
locks onto its own filter edge.

The replacement band-passes the three acceleration axes (0.13–0.50 Hz, 4th-order Butterworth,
zero-phase), sums per-channel normalised periodograms, applies a spectral high-pass taper, blends in
a time-domain zero-crossing estimate, and decodes the rate by Viterbi ridge tracking with a
per-epoch confidence. **MAE 1.01 br/min** (95% CI 0.91–1.12), 91.6% within 2 br/min at full
coverage; 0.56 / 97.8% at 70% coverage — the reference channel's own noise floor. Runs in 0.17 s
per night.

Additive to the export contract: `rateSeries`, `rateEpochSec`, `rateCoverage`, `respRateMethod` and
`rateBrpmLegacy` are new; every legacy field (`rateBrpm`, `nBreaths`, `amplitudeG`, `series`,
`cadenceSec`, `floorG`, `hz`) is unchanged, and `rateBrpm` now carries the better number under the
same name. `respRate` moves to the `emerging` tier — real-corpus validated but single-subject, which
does not meet the Literature-Use Policy bar for `validated`.

Two constraints recorded so they are not over-claimed later: an explicit tilt-angle channel is
provably redundant with the band-passed raw axes (measured spectrum correlation +1.000), and
**posture robustness is untested** — the validation corpus has gravity-roll IQR 13.1–17.9°, i.e. one
posture, so Doheny's supine-vs-lateral effect could not be replicated by absence of exposure. The
corpus bias constant (+0.58 br/min) is documented but **not applied by default**: it is
subject-fitted, and a synthetic known-answer test showed it makes a clean 15 br/min signal read 15.7.
`synthetic_motiondex_golden.node-export.json` moved `motion.respRateBrpm` 14 → 15.1 (synthetic truth
is 15) and was regenerated via `tools/regen-motiondex-goldens.mjs`.
