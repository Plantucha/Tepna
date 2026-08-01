<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: EXPORT-PATH-UNREACHABLE-FOLLOWUPS-2026-08-01-BRIEF.md
---
Red an unguarded render-coverage leg instead of letting its empty-app-satisfiable predicate pass.

Audited every leg against its own predicate on the bare bundle: `renderCoverageApp`'s token/label
settle is satisfiable with NO data for GlucoDex (16 tokens vs `minNums` 15, all four labels matched in
its own help text) and PpgDex (17 vs 12), and HRVDex clears by a single token. The parent's
`#exportBar.show` settle guards all six generic legs today, so the remaining hole was the next leg
added without one — that now fails loudly. The three bespoke legs (ECGDex value cells, CPAPDex
revealed results view, IntegratorPB named finding) were audited and are sound.
