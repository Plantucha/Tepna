---
bump: patch
type: changed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`cgm-hrv-coupling.html` is re-cut under `cohort-gen 2.0`. Every conclusion holds; one correlation moved.

Third of the six papers. Numbers from one run of `tools/analysis-rerun.mjs --paper-scale` at 6,000
patients (9 min).

| quantity | published (1.9) | measured (2.0) | |
|---|---|---|---|
| patient-nights | 48,471 | **48,471** | identical |
| within-patient coupling r | −0.11 | **−0.107** | unchanged |
| coupling partialled on AHI | +0.01 | **+0.01** | unchanged |
| rMSSD ↔ AHI | −0.32 | **−0.319** | unchanged |
| **glucose ↔ AHI** | +0.42 (+0.41, +0.42) | **+0.427 (+0.420, +0.435)** | **moved** |

This is the second paper whose stable quantities are **full-cohort correlations** rather than variance
ratios — the same pattern as `hrv-age-confound` and the opposite of `nights-icc`, whose ICC moved
0.75 → 0.92. Three papers in, the discriminator holds: 2.0 reshapes the severe tail, so statistics
that *are* a between-subject spread move and statistics that average over the cohort do not.

## ⚠️ Figure 1 was deliberately NOT regenerated, and the paper says so twice

The published composite is **not** a screenshot of the page — it is an externally assembled montage of
three canvases, with no card chrome, whose layout parameters are recorded nowhere.

I tested the obvious mechanism rather than assuming it: the three canvases *do* sit in the page's
`.grid`, but that element measures 1132×1129 (aspect **1.003**) at every viewport from 1280 px up,
while the published figure is 909×518 (aspect **1.755**) and carries no headers. So an element
screenshot demonstrably does not reproduce it, and a re-stitch to a *guessed* layout would alter a
published figure's appearance for no reason anyone asked for.

The consequence is disclosed where a reader will actually meet it — in the **figure caption** as well
as the revision note — because the figure's bars read `+0.42` where the text now reads `+0.427`. An
undisclosed mismatch between a figure and its own paper is worse than a figure that is openly one
version behind.

The driver's inventory records the tested negative and asserts it (`figureElement` must be absent for
this tool), so the next session does not re-derive it. The `figureElement` capture path itself is kept
— it is correct for a page whose published figure *is* its rendered layout; this simply is not one.
