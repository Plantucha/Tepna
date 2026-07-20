<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [OxyDex]
brief: OXYDEX-PULSE-RESOURCING-2026-07-18-BRIEF.md
---
OxyDex surfaces the O2Ring perfusion index (§4 Phase 1). It now reads the Health-Box
`*_OXYFRAME.txt` sidecar — a semicolon-delimited superset of the ViHealth SpO₂ CSV carrying the
live-header `pi_pct` (frame byte [7]÷10) that the CSV layout has no column for. `parseCSV` gained
delimiter detection and a PI column; SpO₂/HR are byte-identical whichever file a night came from.
`meanPi` ships at `measured` with a badge, rendered only when present; the ring's `pi_pct=0`
no-perfusion sentinel is treated as absent, and a plain ViHealth CSV yields `meanPi: null` — never
a fabricated 0. All three OxyDex goldens gained `meanPi: null` / `piFrames: 0` (additive) and were
regenerated. SpO₂-derived metrics are untouched.
