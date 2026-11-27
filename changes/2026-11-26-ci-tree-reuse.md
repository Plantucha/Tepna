---
bump: patch
type: changed
brief: none
---

A push to main can now skip the heavy jobs of tests, capture-host-ci and local-steps. It skips them when a green merge-queue run of the same workflow tested the same tree. The skipped jobs read skipped, and the reuse job names the reused run. The CI timing tool drops such runs from its sample.
