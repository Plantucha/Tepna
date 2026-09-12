<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
**The ring's header-only pruner deleted resumed files — a live session lost its `_SPO2.csv` and an
800 KB `_ACCRAW.txt` on 2026-09-12.** `rows` counts the rows THIS process wrote; a file-set resumed
within `_RESUME_WINDOW_S` reopens the same paths in append mode, so an episode that delivered 0 rows
for a stream read as "header-only" and `os.remove` took the whole prior file. `run_polar` got the
`resumed` guard on 2026-09-03; `run_oxyii` (whose comment said "exactly as run_polar does") and
`run_viatom` never did.

- `Spo2CsvWriter`, `RingClockLogWriter`, `OxyFrameLogWriter` now expose `resumed` — they already
  computed it to choose append over truncate, and threw it away. Only `StreamWriter` carried it, so a
  guard written against that class would have kept ACCRAW and still deleted SPO2.
- Both ring teardowns consult it, **default to KEEP when a writer cannot say** (`getattr(w,
  "resumed", True)` — the wrong keep costs a header-only file, the wrong delete costs the night), log
  the keep at INFO by filename, and discard through `StreamWriter.discard()` so a RUNS sidecar is not
  orphaned.
- Tests: every writer class in the ring prune tuples reports `resumed`; both sites are scanned for the
  guard and the fail-safe default; `run_oxyii` and `run_viatom` are driven over planted earlier-episode
  files with a 0-row episode and must leave them byte-identical.

Captured bytes already lost are not recoverable; nothing here rewrites a recording.
