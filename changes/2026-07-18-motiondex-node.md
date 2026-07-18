<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [MotionDex]
brief: MOTIONDEX-BUILD-2026-07-17-BRIEF.md
---
Add MotionDex — the fleet's motion / IMU node: parses Polar Sensor Logger ACC/GYRO/MAGN (Verity + H10) on the Clock Contract and computes body position, actigraphy, respiratory effort, and motion SQI; exports ganglior.node-export (node:"MotionDex"). Owned plain-inline ESM-from-birth bundle with full gate coverage incl. a committed-synthetic equiv leg.
