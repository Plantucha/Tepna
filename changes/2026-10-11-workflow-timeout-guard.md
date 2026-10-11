---
bump: patch
type: added
brief: none
---

Require every workflow job to declare timeout-minutes, and set the twelve that lacked one from each job's own measured p95 and max duration, so a hung step fails in minutes instead of inheriting GitHub's 360-minute default.
