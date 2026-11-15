---
bump: patch
type: fixed
brief: none
---

The CPAPDex AHI-by-hour chart no longer draws an event with no time in hour 1. The bucketing now counts such an event as `untimed`, and the chart states that count. A timed event outside the chart's hours counts as `outside`. Shrike wrote the first patch, and Kestrel reviewed and corrected it.
