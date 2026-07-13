<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [HRVDex, tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate hrvdex-dsp.js in checkJs (D.2) — the first non-free DSP: cast two `.checked` DOM reads to HTMLInputElement (export-inert), add shared spine DexKernel/DexUnits to dex-globals.d.ts, and declare the hrvdex UI-sibling reach-ins in a new node-scoped hrvdex-globals.d.ts. Export-inert re-bundle of HRVDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved.
