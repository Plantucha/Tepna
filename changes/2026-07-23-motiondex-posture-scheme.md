<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [MotionDex]
brief: none
---
Classify body position in MotionDex `classifyGravity` with the ECGDex/PPGDex fixed-threshold, Z-first scheme (|uz|>=0.7 supine/prone, else |uy|>=0.55 upright, else lateral) instead of the divergent argmax/Y-priority scheme, so the same torso ACC no longer over-reports supine across the intermediate-tilt band (deep-audit finding H).
