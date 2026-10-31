---
bump: patch
type: added
brief: none
---

`tools/unit-health.mjs` reports a failed, stopped or overdue user timer to board thread 7.
It also reports a failed service that no loaded timer activates.
`tepna-unit-health.timer` runs it every 15 min and posts only when the finding set changes.
