---
bump: patch
type: fixed
brief: none
---

CPAPDex's cross-night trend answers `null` for a z that it cannot compute. It no longer publishes 0σ. One weight that is no number in the prior makes the weighted mean and SD NaN. The old fallback then said that the newest night sits exactly at your baseline, beside a `baselineSd` of `null`. `zSaturated` stays false when no clamp ran. Shrike found the site in task 29, and Kestrel verified it on `origin/main`.
