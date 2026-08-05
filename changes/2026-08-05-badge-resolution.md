<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex, ECGDex, suite]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
Four surfaced numbers rendered an evidence tier no registry assigned: OxyDex's Mean/Min SpO₂ and Perfusion Idx (all graded `measured`) and ECGDex's "PLV surge vs base" (`emerging`, and graded correctly by CPAPDex, the borrowing node). All four now resolve to their declared grade — by naming the metric at the call site, and by letting a registry entry's own `label` resolve to its id. Extending the same check to the render helpers measured 97 such labels fleet-wide; only 3 had a derivable grade, so the remaining 94 are published and RATCHETED rather than given invented tiers.
