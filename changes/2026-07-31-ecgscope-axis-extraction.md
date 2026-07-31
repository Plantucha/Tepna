<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ECGDex]
brief: DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md
---
Hoist ECGScope's time-axis tick and label arithmetic out of the canvas draw so it can be gated, closing the deep-scout wave's last hollow gate.

`patch`: a behaviour-identical extraction — same expressions, same call sites — so nothing a user sees
changes and no export moves. The ECGDex equiv fixture reproducing byte-for-byte is the proof.
