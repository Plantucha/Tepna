---
bump: minor
type: added
brief: VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md
---

The three-cornered hat now says which leg moved a corner. `analysis-stats.js` gains `hatContributions`, which builds the `tepna.verdict/1` `contributions` block for one corner by the `analytic` method. It also gains `patHatContributions`, which builds all three blocks on the brief's own leg keys in ms². The classic hat is a closed form, so each leg's term is its own partial of ±½ times its own variance. The three terms then sum to the corner exactly, and the suite asserts that identity over 900 corners against `threeCorneredHat` itself.

A variance is never negative, so exactly one delta per corner is the subtracted leg. When that leg dominates, the corner goes negative, and the block names the leg a bird otherwise reads out of the code. An absent leg arrives non-finite, and the block gives it `delta: null` with a reason. That nulls every other share and `dominant` too, because one unknown term makes the denominator unknown.

The drift-removed hat publishes the same block over its differenced variances under `sigma2.drift-removed.*`, and a refused hat publishes none. No owned bundle inlines `analysis-stats.js`, so no `manifestHash` and no `computeHash` moved. The ten analysis pages rebuild under `build-analysis.mjs`. The §2 adoption row stays `pending` until a tool emits the block.
