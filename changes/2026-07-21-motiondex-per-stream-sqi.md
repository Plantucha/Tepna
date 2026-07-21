<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [MotionDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
MotionDex signal quality is now per-stream. `compute` measured one SQI on the posture/chest source
while the actigraphy metrics (immobileFrac, movementIndex, activitySeries) are derived from the WRIST
acc, so a flatlined wrist under a clean chest read high confidence while the movement numbers were
garbage. `sqi` still qualifies the posture/chest source (and the posture_change event conf); a new
additive export field `motion.sqiActivity` qualifies the wrist stream the actigraphy is computed from
(equal to `sqi` on a single-stream night, by construction). Also corrected the compute() comment that
claimed actigraphy prefers the chest sensor. Additive/back-compat (MINOR); synthetic golden
regenerated (motion.sqiActivity 0.97); gated with a clean-chest/flatlined-wrist per-stream group.
