<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS-2026-08-05-BRIEF.md
---
`parse_rt_ppg` read the O2Ring's `cmd 0x05` channels UNSIGNED. They are signed.

Measured over 61066 real samples: read unsigned the maximum is 4294966954 — within ~3000 of 2**32,
the signature of a small negative wrapping. Read signed the range is -285410 .. 3478709 and NOT ONE
sample exceeds the 24-bit signed maximum of 8388607, so the wire format is 24-bit two's complement
sign-extended into 32 bits. That is also the output-register format of the TI AFE44xx family this
device class is built on, which corroborates the layout from the data rather than from a datasheet.

Silent and destructive rather than cosmetic: a wrapped 4.29e9 is a legal u32, so nothing raises, and a
single one inside a mean ruins it. It ruined ours — the parent brief's claim that "AC/DC is ten times
too large" was computed over wrapped values; recomputed signed it is 0.83%, an ordinary perfusion
index, and that sub-argument is withdrawn in the follow-up brief. (The wavelength withdrawal itself
stands: it rests on a positive control, unchanged under the signed parse.)

No existing test could catch it, because every fixture used small positives where signed and unsigned
agree. The two new tests use bytes that actually appear on the wire (-342, -285410) and both fail
against the old code, verified by re-applying the unsigned read with __pycache__ cleared.

Out-of-suite Python only — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.
