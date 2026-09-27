---
bump: patch
type: fixed
brief: none
---

`mutation_diff.root_reads` lists `*.py` with rglob and reads each afterwards, so a path deleted in that gap by another xdist worker raised FileNotFoundError and failed the root-read census — measured on a transient probe directory a sibling test creates and removes in its own `finally`. A file that disappeared is not a file whose contents are unknown; it is not a file, so it is skipped and contributes nothing. Narrow on purpose: only FileNotFoundError, because the census is a pinned equality and any swallowed read would silently shrink the population it measures. Closes residue `2026-09-27-a-suite-walker-races-a-probe-dir-under-tests`.
