<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [PpgDex, tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate ppgdex-dsp.js in checkJs (D.2): PPGDSP/PpgDex attaches + the PPGMorph sibling + the ES2020 BigInt global declared in a new node-scoped ppgdex-globals.d.ts, and a single comment-only source cast on the `timeDomain(...)||{}` result (whose `{}` fallback poisoned 11 HRV-field accesses). Export-inert re-bundle of PpgDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved.
