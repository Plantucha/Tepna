<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The end-of-night class-B back-check scanned STATUS columns as waveforms.

`nightqc.class_b_quality` took every column after the two stamps by POSITION. PPG2W's row is
`channel 0;channel 1;motion`, and `motion` is the ring's u8 stillness byte — a still ring writes `0`,
which is a rail by every distributional test. So the reader convicted the 24-bit stream's stillest
hours as its worst: on the 2026-09-06 night `ppg2w:ch2` carried 156 spans, 3,907,267 samples and a
700,409-sample run while the two real channels were clean; today's sessions read 136/7/65/9. The
H10's ECG was scanned behind its own `timestamp [ms]` column and reported as `ecg:ch1`.

The scan now selects columns from the file's OWN header by name, against a declared
`_NON_WAVEFORM_COLUMNS` set (stamps, `timestamp [ms]`, `motion`, `beat`) — a property of the format,
knowable in advance, and a denylist so a forgotten status column over-flags rather than a forgotten
waveform going unscanned. The box's `# timebase=` preamble no longer gets consumed as the header, a row
whose width disagrees with the header is torn rather than re-interpreted, and each block records the
`columns` it scanned so `<stream>:chN` resolves to a name.

Paired diff over two real nights (34 blocks): every real channel's count is unchanged — ring PPG
198/6/95/19/23/41/8, Verity 1/3, ECG 11 — and only the motion column's rows are gone. The plant is the
motion byte as the ring writes it (0 with brief stirs); an all-zero plant reads clean under the old
reader too and was verified to prove nothing.
