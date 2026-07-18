<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, ECGDex, MotionDex]
brief: MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md
---
Surface respiration rate for the first time by fusing independent estimates — the Integrator now reads ECGDex's RSA/EDR `hrv.frequency.respRate` (computed and exported all along, but never consumed) alongside MotionDex's chest-ACC estimate, publishing every source plus the spread so a between-method disagreement is reported rather than averaged away.
