<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Fix the self-contradicting `pressureChangePoints` export (DEEP-AUDIT-II §6.1): with ≥2 changes the recursive segmentation stored `after = med(k1, n)` — a median spanning the NEXT change, so `cp[0].after` ≠ `cp[1].before`, `before` was a level that was never a setting, and `delta` was a half-step. before/after are now the two adjacent segment medians, so consecutive points agree and every value is a real held regime. Adds a 3-regime known-answer gate.
