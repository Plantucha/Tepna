<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [GlucoDex]
brief: DEEP-AUDIT-III-FOLLOWUPS-2026-07-27-BRIEF.md
---
GlucoDex's canonical export now carries `recording.coverage` and the `timeseries` cell trace. It declared no duration key the Integrator reads, so a well-controlled zero-event CGM record collapsed to a point at t0Ms — the healthiest record was the one that dropped out of fusion. And because `glucoBuildNodeExport` omitted `timeseries` entirely, `integrator-dsp.js hasCells` was always false: the Integrator stamped the same whole-wear glucose CV on every overlapping night, `pearson` over that constant series returned null, and the `directional` fallback published a number computed from the ECG slope alone under a note claiming "Single overlapping night". Coverage is `kind: 'continuous'` — a CGM wear is continuous, so one segment states that honestly and `spanSec` equals `recordedSec` by measurement rather than by assumption, which is exactly what the sparse HRVDex case could not claim. The cell builder is single-sourced as `GLUDSP.glucoCells`: `glucodex-app.js` already had its own copy, and two copies of a builder is the sibling-divergence class this audit exists to fix. One test assertion was deliberately inverted — it pinned the defect by asserting an empty cells trace — and the real committed export now adapts to 8167 cells over 681 h instead of a point. Three GlucoDex fixtures regenerated through the sanctioned tool.
