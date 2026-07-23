<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: none
---
Make the Integrator MotionDex posture leg tri-state like effort/movement — cap `_motionPostureSeries` hold-last-value at a 60-min horizon so a single early snapshot no longer expands across a sensor-off gap to durSec end, and positionalApnea routes gap apneas to unknown++ (out of the supine/nonsupine denominator) instead of fabricating a supine positional-apnea finding.
