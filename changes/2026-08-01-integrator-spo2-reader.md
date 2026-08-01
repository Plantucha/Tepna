<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: OXYDEX-SPO2-SERIES-2026-07-31-BRIEF.md
---
The Integrator now reads **`timeseries.spo2`**. OxyDex started emitting SpO₂ at 1 Hz, but nothing consumed it — `adaptEnvelopeNode` read `timeseries.epochs`, `.acc` and `.cells`, and the oximeter's primary signal still could not reach the fusion. A producer with no consumer is half a change.

Carried, not resampled: `series.spo2 = { hz, t0Ms, values[] }` on the uniform grid the node emitted, so a consumer derives an absolute stamp by index. Verified on a real export — **26,546 samples, 98.7 % non-null**, epochs unchanged alongside it.

`null` stays `null`. A second the device never reported is not `0` (the most severe desaturation physically possible) and not the previous value (which reads as stable oxygen through a dropout); a non-finite entry becomes an explicit hole rather than a NaN that propagates silently. An export predating the field carries **no** series rather than an empty one a consumer would read as "measured, and flat".
