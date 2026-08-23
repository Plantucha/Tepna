<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md
---

**Bit-accurate ResMed EDF/EDF+ writer — `cpap_edf.py` — creates STR/BRP/PLD/EVE files OSCAR & SleepHQ read.**

The suite decoded ResMed EDFs (`cpapdex-edf.js`); this is the inverse — turning captured CPAP data into
files that open in OSCAR and SleepHQ exactly like a night pulled off the SD card. It closes the
CPAP-BLE-CAPTURE follow-up "EDF generation from the spool/stream."

- **Reverse-engineered the checksum**: ResMed's `Crc16` lane is **CRC-16/CCITT-FALSE** (poly 0x1021,
  init 0xFFFF), over each record's data bytes. That was the crux of byte-accuracy.
- **Proven bit-accurate**: a round-trip gate decodes a genuine AirSense 11 file and re-encodes it —
  recomputing the CRC — and asserts **byte-identical**. Verified across BRP, PLD, EVE, SA2, CSL, and the
  78-signal STR daily summary. (Corpus-gated: real recordings are gitignored, so this test skips where
  `uploads/` is absent and runs locally; CI coverage comes from synthetic round-trips.)
- **Constructors from data**: `build_brp` (25 Hz flow+pressure), `build_pld` (nine 2 s derived channels),
  `build_eve` (EDF+ TAL event annotations — the device's one-event-per-record layout, `Recording starts`
  prepended). Exact ResMed signal specs (labels, units, physical/digital scaling) are baked in from real
  files, so a constructed file's headers are what the device would write.

Read-only reverse of the decoder; no capture behaviour changes. 100% coverage, mutation-clean. The
BLE-stream→EDF wiring (auto-writing a night's files from a capture) and a full `STR` daily-summary
constructor are the next increment; the writer core already encodes all four types byte-accurately.
