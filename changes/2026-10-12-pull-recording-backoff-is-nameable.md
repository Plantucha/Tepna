---
bump: patch
type: fixed
brief: none
---

capture-host: name the backoff `pull_recording` waits between attempts, so the test selection can zero it; the `_with_retry` default it replaced is unchanged at 2.0, and the mutants of that function now reach a verdict instead of timing out.
