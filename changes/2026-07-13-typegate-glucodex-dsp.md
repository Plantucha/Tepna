<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [GlucoDex, tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate glucodex-dsp.js in checkJs (D.2): its 13 TS2339 property errors split into the node's own `global.GLUDSP`/`global.GlucoDex` namespace attaches (declared in a new node-scoped glucodex-globals.d.ts so the attach lines stay byte-stable for the source-text safety gates) and two internal inference casts (`.e`, `.events`) — comment-only. Export-inert re-bundle of GlucoDex (+ the two orchestrators that co-load it); GATE A/B green, no fixture output moved.
