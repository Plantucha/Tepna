<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [OxyDex]
brief: OXYDEX-SPO2-SERIES-2026-07-31-BRIEF.md
---
OxyDex now exports **SpO₂ at its recorded 1 Hz** — `timeseries.spo2 = { hz, n, values[] }`, a uniform grid from `recording.startEpochMs`. It exported SpO₂ nowhere before: the whole timeseries block was 89 five-minute epochs of `{hr, motionIndex}` for a night containing ~26,500 samples, a **~300× reduction applied at the export boundary, not by the sensor**. Measured on 2026-07-26: 26,546 samples, 98.7 % non-null, **298× the epoch count**.

Additive — `epochs` is untouched (`adaptEnvelopeNode` reads it), and the block is absent rather than empty when it cannot be built. A second the device never reported is `null`, never `0` (which reads as the most severe desaturation possible) and never carried forward (which reads as stable oxygen).

1 Hz is kept even though it is measurably oversampled on this corpus — 6.5 % of adjacent seconds differ, median identical-run 8 s, 2 s bins would cost ≤1 percentage point — because that bandwidth is one subject, one oximeter, one night, and baking a bin size into an export contract would silently degrade any faster patient or better device.

No committed fixture carries a timeseries block, so nothing moved — which is why `oxyBuildSpo2Series` is exposed and gated with 11 assertions rather than trusted to a green suite that never ran it.
