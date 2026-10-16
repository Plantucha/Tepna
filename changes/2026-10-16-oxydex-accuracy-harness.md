---
bump: patch
type: fixed
---

OxyDex accuracy harness: new `oxydex-accuracy.js` DSP module with `injectBias`
and `sensitivityReport`, plus three test groups (28 assertions).

Target 1 (math correctness) and Target 2 (bias sensitivity) from the reframed
accuracy design. The module is harness machinery, not shipped metrics: it
measures how OxyDex's DSP behaves under systematically biased SpO2 input
(±1/±2/±4%, the JHU drift magnitudes), reporting per-metric deltas, clinical
boundary crossings, and masked/phantom desaturation counts. Absence contract
holds throughout: null in, null out, never 0.
