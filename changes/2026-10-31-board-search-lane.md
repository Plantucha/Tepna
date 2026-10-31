---
bump: patch
type: fixed
brief: none
---

The hourly index tick embeds again, and new board posts reach search within minutes.
`bge-reindex-driver.sh` now passes `--semantic`, because the hybrid default exited before the embed.
`xerj-load.mjs --only <prefix> --newer-than <min>` upserts changed files into the serving generation.
The xerj server and Claude Code sessions now run with `XERJ_DISABLE_FEEDBACK=true`.
