<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Surface each HRV-stability window's epoch count as `n` in the ECGDex `hrvStability.series` export, so a short trailing group (admitted with as few as 3 of 6 epochs) is visible rather than silently equal-weighted; the slope fit is unchanged (DEEP-AUDIT-II #39). ECGDSP.hrvStability is exposed for a known-answer gate.
