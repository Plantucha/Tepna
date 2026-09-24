<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`loss_audit._has_worn_evidence` resolves its column from each file's own header instead of by
position, so a night's wear evidence no longer depends on which column order the box happened to
write. The box wrote `_PPI.txt` with `sensor timestamp [ns]` second until 2026-08-05 — a field the
Polar PPI stream does not carry, written as a literal 0 — so a positional read of column 1 took that
fabricated 0 as the beat interval and scored 2026-08-04, a night of 24,997 measured beats, as
`worn_evidence: False`. A file that could not be opened, was empty, or names no such column now
reports null rather than "not worn": `False` is a verdict, and it is only ours to give when a column
was actually read.
