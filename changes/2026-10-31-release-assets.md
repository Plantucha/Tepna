---
bump: patch
type: added
brief: none
---

Each GitHub Release now attaches the 11 owned bundles as separate downloads.
It also attaches `Tepna-v<X>-offline.zip`, which adds the capture guide and the "Why This Exists" page with their screenshots.
`tools/release-land.mjs` reads every file at the merge sha, and `--attach v<X>` backfills an existing Release.
