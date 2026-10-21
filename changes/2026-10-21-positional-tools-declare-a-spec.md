---
bump: patch
type: fixed
brief: none
---

The two tools whose positions are their interface now declare an argv spec, so a mistyped flag refuses instead of becoming a path.

`tools/mutation-summary.mjs` reads `<ndjson> <exit-code>` and `tools/residue-merge.mjs` reads git's `%O %A %B`. Each one took whatever sat in position 0, so `--jsonl out.ndjson` became the path `--jsonl`. The first rendered a report over an absent file at exit 0 and the second threw an ENOENT at exit 1. The guard's `positional: true` option keeps every bare token and refuses an unknown dashed one. That is what the row asked the owner about, and the guard already did it. The merge driver also ran its CLI at module scope, so importing its exported parser exited the importer; `isCliEntry` now wraps it.

The cross-check in `tools/argv-reads.mjs` stops classifying today's bytes when it cannot read the probed ones. `gitShow` returns null for an absent commit, an absent path and no git alike, and the row still counted as comparable. Run over a copy of `tools/` with no git objects, it reported eight contradictions. No measurement supported them. It now excludes such a row by name and reads NOT_RUN over 45 of 45.
