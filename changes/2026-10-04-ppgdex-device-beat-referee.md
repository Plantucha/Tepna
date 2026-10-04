<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex, docs]
brief: none
---
**The O2Ring's `156` rows are its own beat detections, and PpgDex now reports agreement between its
detector and the device's.** Settled by the device's own flag rather than by inference (Wren,
2026-10-04): across three nights **304/304 PLETHA `156`s carry `beat=1` and every `beat=1` sits on a
`156`**, at 48–53/min against a pulse rate of 48–60. Cross-stream alignment to `_PPG.txt` was tried
first and is **not identifiable** — PLETHA is a separately beat-marked waveform with its own `156`s and
no device clock. `O2RING-PROTOCOL` §156's `PPG_INVALID` / missing-sample reading is corrected by banner,
and a consumer that treated a `156` as a gap was punching holes into valid signal.

New: `PPGDSP.alignDeviceBeats` / `validateBeats`, the export field `quality.deviceBeats`, three
`measured`-tier registry rows, a card on the validation surface, and `tools/oracle-ppg-device-beats.mjs`
— the twin of `oracle-ecg-firmware-rr.mjs`.

⚠️ **The lag is a LATENCY, not an error.** The marker records the firmware's DETECTION instant, so it
sits a fixed ~167–182 ms after our foot (measured here; `tests/dex-tests.js` records 184–200 ms on other
nights). Publishing that as "disagreement" would report a working detector as broken, so it is named
`latencyMedianMs`, left deliberately unbanded, and the AGREEMENT is its MAD plus the latency-invariant
`ppiDeltaMedianMs`. That last one is the criterion and the only statistic comparable to ECGDex's
`rr_delta_median ≤ 8 ms`; the threshold is **one ADC sample at the 125.000 Hz crystal = 8.000 ms**,
pre-stated from the instrument rather than fitted to the data it judges.

**This pairs by TIME where the ECG leg pairs by INDEX** — the one deliberate departure. The H10's
`_RR.txt` carries arrival stamps so ECGDex must ignore the axis; here both trains are rows of the same
file on the same device-crystal grid, so time pairing is identifiable and is the only pairing that can
see the lag at all. ECGDex's discipline is otherwise kept: re-fit per window, report the fan, floor at
one sample.

**Same sensor, same stream** (`R5-HR-TRIPLET-REFERENCE` §4, standing): a second ESTIMATOR, not a second
sensor. Not a fourth corner for the σ work, and `scope: internal` on the verdict says so.

Fixtures: six PpgDex goldens regenerated (`manifestHash f9ddd19fd7d2 → 7f79a12ed3b1`), stamps and the
new field only — no measurement value moved.
