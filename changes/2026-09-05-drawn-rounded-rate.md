<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---

PpgDex's drawn-axis test cut at ≥99 % of inter-sample deltas on one value, which is the wrong edge of
its own separation gap and misses any device whose nominal rate does not divide evenly. A 130 Hz ECG
column rounds to two deltas at 69.23 % concentration — an axis that is `index × an assumed rate` by
construction, certified as a real second clock. Aligned to 0.67, the cut `clock.js` already carries on
a 381-file measurement, with a rounded-rate twin so the corpus can express the difference.
