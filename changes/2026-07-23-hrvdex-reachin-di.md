<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [HRVDex]
brief: ESM-MIGRATION-FOLLOWUPS-II-2026-07-16-BRIEF.md
---
Invert hrvdex-dsp's DSP→UI reach-ins to dependency injection (FOLLOWUPS-II item 3): the DSP now calls injected `_ui.*` hooks the UI modules register via `HRVDex.setHooks`, never bare page globals — export-inert (headless defaults reproduce the golden), reach-in allow-list emptied, hrvdex-globals.d.ts reduced to the permanent namespace attach.
