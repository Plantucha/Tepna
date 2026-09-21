---
bump: minor
type: added
brief: CORPUS-TIER-30-NIGHTS-2026-09-20-BRIEF.md
---

`tools/corpus-tier.mjs`: keeps the 30 most recent nights of the canonical corpus local and replaces
every older file with a symlink into the verified NAS copy, after a size + SHA-256 check of the twin.
Never deletes. Refuses when the NAS is unmounted. Runs from a 14:30 rig timer.
