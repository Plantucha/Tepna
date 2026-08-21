<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [OxyDex]
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---
OxyDex: self-calibrated waveform SpO₂ trend from the O2Ring 0x05 two-channel stream
(`parsePPG2W` + `spo2WaveformTrend`; the device-CSV side reuses OxyDex's own
`parseCSV` — no second SpO₂ parser), paired `_PPG2W.txt` + `_SPO2.csv` intake,
three experimental-tier registry metrics
(spo2wMedian / spo2wMin / spo2wTrackR), refusal-first design (no device series,
<40 bins, r<0.3, zero variance ⇒ named refusal, never a number). The estimator ships
the 2026-08-20 brute-force sweep winner (RMS AC · 60 s mean bins · +10 s firmware
lag; 1344 configs × 49 sessions, LOO held-out per-session median r = 0.723, RMSE
0.56 %). Owner-ordered lift of the brief's §5.2 metrics ban, recorded in the
§5.2-AMENDED block. Home is OxyDex (owner routing call,
2026-08-20): it is the SpO₂ node and the O2Ring's native home. Includes a 1 Hz
waveform SpO₂ signal (sliding 60 s mean at 1 Hz cadence) and a device-vs-waveform
comparator transposing ECGDex's alignFirmwareRR pattern — per-decile |error| fan,
best-window baseline, tolerance = max(3× best, the device's 1 % display quantum),
decay flagged and localized, both sides at one bandwidth (corrected-vs-corrected).
Three more experimental registry metrics (spo2wBias / spo2wMae / spo2wWithin2).
