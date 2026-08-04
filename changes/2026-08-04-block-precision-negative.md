<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator, suite]
brief: JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md
---
Close the per-block precision box with a double negative — removing within-block drift does not tighten the per-block offsets and neither does lengthening blocks (scatter is flat at 412/359/379 ms while concentration rises 0.47/0.50/0.58), so the residual is a per-night property, not an estimator knob.
