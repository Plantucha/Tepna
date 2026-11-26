---
bump: minor
type: fixed
brief: none
---

Refuse the quiet interval after a desaturation with no duration, rather than read that event as zero-length.

`computeIEI` now counts those intervals as `ieiDurationAbsent`, and it names its own population as `ieiN`.
