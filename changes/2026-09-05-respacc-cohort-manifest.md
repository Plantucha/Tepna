<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: PAPERS-ROADMAP-2026-06-24-BRIEF.md
---

`resp-acc-headless.mjs --figures` now writes `cohort-manifest.json` beside the figures: the night list
with the stage each night reached, the staged input set, and the page's own inclusion-rule text quoted
verbatim. A published n becomes checkable in both directions — which nights produced it, and which were
dropped and where. Building it exposed a labelling bug in the clock table, fixed here: the no-lock branch
rendered `d.name.slice(-22)`, one character short, so every no-lock night displayed as
`0260611_173042_ACC.txt` and could not be joined back to its file.
