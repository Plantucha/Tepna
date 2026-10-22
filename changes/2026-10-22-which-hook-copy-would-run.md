---
bump: patch
type: added
brief: none
---

Report which copy of each guard hook would actually run. `tools/hook-liveness.mjs` reads every script named in `.claude/settings.json` three ways. It digests the bytes on disk, the bytes at the live tree's HEAD, and the bytes at the ref. So a checkout that has not pulled a landed fix reads apart from a hook someone edited in place.
