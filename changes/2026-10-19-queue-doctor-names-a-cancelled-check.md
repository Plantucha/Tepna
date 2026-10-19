---
bump: patch
type: fixed
brief: none
---

`tools/queue-doctor.mjs` now names a PR with a cancelled required check. Before the fix, the tool read the `cancel` bucket as green, because that bucket is neither `fail` nor `pending`. A cancelled run is terminal, so the PR waited forever while the report called it ready. The report now prints a `CANCELLED` line, and `--report` exits 1 on that state.
