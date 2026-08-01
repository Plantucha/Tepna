<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [OxyDex]
brief: DESAT-ONSET-FIDUCIAL-2026-07-31-BRIEF.md
---
`desat_event.meta` now carries **`onsetTMs`** and **`endTMs`**. `tMs` remains the nadir — the contract does not move.

The nadir is right for scoring and wrong for timing: a desaturation begins when saturation starts falling and bottoms out a desaturation-duration later, so anything correlating desat against another signal measured the coupling **plus that duration**. Paired on the corpus, transit from the nadir is **19 s longer** than from the onset, and that 19 s is the desaturation itself.

`startTMs`/`endTMs` were already computed and correctly stamped from the parsed rows, then discarded at the export — the same loss at the same boundary as the SpO₂ series. Verified 496/496 desat events across 36 nights.

It fixes the fiducial, **not the yield**: still 2 nights of 36, because `desat_event` is artifact-gated to the clinical ODI definition (7–15/night). Density comes from `timeseries.spo2` instead — which is the argument for exporting the series: a node that exports only its own clinical events forces every consumer to inherit a definition chosen for a different purpose.

No committed fixture carries a `desat_event`, so nothing moved and 7 assertions are the only thing defending this.
