<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: none
---
Give the analysis-page statistics a regression net (TEST-COVERAGE-ANALYSIS 2026-07-15). The standalone `*-analysis.html` research tools produced the numbers cited in the σ + validation papers, yet their reliability / agreement / correlation / regression / change-point kernels were covered ONLY by the static "self-contained" gate — nothing executed the math, so a sign error in the three-cornered-hat solve or a between/within swap in the ICC would have shipped a plausible-but-wrong figure with every gate green. Single-sourced those kernels into `analysis-stats.js` (`window.AnalysisStats`: ICC(1,1)+ANOVA, Spearman–Brown, three-cornered-hat, Bland–Altman, Pearson/pearsonCI, partial correlation, simple + matrix OLS with inference, ROC/AUC, change-point) — each lifted VERBATIM (divergent `pearson` variants kept distinct, never merged). The six pages now delegate to it (each aliases the kernel it needs under the same local name, so behavior is preserved by construction) and re-bundle self-contained. Added the Node-lane `Analysis-page statistics kernels — known-answer` group in `tests/dex-tests.js`: hand-computed known answers for every kernel plus a delegation-parity leg asserting each page routes through the tested module (so a divergent private copy can't silently reappear). Non-behavioral — the pages compute the same figures; only their kernels are now single-sourced and tested.
