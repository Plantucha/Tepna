---
bump: patch
type: fixed
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

`lagsAgree`'s 1-second default made `converged` all but unreachable on real data: measured across 48
`.dat`/`_SPO2.csv` pairs from the corpus, it accepted 22 of 37 genuine same-session matches, failing
41% of sessions that plainly are the same session.

The tolerance is now the measured `AGREE_TOL_S = 8`, the observed ceiling of same-session leg
disagreement — stable across three independent quality cutoffs that select different subsets, and
explicitly not the value that maximises convergence (20 s and 30 s score higher).

Deriving it also corrected the same-session test itself, along the lines this file already argued:
filtering on SpO2 error admits a 13626 s disagreement even at err < 0.5, while filtering on PULSE
error caps it at 8 s. SpO2 barely moves overnight, so a low mean-abs-error there is cheap at many
lags; pulse is the confirming column.

Analysis tool only; no shipped bundle changes.
