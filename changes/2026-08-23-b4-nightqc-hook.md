<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---
nightqc gains `dat_timefit_summary` — the box-side §B4 invocation of `o2ring-dat-timefit --json` when a night carries both a `_STORED.dat` and a live `_SPO2.csv` — and `qc_digest` prints the fit beside the RTC readback with a `⚠±Ns` flag when the two independent measurements of the same clock error disagree past the .dat's 1 s quantum.
