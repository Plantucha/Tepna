<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [CPAPDex, tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate cpapdex-dsp.js in checkJs (D.2): 5 cpap realm globals + the Node builtins require/process declared in a new node-scoped cpapdex-globals.d.ts, plus 3 comment-only source casts — the two require() call sites (so tsc does not resolve the sibling modules and cascade TS2306) and one boolean-subtraction in a sort comparator. Export-inert re-bundle of CPAPDex (orchestrators don't co-load it); GATE A/B green, no fixture output moved.
