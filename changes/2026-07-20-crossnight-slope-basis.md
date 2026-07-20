<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [OxyDex, CPAPDex, ECGDex, PpgDex, PulseDex, Integrator]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
A cross-night trend no longer ships a per-RECORDING slope under the per-day name. When even one
item in a series lacks a date, no per-day rate exists: `slopePerDay` is now null, the index slope
keeps its own honest name (`slopePerRecording`), and a new `slopeBasis` field says which quantity
the consumer is holding. Previously the index slope was assigned straight to `slopePerDay` and
rendered with a `/d` suffix — a 12-recording series spanning 90 days reported its per-recording
change as a daily one, ~7.5x overstated and always in the alarming direction. Fixed in all five
cross clones; the crossnight envelope and the ECGDex trend table carry the basis through.
