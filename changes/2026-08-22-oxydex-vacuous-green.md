<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---
The Smart Summary flagged-metrics reassurance no longer satisfies by absence — same #1571-class trap: an empty `_flagged` set now requires a positive count of severity=good metrics before rendering the green note, and a zero count falls through to an honest "no metrics scored" instead.
