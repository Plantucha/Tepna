<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF.md
---
Enforce badge-by-construction on `integrator-render.js` (OWN-THE-BUILD Part C) — it is already compliant (its `kpi()` tile leads with `evBadge()`), so it joins `BADGE_ENFORCED` test-only with no re-bundle, and is wired into `env.sources` in both runners; the badge gate now reds if any fusion-layer value tile is emitted unbadged. Remaining Part C render/app/profile files await their next on-touch re-bundle.
