---
bump: patch
type: fixed
brief: none
---

Bound the Playwright OS-deps install at 120 s, so a dead apt mirror cannot outlast the job timeout.
