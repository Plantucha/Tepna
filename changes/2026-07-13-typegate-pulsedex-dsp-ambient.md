<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [tooling]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Gate the first DSP (pulsedex-dsp.js) in checkJs via a new ambient dex-globals.d.ts for the co-loaded globals — zero source edit, zero re-bundle churn.
