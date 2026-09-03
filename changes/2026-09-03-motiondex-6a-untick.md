<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [motiondex]
brief: MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md
---
The §6A attribution box stayed `[x]` while the Status header had said "§6A's attribution box is UNTICKED"
since 2026-09-02 — a header corrected without its body, which is the same shape the correction was about.
The box's second clause is false: the node export omits `respRateMethod` and the Integrator hardcodes over
it, so the fusion cannot attribute a MotionDex rate to the estimator that produced it.
