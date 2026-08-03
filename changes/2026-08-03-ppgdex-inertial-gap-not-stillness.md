<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [PpgDex]
brief: MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md
---
An inertial gap no longer reads as stillness in PpgDex — `motionIndex`/`magInterference` are tri-state, unmeasured epochs leave the confidence denominators, and a confidence whose driver was never measured is null instead of a phantom 1.0.
