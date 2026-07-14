<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [GlucoDex]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
GlucoDex: exclude long-gap interpolation (`FLAG.GAP_LONG`) from EVERY distribution metric, not just the headline TIR family. CONGA/MODD/GVP/MAG/ADRR/postprandial/dawn/nocturnalHypo/daypart/excursions/AGP/per-day all now route through one `_ana()` predicate — so a multi-hour sensor-change gap can no longer inflate surfaced variability or fabricate `nocturnal_hypo` events off an interpolated line (DEEP-AUDIT-2026-07-14 §1). A metamorphic gate (gapped ≠ explicitly-filled gvp) locks it. The real-recording GlucoDex fixture's `daypart` block moved as a result — every `n` drops, because interpolation is no longer counted as measured glucose — and was regenerated; the synthetic golden, which carries no long gap, stays byte-identical.
