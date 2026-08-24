<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: CPAPDEX-LIVE-SD-COMPARATOR-FOLLOWUPS-2026-08-24-BRIEF.md
---
Comparator visual-smoke fixes (from the coordinator's §1 pass): the injected KPI cards no longer render invisible — `.kpi`'s `cardEntrance` `from{opacity:0}`+`both` fill left dynamically-injected tiles stuck transparent under `prefers-reduced-motion`, fixed by scoping `#comparatorHost .kpi{animation:none}`; the streamed-vs-logged divergence now counts against the Bland–Altman LoA (`bias ± 1.96·SD-of-diffs`) instead of a residual-SD band applied to raw diffs, so a near-identity twin reads 0% outside the band instead of 33.7%; and the scale-over-time sparkline no longer overlaps its label. Adds a synthetic partial-overlap regression twin locking the `[max(t0),min(end)]` intersection geometry a real field night (BLE extends past the SD boundary) exercised.
