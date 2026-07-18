<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [MotionDex]
brief: APNEA-TYPING-FUSION-2026-07-18-BRIEF.md
---
MotionDex exports a coverage-honest per-epoch respiratory-effort series (`motion.effortSeries` at 10 s epochs + `effortCadenceSec`/`effortFloorG`) and surfaces it as a standalone effort-presence read + sparkline — `present:null` where chest ACC was not recording, never a fabricated absent.
