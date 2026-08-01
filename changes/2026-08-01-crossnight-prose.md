<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md
---
Correct `integrator-longitudinal.js`'s claim that every node emits a crossnight envelope — five of eight do — and gate the claim against the producer set.

`patch`, comment + test only; no behaviour changes. `computeHash` still moves (the closure is a denylist,
so an unknown asset counts as compute), so the fixture was re-verified rather than asserted inert.
