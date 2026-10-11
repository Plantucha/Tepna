---
bump: patch
type: changed
brief: none
---

The four #3368 CI gates each emit one `tepna.verdict/1` and carry a `--selftest` with a planted violation and its controls, and all four are binned `decides`/adopted — replacing three `word-only/exempt` rows whose stated reason (the exit code is the machine-readable result) the verdict contract rejects, and adding `xss-sink-gate`, which was not binned at all.
