<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [tools]
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---
`tools/o2ring-dat-timefit.mjs` gains a pure `fitDatToSpo2Csv({dat, csv, maxLag})` helper and a `--json` CLI mode — the machine-readable summary a downstream hook (nightqc RTC-digest sibling, trio-batch enrichment) needs to actually invoke the tool the header claims runs on every night.
