<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [CPAPDex, suite]
brief: CPAP-REAL-CORPUS-FOLLOWUPS-III-2026-07-17-BRIEF.md
---
Surface device-SETTING change-points in the CPAPDex Longitudinal card (a badged "Device setting changed — EPAP 10.7→6.5 cmH₂O on <date>" banner, export-inert) and unify the three per-node golden regenerators into one `tools/regen-goldens.mjs --node <Name>` over a shared `regen-goldens-core.mjs` (§3); apnea→motion-arousal coupling (§2) re-deferred — no motion-arousal event stream exists to couple against.
