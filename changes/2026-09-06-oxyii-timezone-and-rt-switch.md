<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The `0xC0` timezone byte was a constant, and the `0x10` bitfield had never been written down.

Two OxyII residue rows, both from `O2RING-PROTOCOL-2026-07-17-BRIEF.md`, and only one of them changes
a byte.

**`set_time_frame` hardcoded byte [7] as `0xCE`.** §9a decodes that byte as the UTC offset in tenths of
an hour, signed: `0xCE` = −50 = UTC−5. That is this box in *winter*. It was one hour out every summer
and wrong for any other host, while the docstring called it "the vendor tail byte" — a name that
described where it sat rather than what it held. `tz_tenths(dt)` derives it: an aware datetime is asked
for its own offset, a naive one is read as host local civil time and resolved **at that wall clock**,
which is what stops a process started in winter from sending winter until it restarts.

Three properties of the encoding are decided here rather than left to arithmetic, because one byte of
tenths cannot hold what real zones do:

- **Rounding is half-away-from-zero.** A 45-minute zone (Kathmandu +5:45, Chatham +12:45) is 57.5
  tenths and not representable at all. Python's `round()` is banker's rounding and would send +5:45 as
  57 and −5:45 as −58 — an asymmetry no reader would predict from the source. The documented 3-minute
  rounding is symmetric.
- **The edge clamps, it does not wrap.** Kiritimati (+14 h = 140) and Apia (+13 h) exceed a signed
  byte. Clamping lands 1.3 h out; wrapping lands 25.6 h out *and arrives as a plausible negative
  offset* — wrong and convincing, which is the worse of the two.
- **Winter on this box is byte-identical to before.** The test pins `0xCE`, so the fix cannot be read
  as a change in the value that was already right.

⚠️ **This is the only change here that alters a byte sent to the ring, and it is measured harmless.**
Across six stored files the trailer epoch equals the filename's local wall clock to +0.00 h, so this
ring does not apply the offset we send at all (§9a). The defect was latent and stays latent — what
changes is that the value stops asserting something false. Nothing downstream may now start trusting
the ring to apply it: `start_t_ms` remains a floating wall-clock epoch, read with `getUTC*` semantics
and no zone conversion (CLAUDE.md §🔒.1).

**`AUTO_RT_SWITCH` (`0x10`) is documented, and nothing about it is sent differently.** The vendor
exposes it as `oxyAutoSwitch(model, autoParam, autoWave, autoPpg, autoAcc)` and ORs four booleans into
one byte: `0x01` param (the `0x02` vitals body), `0x02` wave, `0x04` ppg (the `0x05` two-channel
optical buffer), `0x08` acc (the `0x14` accelerometer). The `0x00` this project has always sent clears
all four, so every ring here has run with device push fully **off** and every sample this project holds
was obtained by polling — visible in the sidecars rather than inferred, since the per-night
`*_OXYFRAME.txt` files carry one decoded `0x04` row per poll and no unsolicited-opcode rows at all.

The residue was never that `0x00` is wrong. It is that `0x00` was chosen by nobody, recorded for months
as "setup, payload 00, purpose unknown", and left to decide the acquisition model in silence. So the
byte is unchanged and `setup_frame`'s default stays `0x00`: switching a push stream on changes what
arrives on the notify characteristic for a whole session, which is a device-behaviour decision that
owes a night on the box and an owner's call, not a docstring's.

⚠️ **The bit-to-stream mapping is the vendor SDK's, not a measurement.** No ring in this project has
ever been asked to push, so whether a pushed stream beats polling on throughput, battery or gap
behaviour is untested. The comment says so at the point where a reader would otherwise assume the table
was observed here.
