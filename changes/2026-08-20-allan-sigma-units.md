<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, PpgDex, Integrator]
brief: CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md
---
Publish the Allan σ fields in ppm and stop rendering a rate as milliseconds — PpgDex showed σ_y(τ) to the user as "ms disagreement" when it is ms/s, understating the long-τ card by a factor of τ.
