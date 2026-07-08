<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: TRIO-METHODS-REUSE-2026-07-06-BRIEF.md
---
ECG Splitter gains a folder-batch mode — drop a capture folder, group files into recording nights, bulk-split oversized ECG/PPG waveforms, and run an off-thread signal check (production Pan–Tompkins / 3-LED detectors in a Web Worker) reusing the trio-experiment folder-ingest + worker-DSP patterns.
