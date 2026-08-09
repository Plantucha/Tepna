<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: n/a
---
`sync-apps.sh` built its serve list from `provenance/*.json` plus a hand-typed `PAGES` array, so the ten `*-analysis.html` tools — the one generated tree with no provenance fragment — were never copied and never reported: `extra` counts files present in DEST that should not be, and says nothing about files never considered. Measured on the box 2026-08-09: every app bundle current while ten analysis tools served code four days stale (pre-#1011 `accFs`, pre-#996 ECGDex clock), under a summary that read clean. The list is now derived from `tools/build-analysis.mjs`'s own `TOOLS` array — asking the builder, as `rebase-safe.mjs` does — parsed in shell because the capture host is not guaranteed to have node, and refusing the deploy outright if that parse comes back empty rather than shipping a partial one. Also splits the asset counters from the bundle counters: they were shared while the summary printed the bundle count as the total, so an observed run read "23 bundle(s): 16 already current, 13 refreshed" — 29 of 23. The sync was correct and the line describing it was not, which is worse, because that line is what people read to decide whether a deploy worked.
