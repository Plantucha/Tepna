<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [PpgDex, Integrator]
brief: DEEP-AUDIT-IV-2026-08-04-BRIEF.md
---
PpgDex's robust-HRV quality gate admitted epochs the accelerometer never observed as "low motion", so a night whose ACC ends early published sdnnRobust 42.5 ms where the verified-still epochs say 16.0 — and hfRobust disagreed 8x with its own motion-gated twin (974.5 vs 114). The fifth instance of bug class 3a in this file, and the one the 3a fix missed because the committed twins carry no ACC at all, where the buggy and honest gates return the identical number. Adds sdnnRobustBasis so the <3-epoch fallback is attributable.
