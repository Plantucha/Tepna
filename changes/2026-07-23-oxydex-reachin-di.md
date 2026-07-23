<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [OxyDex]
brief: ESM-MIGRATION-FOLLOWUPS-II-2026-07-16-BRIEF.md
---
Invert oxydex-dsp's DSP→UI reach-ins to dependency injection (FOLLOWUPS-II item 3): the DSP now calls injected `_ui.*` hooks (setStatus/setProgress/renderAll/showError/upVO2category) the UI modules register via `OxyDex.setHooks`, never bare page globals — export-inert (none in the compute golden path), reach-in allow-list emptied (both nodes now inverted), oxydex-globals.d.ts reduced.
