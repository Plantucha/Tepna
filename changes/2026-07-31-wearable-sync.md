<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: WEARABLE-SYNC-2026-07-31-BRIEF.md
---
`IntegratorDSP.activityEnvelope` + `IntegratorDSP.alignEnvelopes` measure the clock offset **and drift (ppm)** between two body-worn accelerometers, by windowed normalized cross-correlation of accelerometer norms with lag regressed against time (Straczkiewicz 2021, doi:10.3390/s21144777; BMAR arXiv:2501.16015). `tools/wearable-sync.mjs` runs it over a capture tree, per night.

This existed nowhere: every clock estimator in the suite measured a wearable against the CPAP, and all of them assumed the wearables agreed with each other. Measured, they do not — H10 vs Verity sits **1.8–4.9 s apart (median 3.3 s) on 24 of 24 phone-captured nights, and 0.10–0.39 s on all 6 box-captured nights**. A systematic bias on one capture path, invisible for months because nothing made the comparison.

Confidence is a **concentration test**, not a threshold: a chance lag is ~uniform across the search range, so *k* of *n* windows agreeing within ±tol has an exact binomial tail. Two earlier rules are recorded in the brief because both failed — a window COUNT called two unrelated nights confident, and a usable-FRACTION rejected all six box nights that agreed to 0.2 s (most of a sleeping night has no movement to correlate).

Also fixes an NCC that could return r > 1: normalising over a whole array and then correlating a subset is not a correlation, and a similarity score above 1 cannot be tested against a null.
