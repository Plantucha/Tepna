<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS-2026-07-22-BRIEF.md
---
Commit a golden for PpgDex's Integrator-facing rich export — every prior golden was the light export, so the fields the Integrator reads had no fixture at all.

`patch`: a new committed fixture plus its gate; no runtime code changed. Minted from the same committed
input as the clean twin, so the pair isolates `opts.rich`. GATE B coverage 14 -> 15.
