<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: OXYDEX-PULSE-RESOURCING-FOLLOWUPS-2026-07-20-BRIEF.md
---
pulse-agreement pairs the O2Ring's PPG and SpO2 files by their shared session stamp and compares per 5-min epoch, and its child no longer truncates a long session's output into a silent "analyse failed".
