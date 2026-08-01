<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex, OverDex, Data Unifier]
brief: EXPORT-PATH-UNREACHABLE-FOLLOWUPS-III-2026-08-01-BRIEF.md
---
Stop CPAPDex silently discarding a therapy session that starts within 15 minutes of the previous one.

cpapdex-app.js carried its own session-grouping rule (>15 min gap, then `files[type] = e` — "last-wins
on duplicate type") separate from the adapter's CPAP-REAL-CORPUS §F4 rule (±60 s anchor, a repeated
type opens a NEW set). Measured over the real SD card — 199 night folders, 1008 EDF files — the app
rule silently discarded 76 files across 16 nights (8.0 %), worst night seeing 2 sessions where the
rule sees 6. The rule is now single-sourced on CpapEdf.groupSessionSets and called by both. On
2026-07-26 the app goes 1 session/28 events/7.27 h → 2 sessions/29 events/7.33 h, matching OverDex.
Also closes the Data Unifier's missing cpapdex co-load.
