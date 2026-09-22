---
bump: minor
type: added
brief: none
---

`tools/box-sample.mjs` decides what a memory trace may be spent on: `traceSpan` / `peakClaim` / `peakVerdict` refuse a peak — or an ABSENCE of one — read off a trace shorter than the 665 s at which the tool's own 2026-09-15 series first saw the daemon's startup step, report a lower bound past the onset, the cap past saturation, and refuse a trace spanning a restart. Emitted as `tepna.verdict/1` (`--verdict <tsv> --json`, `--verdict-sample`), adopted in `tools/verdict-adoption.json`.
