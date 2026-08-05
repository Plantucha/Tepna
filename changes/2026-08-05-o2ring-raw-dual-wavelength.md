<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---
The O2Ring's raw two-wavelength PPG is capturable after all — `cmd 0x05` decoded as 9-byte records.

`O2RING-RAW-STREAMS-ABSENT-2026-08-04` concluded this ring exports no raw red/IR. The sweep behind that
conclusion scored `0x05`'s fixed 922-byte reply as noise against a GENERIC byte-wise metric — which is
what interleaved little-endian u32 pairs look like with no record framing. Read as `{u32, u32, u8}`, both
channels are ordered waveforms: successive-difference ratio 0.0148 and 0.0168 against 0.3395 for the same
bytes shuffled. The miss was a decode failure, not a missing argument.

New opt-in `ppg2w` stream: `oxyii.parse_rt_ppg` (count from the device's own field, slice bounded by the
buffer, so the observed 2-byte trailer is ignored rather than absorbed into a record), a `write_ppg2w`
writer, and a `BUS.register` so the monitor surfaces it like any other stream.

Two things are deliberately NOT claimed. **Which u32 is which wavelength** is a vendor-header claim, not a
measurement, and it is load-bearing — SpO2 is a ratio-of-ratios, so a swapped pair yields a confident wrong
saturation rather than an error. Columns are recorded in device order as `channel 0;channel 1`. **The rate**
is unknown: every reply carried exactly 102 records regardless of poll spacing, which is a buffer cap
signature (`cmd 0x03` caps the same way at 250), not a rate — so `fs=0` on the card and `sensor timestamp
[ns]` is 0 on every row rather than a borrowed grid.

Prior art checked before claiming novelty: `nglessner/o2ring-s-protocol` (the reference `O2RING-PROTOCOL`
§1 already cites) documents `0x05` as `922 bytes · 102 × 9-byte records · "purpose unknown"` from an EMPTY
payload — so the reply is probably not argument-gated, and this changeset does not claim it is. What is new
is the PURPOSE and the record base offset of 2 (`u16` LE count where the reference reads a `u8`; only base
2 decodes into smooth waveforms, so the offset proves itself).

Parser tests verified against four hand-applied mutants (endianness, count bound, record offset, the
argument itself) rather than trusted for passing. The header-parity gate's exhaustiveness tripwire caught
the new stream and was extended, not widened.

Out-of-suite Python only — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.

Hardware run 2026-08-05 (finger worn, ring-reported SpO2 97%, 30 polls / 3060 samples) settled two of the
three open questions. The `{0x07, 0x01}` argument is IRRELEVANT — an A/B against an empty payload returned
15 replies each, every one 922 bytes with 102 records. And the buffers TILE: the boundary step between
consecutive replies is 1.07x the median step inside a reply, so successive polls return successive
non-overlapping segments of one continuous signal, which makes the rate derivable as `102 / poll interval`
once a probe records its poll timestamps. Wavelength identity is now SETTLED, and against the SDK: `channel 0`
is RED and `channel 1` is IR (the SDK names them the other way round). Measured over the 3060 reconstructed
samples — AC/DC 0.1184 vs 0.2425, so R = 0.4885 -> SpO2 ~97.8% against the ring's reported 97%, where the
swap gives 59%. The two-gains alternative is refuted (fitting ch1 = k*ch0 gives k drifting 0.71->0.53 with
residuals up to 7% of DC; a gain pair holds k constant at ~zero residual). The recorded file format stays
device-order `channel 0;channel 1` — a capture writes what the device sent, and an interpretation resting
on one session at one saturation belongs in the analysis layer.
