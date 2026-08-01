<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex]
brief: OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md
---
Add `tools/pb-operating-point.mjs` and record what the periodic-breathing detector actually tracks — hypoxemia burden (r = 0.893), not periodicity.

`patch`, tool + docs only; no runtime code touched. The emission threshold has no citation and the gate
has no cycle-length criterion, so the over-call cannot be tuned away — the shape is wrong, not the number.
