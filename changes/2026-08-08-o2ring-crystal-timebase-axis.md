<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md
---
O2Ring timebase — Stage 2: the device-crystal marker-aware axis in PpgDex (opt-in; default unchanged).

`PpgDex.parsePPG(text, { timebase: 'device-crystal' })` and `compute(input, { timebase: 'device-crystal' })`
rebuild an O2Ring **finger** recording's `relSec` on the 125.000 Hz crystal grid instead of the
host-disciplined ~125.7 Hz ROW axis: real ADC samples advance by 1/125.000, the inserted `156` beat
MARKERS (the sentinel `gap` rows) advance nothing, and each contiguous segment is re-anchored to the
host-disciplined axis at every genuine loss so real dropouts are preserved (intervalsSpanningTimeGap /
coverage still see every discontinuity). On a clean night this is exactly "cumulative real samples /
125.000 from the host t0". `fs` becomes 125.000; the export's `quality.timebase` records which reference
governed a finger recording.

**Opt-in, so no shipped behaviour changes:** the default is unchanged ('host-disciplined'), the flag is
finger-only (a Verity carries no timebase and the path is a no-op), and the export field is CONDITIONAL —
a Verity omits the key, so every committed Verity golden is byte-identical (regen --check: 0 moved; GATE
A/B green; the 4 PpgDex fixtures re-stamped `manifestHash` only, no output moved). The default-flip and
the capture-stamp wiring are Stage 3, where the bad-host ECG acceptance evidence lands.

**ECG-arbitrated** on the tri-device corpus (H10 chest ECG as ground truth), whole-record:

| night | HR ECG/host/crystal | rMSSD ECG/host/crystal |
|---|---|---|
| 08-01 | 53.2 / 53.0 / 52.5 | 37.1 / 56.5 / 56.6 |
| 07-28 | 48.4 / 49.0 / 49.0 | 37.2 / 44.0 / 44.9 |
| 08-03 | 51.5 / 52.0 / 52.0 | 40.4 / 77.0 / 76.9 |

Crystal ≈ host on HR and rMSSD (the PPG-vs-ECG rMSSD gap is the pre-existing optical alternation,
identical on both axes); crystal's total span is equal-or-closer to the ECG. So defaulting to it (Stage 3)
costs nothing on a good host and protects a bad one. Re-bundled PpgDex + Data Unifier + OverDex.
