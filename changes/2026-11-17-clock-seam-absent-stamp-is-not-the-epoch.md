---
bump: patch
type: fixed
brief: none
---

`clock-seam.js` no longer reads an absent stamp or an absent window bound as the epoch. `+null` is 0, and `isFinite(null)` is true, so the old guards passed `null` through as a real stamp dated 1970. One OxyDex row without a stamp then gave a 56-year backward transition, and the scan reported it as a reorder with `skipped: 0`. A window with an absent bound spanned 56 years and published `coveragePct: 100`.

`seamScan` now counts a `null`, `undefined`, boolean or empty stamp in `skipped`. `windowVerdict` now refuses an absent bound with the reason `window has no finite bounds`, and it ignores a row span with an absent end. Both callers read only `continuous === false`, so an undecided window still does not refuse a metric. No export field moves. Shrike found the sites in its absence audit of `clock-seam.js`, and Kestrel verified them on `origin/main`.
