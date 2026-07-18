<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, MotionDex]
brief: MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md
---
Register MotionDex as a first-class Integrator node and feed its body-position track into positional-OSA labelling — `posture_change` run-length events expand hold-last-value into the shared posture series, and `labelPositionalApnea` gains `motion-acc` as a source ranked below the chest strap (uncalibrated frame) but above limb ACC.
