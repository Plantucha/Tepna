---
bump: patch
type: fixed
brief: none
---

The PR walker counts a re-run attempt before it calls GitHub. Before this fix, a failed call skipped the counter. The next pass then re-ran the same head again, about every 90 seconds. On 2026-11-07, #4550 took four failed re-runs on one head. A failed re-run now spends the head's one re-run, and the next pass hands the red to a coder.
