<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: OXYDEX-SPO2-SERIES-2026-07-31-BRIEF.md
---
`IntegratorDSP.desatOnsetsFromSeries` — a **timing fiducial** over `timeseries.spo2`, deliberately not OxyDex's clinical `desat_event`.

`desat_event` is artifact-gated and thresholded to the ODI drop (~7–15 a night) because ODI must be a defensible index. Timing wants the opposite trade: many well-localised edges, shallower ones kept. Apnea→desaturation transit resolved **3 nights of 39** off `desat_event` and **9 of 39** off this.

**It also corrects the number.** The ad-hoc rule this replaces — written in an analysis script, ungated — stamped the *window start*, roughly 24 s before the descent began, and a 29 s median was quoted on its authority. The gated detector walks back to the top of the descent: **median 53 s, IQR 51–57 s** (was 18–52), zero physiologically impossible values.

Two guards earn their place: a hole **breaks the window** rather than being interpolated across (a dropout spanning a recovery would otherwise manufacture a fall from the pre-gap value to the post-gap one — a desaturation that never happened, at an instant that never happened), and the scan **resumes past the nadir**, since every index inside a long fall satisfies the drop test and would emit one desaturation dozens of times.

11 assertions, including that the same drop *without* a hole is still detected — so the guard cannot be always-off.
