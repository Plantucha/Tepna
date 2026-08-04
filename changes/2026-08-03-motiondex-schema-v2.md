<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [MotionDex]
brief: EXPORT-HARDENING-FOLLOWUP-BRIEF.md
---
MotionDex declares schema version "2.0" as a string like the rest of the fleet — the numeric `1` it shipped mislabelled an already-v2 payload and short-circuited the validator's unknown-major guard.
