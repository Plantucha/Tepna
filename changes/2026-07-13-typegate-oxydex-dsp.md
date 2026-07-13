<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [OxyDex, tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate oxydex-dsp.js in checkJs (D.2) — the last DSP, completing the type gate over all 8 nodes. 9 realm siblings + 2 window state globals declared in a new node-scoped oxydex-globals.d.ts (cleared 62 of 68 errors with no source edit), plus 4 comment-only casts (FileReader-result buffer, and added-property writes/reads on desat events) run through biome format since oxydex-dsp.js is not formatter-overridden. Export-inert re-bundle of OxyDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved. Also fixed an invalid-JSON escape in the tsconfig //d2 note.
