<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---
PpgDex: self-calibrated waveform SpO₂ trend from the O2Ring 0x05 two-channel stream
(`parsePPG2W` + `parseO2RingSpo2Csv` + `spo2WaveformTrend`), paired `_PPG2W.txt` +
`_SPO2.csv` intake in the app, three experimental-tier registry metrics
(spo2wMedian / spo2wMin / spo2wTrackR), refusal-first design (no device series,
<40 bins, r<0.3, zero variance ⇒ named refusal, never a number). The estimator ships
the 2026-08-20 brute-force sweep winner (RMS AC · 60 s mean bins · +10 s firmware
lag; 1344 configs × 49 sessions, LOO held-out per-session median r = 0.723, RMSE
0.56 %). Owner-ordered lift of the brief's §5.2 metrics ban, recorded in the
§5.2-AMENDED block.
