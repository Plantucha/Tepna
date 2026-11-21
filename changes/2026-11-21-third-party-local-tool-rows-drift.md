---
bump: patch
type: fixed
brief: none
---

The licence table's local-search rows recorded versions the box stopped running. It read `v1.0.0-rc.93` for the index binary against the installed rc.104, and 0.34.4 for the model runtime against 0.40.17. It also named two of the three local models, and six tools read the third one.

`update-watch.mjs` already reads the installed side of every one of those rows, so it now compares them. It reports a row behind the box, a tracked tool the table names nowhere, and a row no source reads. A `--notify` run posts each new finding once. An unread install reports nothing, because an absence is not a drift.
