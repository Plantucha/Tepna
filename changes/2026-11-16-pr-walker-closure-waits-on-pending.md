---
bump: patch
type: fixed
brief: none
---

The PR walker opens no residue closure PR while an out-of-draft PR waits on its required checks. A closure PR runs fast CI, so Kodiak merged it ahead of a PR that waited on the capture-host mutation job. That merge cancelled the long run. The pass prints the PR that holds the closure. The next pass after that PR merges opens the closure.
