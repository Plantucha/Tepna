<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md
---
Fix `NSRR.analyzeRecord` and the ODI-bias analysis page, both dead since oxydex-dsp's bare-global spray was removed — they reached `processNight`/`parseCSV` as globals that no longer exist.

`patch`: no published contract changes shape. The removed duplicate `×1.1` in `nsrr-adapter.js` was
unreachable (`processNight` always attaches `ahiEst`), so deleting it moves no output — proven by
mutation before removal. The behavioural change is that two code paths that always failed now run.
Gated by a new known-answer group driving a synthetic two-channel EDF end-to-end, plus a class-level
source scan so a fresh bare helper call reds instead of shipping.
