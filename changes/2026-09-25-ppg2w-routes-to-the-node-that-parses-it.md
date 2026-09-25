<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [OxyDex, Data Unifier, OverDex]
brief: none
---
A dropped `…_PPG2W.txt` now routes to the node that can read it. The O2Ring's raw dual-wavelength waveform
was claimed by `oxydex-spo2` — the 1 Hz oximetry CSV adapter — at 0.95 with no runner-up, so the router did
not even report it ambiguous. That is the ENGINE-VERIFICATION-FINDINGS §1.4 tie one iteration worse: §1.4
fixed `_PPG.txt` by declining that suffix and giving `o2ring-ppg` 0.97, but `_PPG\b` / `_PPG\.` cannot match
`_PPG2W` because a word character follows `PPG`, so every `ppg` adapter scored 0 and the CSV adapter won
outright. Measured severity before the fix: a LOST SIGNAL, not a wrong number — `oxydex-spo2.parse` refused
honestly on the waveform, with the real CSV as a live control, so the stream was simply never analysed.
Two halves, both load-bearing: a new `adapters/o2ring-ppg2w.js` (`signalType: 'spo2'`, because
`signal-orchestrate _HOSTS` maps that to OxyDex, the node owning `parsePPG2W`) scoring 0.97, and
`oxydex-spo2`'s waveform decline widened from `_PPG` to the whole `_PPG<suffix>` family by construction, so
the ring's next raw channel is declined the day it exists. Registering the adapter alone leaves a 0.02 gap
under the router's 0.15 threshold — an AMBIGUOUS route, not a fix — and a test pins that. The adapter
REFERENCES `OxyDex.parsePPG2W` and `spo2WaveformTrend` rather than carrying a parser, passes the
`_PPG2WRUNS` validity sidecar through to it, and refuses with the DSP's own reason plus what it did read,
since a waveform alone cannot be self-calibrated. The `_PPG2WRUNS` sidecar is claimed by nobody and set
aside. Closes residue `2026-09-25-ppg2w-routes-to-spo2`.
