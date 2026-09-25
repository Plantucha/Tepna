---
bump: patch
type: added
brief: none
---

The heap probe now records **`VmRSS` / `RssAnon` / `RssFile`** from `/proc/self/status` beside each
snapshot, so the next night carries the quantity the stall was blamed on next to the one tracemalloc
measures.

**Why it was missing is the interesting part.** The probe was armed to explain a resident-memory
climb — its own docstring quotes `RssAnon` **128 → 245 MB at ~21 MB/h** — and it recorded only
`traced_bytes`. On its first real night (2026-09-24 23:20 → 2026-09-25 00:21) traced grew **+9.2 MiB/h**
with no RSS figure captured at all, so the two could not be compared: traced bytes exclude C-level and
untraced allocation, RSS includes what Python has freed and glibc has not returned. **9.2 was not
evidence about 21**, and the probe could not answer the question it was built for.

§∅ throughout: an unreadable `/proc/self/status` or an absent key is `None` per key, never 0 — a kernel
without `RssAnon` (pre-4.5) and a process using no anonymous memory must not produce the same row. The
unit is **asserted** rather than assumed (`… kB`), because a row that silently changed units would be
indistinguishable from a 1024× leak. The parameter is last and optional, so an older caller still builds
a valid row, and that row says the RSS is unknown rather than omitting the field — a reader must be able
to tell an old row from a failed read.

Five tests: both quantities on one row, the unreadable file, a partially-present key set, a wrong unit
and a non-numeric value refused while the well-formed sibling is read, and the null default.

Residue `2026-09-25-heap-growth-is-json-retention-not-a-buffer-leak` records what the first run found:
the growth is dominated by JSON decode/encode retention (+182,469 `json/decoder.py` objects in an hour),
**not** by the window buffers — I read that path and `close()` drains every waiting window, so a stopped
stream's buffer is bounded by one per channel and is released.
