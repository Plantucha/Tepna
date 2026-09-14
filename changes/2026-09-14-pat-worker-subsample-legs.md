<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex, PpgDex]
brief: PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md
---
Resolve both PAT legs at sub-sample positions on the measured axis — the PPG leg's `rel[idx]` lookup missed on every fractional foot and silently fell back to a synthesised `idx / fs` (660 ms median divergence, 955 ms max), and the ECG leg handed `tMsAt` integer `detectPeaks` output because `refinePeaks` was never exported.
