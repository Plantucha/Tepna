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
15 replies each, every one 922 bytes with 102 records. The rate is BOUNDED but still not pinned: 102 is a
cap (polled every 0-0.3s the count falls through 0, 4, 10 ... 70), and fitting `count = fs*dt` over 35
unsaturated replies gives 125.7 Hz by least squares / 155.5 Hz through the origin / 150.7 Hz median ratio.
Solid: it is NOT the SDK's claimed 200 Hz, and the stream carries no inserted beat marker (unlike the
pleth), so the right comparison is the ADC's 125.000 Hz -- not the row-rate constant 125.738, which
DEVICE-RATE-TRUTH refuted. Not solid: which estimator is right, so `fs` stays 0 on the bus. Wavelength identity is NOT established, and an intermediate
revision of this changeset wrongly said it was. A ratio-of-ratios gave R = 0.4885 -> SpO2 ~97.8% against
the reported 97% (swap: 59%), which looked decisive; but R is defined on the CARDIAC AC and nothing shows
the measured AC is cardiac. AC/DC of 12-24% is ~10x a finger perfusion index, and autocorrelation finds no
periodicity at ANY lag from 20 to 2200 -- covering every rate from 1 Hz to ~2400 Hz at the measured 66 bpm
-- nor within seam-free single buffers (so 56 Hz is excluded too). A pulsatile signal must peak at its beat
period; this one never does. The agreement may be coincidence, so no wavelength is assigned and no SpO2 is
computed from these columns. What IS established: the two columns are genuinely different optical channels,
not one photodiode at two gains (fitting chB = k*chA gives k drifting 0.7139 -> 0.5320, residual RMS 0.049%
-> 7.06%; a fixed gain holds k constant at ~zero residual).

Recording device order under neutral names is what kept a wrong wavelength assignment from reaching a
saturation number when the identification collapsed. That is the whole argument for the convention.

Parser tests verified against four hand-applied mutants (endianness, count bound, record offset, the
argument itself) rather than trusted for passing. The header-parity gate's exhaustiveness tripwire caught
the new stream and was extended, not widened.

Out-of-suite Python only — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.

Hardware run 2026-08-05 (finger worn, ring-reported SpO2 97%, 30 polls / 3060 samples) settled two of the
three open questions. The `{0x07, 0x01}` argument is IRRELEVANT — an A/B against an empty payload returned
15 replies each, every one 922 bytes with 102 records. The rate is BOUNDED but still not pinned: 102 is a
cap (polled every 0-0.3s the count falls through 0, 4, 10 ... 70), and fitting `count = fs*dt` over 35
unsaturated replies gives 125.7 Hz by least squares / 155.5 Hz through the origin / 150.7 Hz median ratio.
Solid: it is NOT the SDK's claimed 200 Hz, and the stream carries no inserted beat marker (unlike the
pleth), so the right comparison is the ADC's 125.000 Hz -- not the row-rate constant 125.738, which
DEVICE-RATE-TRUTH refuted. Not solid: which estimator is right, so `fs` stays 0 on the bus. Wavelength identity is now SETTLED, and against the SDK: `channel 0`
is RED and `channel 1` is IR (the SDK names them the other way round). Measured over the 3060 reconstructed
samples — AC/DC 0.1184 vs 0.2425, so R = 0.4885 -> SpO2 ~97.8% against the ring's reported 97%, where the
swap gives 59%. The two-gains alternative is refuted (fitting ch1 = k*ch0 gives k drifting 0.71->0.53 with
residuals up to 7% of DC; a gain pair holds k constant at ~zero residual). The recorded file format stays
device-order `channel 0;channel 1` — a capture writes what the device sent, and an interpretation resting
on one session at one saturation belongs in the analysis layer.

Retracted within the same work-unit: an earlier revision claimed the replies TILE a continuous signal, on
the strength of a seam step 1.07x the in-buffer step. That test is insensitive — it called replies
contiguous at 0.5s, 1.0s AND 2.0s spacing, which cannot all be true — so the claim and its corollary
(`fs = 102 / poll interval`, which merely restated 102/dt) are withdrawn. The wavelength result does not
depend on it: AC/DC is an amplitude statistic and gaps add noise, not bias.
