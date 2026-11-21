---
bump: patch
type: fixed
brief: none
---

Guard the PulseDex ln-rMSSD producer, so a measured zero rMSSD exports `null` and never `-Infinity`.
