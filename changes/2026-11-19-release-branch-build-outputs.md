---
bump: patch
type: fixed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---

`tools/pr-compliance.mjs` check 10 now exempts a release PR, keyed on its declared `claude/release-<semver>-<suffix>` head branch. The release rebuilds every bundle, so the tag carries the new version. Check 10 red the v2.35.0 release PR on its 78 build outputs.
