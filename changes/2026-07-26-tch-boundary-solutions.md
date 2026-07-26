<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [integrator]
brief: none
---
tch-multinight folded boundary solutions into its median sigmas. When the classic three-cornered-hat split goes negative the kernel falls to a search for the minimum rho that restores non-negativity, which by construction puts one member exactly on zero — printing sigma 0.01–0.06 bpm, i.e. "this sensor is essentially perfect", when the truth is that the estimator's assumption failed and that member's error cannot be separated at all. Those nights are now reported and counted but excluded from the distribution. The test is the METHOD, not the `negative` flag: an externally-supplied rho lands interior and is a real rescue, which the synthetic known-answer corpus is built on.
