<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Data Unifier, OverDex, OxyDex]
brief: none
---
A `_PPG2W.txt` dropped into the Data Unifier or OverDex alongside its night's `_SPO2.csv` now produces the
same waveform-SpO₂ trend OxyDex's own drop handler produces — the trend no longer depends on which host
ingested the files. Routing the waveform to the right adapter was not enough: `spo2WaveformTrend` is
self-calibrated against the ring's own 1 Hz series, and the hosts had no way to hand one over. Four
independent blockers, each measured: `streamKind` returned null for `_PPG2W`, `_SPO2` and `_PPG2WRUNS`
alike; `_COMPANION_KINDS` had no `spo2` lane; `pairCompanions` skipped every candidate on a vendor filter
whose comment reads "an O2Ring SpO₂ / Libre CGM file is never a sidecar" — right for a Polar `ecg`/`ppg`
primary and wrong for the `spo2` lane, where that CSV is the companion; and both hosts hard-coded
`ecg || ppg`, so a type in the table and absent from the condition would pair nothing, silently, in one
host only. The vendor filter is now scoped to the PRIMARY (same vendor family ⇒ eligible), so a Polar ECG
primary still rejects an O2Ring file — pinned as a control that must not move — and both hosts read the
lane list from `companionKinds()` rather than repeating it. The adapter parses the companion with the
host's own `parseCSV`, so there is no second CSV parser any more than a second waveform parser, and a
waveform dropped alone still refuses honestly.
