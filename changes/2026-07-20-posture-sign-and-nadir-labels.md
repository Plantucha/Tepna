<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [MotionDex, OxyDex, suite]
brief: POSTURE-SIGN-AND-NADIR-LABELS-2026-07-20-BRIEF.md
---
Correct MotionDex's inverted gravity sign (a supine night read 100% prone) and bin OxyDex's nadir histogram on absolute SpO₂ instead of drop depth, which had been inventing hypoxemia; also let the golden regen record an input-only change instead of stranding GATE B.
