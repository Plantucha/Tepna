---
bump: patch
type: added
brief: O2RING-RAW-STREAMS-ABSENT-2026-08-04-BRIEF.md
---

Hardware-validated negative: the O2Ring exports neither raw red/IR nor raw 3-axis ACC. All 256 opcodes
swept with empty payloads, the 16 responders re-tested with arguments (byte-identical replies), and a
positive control proving the detector works in situ — `0x03` drains and scores 0.126 (one smooth
channel) while `0x05`'s fixed 922 bytes score at the 1.15 noise floor.

Records the false lead it nearly became: worn, `0x03`'s per-payload length differences are **buffer
accumulation, not channel selection** — docked, all payloads return identical bytes. Confirms `0xE1`
returns the device serial (`2592302100`, matching the firmware screen).

Consequence: PAT needs no red/IR (`0x03` already gives ~125 Hz pleth), but re-deriving SpO₂ under a
different calibration is impossible on this hardware — treat the ring's SpO₂ as a closed vendor output.
