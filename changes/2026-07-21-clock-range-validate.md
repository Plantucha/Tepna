<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Range-validate clock components (DEEP-AUDIT-II §12.3, Clock Contract amendment): the regexes match digits, not calendar validity, so a corrupt stamp (`2026-13-45 25:99`) fed out-of-range components to `Date.UTC`, which SILENTLY ROLLED them onto a plausible WRONG instant. `clock.js:_ckMk` now builds tMs only if the date round-trips (real month + calendar day) and the time is 0–23:0–59:0–59.0–999; any out-of-range component ⇒ honest null (Clock §2.6). The ONE legitimate overflow — ISO end-of-day `24:00:00` — normalizes to next-day 00:00 (no bare `h>23` guard). Valid stamps parse identically, so every committed fixture reproduces byte-identical.
