---
bump: patch
type: fixed
brief: none
---

The fleet board's plan pace no longer spans a weekly reset. The pace is now measured between two readings carrying the same `resets` stamp. A week holding one reading refuses with a named reason instead of publishing a negative rate. The evaluation parser now accepts a heading written with a Markdown prefix. A new tripwire names the running checkout when its copy of `tools/board.mjs` differs from `origin/main`.
