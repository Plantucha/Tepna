<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [capture-host]
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

The ring's ACC is a zero-order hold: it measures at 1.5625 Hz while the capture path writes ~9.979 Hz
records, so ~84 % of records repeat the previous value. The record rate and the measurement rate are
now declared as two separate facts — coverage is judged against the record rate, anything counting
independent samples uses `nightqc.measurement_hz` — and the rate report publishes both with their
ratio. Separately, three raw-buffer opcodes carry no device clock and wrote a literal `0` in the
`sensor timestamp [ns]` column; `0` is in-band for a ns counter, so absence read as the instant zero.
The column is now written blank and `file_span_sec` returns None rather than a real 0.0 span.

Separately, and found by this unit's own test: the ACC run sidecar was written without ever being
fed — `acc`/`accraw` were in `RUN_MIN_BY_STREAM`, so the file existed and reported `runs=0` while
`write_acc` never called `feed`. Wired, and the sidecar now publishes `examined=` per channel and in
its trailer so "found nothing" and "never looked" are different bytes.

