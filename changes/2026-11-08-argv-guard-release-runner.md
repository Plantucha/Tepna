---
bump: patch
type: fixed
brief: none
---

Refuse an unknown token in `tools/release.mjs` and `tests/run-tests.mjs`, so a typed flag no longer cuts a release or runs the whole suite. Give the runner a `--help` list.
