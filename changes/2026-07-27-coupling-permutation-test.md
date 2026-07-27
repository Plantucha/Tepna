<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
`apneaCoupling.real` — documented in the fusion export as "the rigorous verdict" — was `usable && lift > 1 && observedPct > chancePct`, which is not a test at all: `chancePct` IS the mean of the circular-shift surrogate distribution, so under the null "observed exceeds chance" is a fair coin. Measured through the shipped path, it fired on 47.5% of genuinely independent desat/surge streams. It is now the exact one-sided permutation p-value against the window's own surrogates at α = 0.05 (Phipson & Smyth +1/+1 correction, so p can never be reported as 0), and the block publishes `pPerm`, `pFloor` and `alpha` alongside it. Because p can never fall below 1/(shifts+1), the Integrator now buys the surrogates its claim needs — 80 rather than the primitive's default 10, which floors p at 0.091 and could not support an α=0.05 verdict at all — and enough of them that three extreme surrogates cannot veto a real coupling, which matters because the module's own resonance caveat describes how one shift can re-phase onto stream B's period. Specificity 47.5% → 2.5%; a planted coupling is still called real, so this is a calibration, not a mute button.
