<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [GlucoDex]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
GlucoDex: exclude long-gap interpolation (`FLAG.GAP_LONG`) from EVERY distribution metric, not just the headline TIR family. CONGA/MODD/GVP/MAG/ADRR/postprandial/dawn/nocturnalHypo/daypart/excursions/AGP/per-day all now route through one `_ana()` predicate — so a multi-hour sensor-change gap can no longer inflate surfaced variability or fabricate `nocturnal_hypo` events off an interpolated line (DEEP-AUDIT-2026-07-14 §1). Export-inert for the committed fixtures (no GAP_LONG in them; the synthetic golden stays byte-identical); a metamorphic gate (gapped ≠ explicitly-filled gvp) locks it.
