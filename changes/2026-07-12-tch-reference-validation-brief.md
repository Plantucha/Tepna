<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md
---
Validate the three-cornered-hat σ estimator against a TRUE reference for the first time — it is blind to bias, and its independence assumption does not hold.

The σ programme exists *because* there is no reference, so the estimator has never been checked. CPAP's
PLD channel writes measured respiration from a calibrated flow sensor, so the quad-modal nights finally
provide one. Over 67 epochs / 11 nights, TCH fails two ways that are invisible without truth: it is blind
to **bias** by construction (ECG under-reads respiration by 1.35 br/min), and its **independence**
assumption is violated (ρ = 0.42 between the ECG and PPG error terms — both read the same RSA proxy with
the same estimator), which makes it rate a calibrated flow sensor as noisy as an RSA-derived estimate. The
repo's correlated solve cannot fix it: its `rho` is a single common-mode term across all three pairs.

Complements `TRIO-ARTIFACT-GATE-AND-N15-POWER` (TCH is not robust to artifact, diagnosed by
implausibility); these are different failure modes and they stack. Docs + tool only.
