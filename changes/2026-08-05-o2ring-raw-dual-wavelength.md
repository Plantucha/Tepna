<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---
The O2Ring's raw two-wavelength PPG is capturable after all — `cmd 0x05` with the SDK's `{0x07, 0x01}` argument.

`O2RING-RAW-STREAMS-ABSENT-2026-08-04` concluded this ring exports no raw red/IR. The sweep behind that
conclusion probed all 256 opcodes with `none/00/01/02` and scored `0x05`'s fixed 922-byte reply as noise —
a correct measurement of the wrong request. Sent the argument the vendor SDK specifies, both channels are
ordered waveforms: successive-difference ratio 0.0148 and 0.0168 against 0.3395 for the same bytes shuffled.

New opt-in `ppg2w` stream: `oxyii.parse_rt_ppg` (count from the device's own field, slice bounded by the
buffer, so the observed 2-byte trailer is ignored rather than absorbed into a record), a `write_ppg2w`
writer, and a `BUS.register` so the monitor surfaces it like any other stream.

Two things are deliberately NOT claimed. **Which u32 is which wavelength** is a vendor-header claim, not a
measurement, and it is load-bearing — SpO2 is a ratio-of-ratios, so a swapped pair yields a confident wrong
saturation rather than an error. Columns are recorded in device order as `channel 0;channel 1`. **The rate**
is unknown: every reply carried exactly 102 records regardless of poll spacing, which is a buffer cap
signature (`cmd 0x03` caps the same way at 250), not a rate — so `fs=0` on the card and `sensor timestamp
[ns]` is 0 on every row rather than a borrowed grid.

Parser tests verified against four hand-applied mutants (endianness, count bound, record offset, the
argument itself) rather than trusted for passing. The header-parity gate's exhaustiveness tripwire caught
the new stream and was extended, not widened.

Out-of-suite Python only — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.
