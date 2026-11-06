---
bump: patch
type: fixed
brief: none
---

`tools/update-watch.mjs` marks an update ready only when the latest release is newer than the install. On 2026-11-06 the watch offered claude-code 2.1.319 → 2.1.318 as READY, because npm's latest tag trailed the installed version. A new `compareVersions` orders two versions by SemVer, with a pre-release below its release. A model digest is not a version, so a digest source keeps the old rule.
