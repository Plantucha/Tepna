---
bump: patch
type: fixed
brief: none
---

capture-host: an archive offload window that crosses midnight now stays open past it. An evening `schedule.at` runs the full `window_min` it declares, instead of stopping at 00:00.
