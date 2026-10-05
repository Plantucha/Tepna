---
bump: patch
type: fixed
brief: ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

The capture-host CPAP poller tests no longer try to reach the CPAP card over the network: they stub the card probe and fail if any test opens a real connection, which also removes about two minutes of waiting from each run of that test file.
