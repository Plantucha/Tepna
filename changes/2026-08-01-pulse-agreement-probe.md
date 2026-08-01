<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex]
brief: OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md
---
Add `tools/pulse-agreement.mjs` — and record that §3 is NOT answered: 5 of 6 finger nights share zero overlapping samples with their vendor pulse file.

`patch`, tool + docs only; no runtime code touched. The tool deliberately SKIPS a night it cannot
window-match rather than falling back to a whole-night median, because that fallback produced a
publishable-looking Bland-Altman from series covering different spans.
