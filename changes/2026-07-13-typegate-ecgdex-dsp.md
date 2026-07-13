<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ECGDex, tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate ecgdex-dsp.js in checkJs (D.2): 13 namespace/sibling globals declared in a new node-scoped ecgdex-globals.d.ts (ECGDSP/ECGDex own attaches kept byte-stable for the ecgLoadOwnExport marker gate, plus the consumed ECGMorph sibling), and 2 genuine internal casts (a tuple annotation on the walk-cadence zoneDef literal, and `_relBase` on an accel array) — comment-only. Export-inert re-bundle of ECGDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved.
