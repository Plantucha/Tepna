---
bump: minor
type: fixed
brief: none
---

A daemon restart now ends a capture session instead of being absorbed by the 3600 s session-gap threshold, so coverage, `span_sec` and `stopped_early_s` describe one run of one device rather than the union of every run in the night folder. `nightqc.summarize` gains `session_basis` (`daemon-starts` when the `STARTS.csv` sidecar spoke, `gap-only` when it did not), and `timeline.build` segments on the same seams so the two cannot disagree about what a session is. Closes residue `2026-09-25-coverage-spans-two-capture-sessions`.
