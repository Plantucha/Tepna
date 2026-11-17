---
bump: patch
type: fixed
brief: none
---

OxyDex no longer publishes a vagal index of 0, labelled Low, for a night whose SpO₂ channel never reported. The clean-run loop compared `null > 95`, which is false, so it returned 0 minutes. `longestCleanRun` is now `null` when no SpO₂ sample exists, and `computeVagalIndex` refuses through its existing guard. `nadirDensity` is now `null` over the same night.

A night with no desaturation now publishes `nadir.meanDepth` and `nadir.meanDuration` as `null`, because a mean over zero events is not 0. The night still publishes `count: 0`. The export CSV writes an empty cell for the three night extras that it used to print as "null". Shrike found the sites in its absence audit of `oxydex-dsp.js`, and Kestrel verified them on `origin/main`.
