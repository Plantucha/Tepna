<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---

The stored file type selects a COMMAND FAMILY; it was never a wire field. `file_start_frame`'s
trailing u32 was named `ftype` and is a byte OFFSET, so every `--ftype N` / `pull.ftype: N` ever
tried asked the oximetry family to start reading at byte N — the stored raw-PPG store was
unreachable from this code, and `pull_session.py`'s "try a different --ftype" was a misdiagnosis.

Renamed to `offset`; `ftype=` survives as a deprecated keyword that RAISES on a non-zero value
rather than silently sending an offset. `pull.ftype` is refused at config load and names its
replacement. Added the type-1 family (`0x06` list · `0x07` start · `0x08` data · `0x09` end) and
`parse_ppg_file_header`, which returns None — never the SDK's 150 Hz — on a short or implausible
header. New `pull.file_family: oxy|ppg` (default `oxy`) and `pull_session.py --family ppg --list`,
a dry path that prints the frame it would send.

The 0x06-0x09 frames are UNPROBED: built from vendor SDK sources (OxyII family) and never sent to a
ring. The daemon does not dispatch them; the first probe is authorised separately. Default oximetry
behaviour is byte-identical, asserted against the pre-change implementation's own output.
