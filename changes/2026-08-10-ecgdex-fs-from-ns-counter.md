<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: WEARABLE-HOST-AXIS-2026-08-02-BRIEF.md
---
Derive ECG `fs` from the file's integer `sensor timestamp [ns]` counter instead of rounding the lossy `[ms]` column to the nominal 130 — the rounded axis ran 46–126 ppm fast, drifting 1.25–4.16 s per night.
