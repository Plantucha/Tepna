<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [MotionDex, Integrator]
brief: MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md
---
Motion-gated HRV: MotionDex exports a tri-state per-epoch movement track (`motion.activitySeries`, rendered standalone as a movement timeline) and the Integrator's `gateHRVByMotion` scores each HRV consensus block's window for stillness — an additive confidence annotation that alters no HRV value, with not-recording epochs excluded from the denominator rather than counted as still.
