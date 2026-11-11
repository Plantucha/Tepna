---
bump: patch
type: fixed
brief: PAT-HAT-RING-FLOOR-2026-10-04-BRIEF.md
---

The monitor's 3-hat fused and PAT fused columns opened the same page. Each column now opens its own view of PAT Classic vs Fused (`?view=hat` or `?view=pat`). That page gains styling, a per-site σ chart with 95 % CIs and per-leg window-median charts.

Both PAT pages now mark a corrected lag UNCONFIRMED when the motion check fails. They suppress a ppm rate from a fit with R² below 0.5. They give one name to the drift statistic the gate reads. They flag thin floor anchors.

The fixes are render-side only: the worker and the gate did not change, so no computed number moved.
