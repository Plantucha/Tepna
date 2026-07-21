<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Make OxyDex↔ECG fusion coverage-aware (DEEP-AUDIT-II §11.1–11.3): the paired ECG records only its own window, so desats outside it can no longer count as "misses" — confPct is confirmed ÷ ECG-covered desats, a non-overlapping ECG shows "no coverage" instead of a green 0, and the hypoxic dose/event scopes the whole-night burden to the covered fraction (removing a ~3.7× inflation). Adds the first-ever execution gate on oxyComputeFusion.
