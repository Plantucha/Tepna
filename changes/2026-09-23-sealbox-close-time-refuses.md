---
bump: patch
type: fixed
brief: none
---

`sealbox.closed_at_ms` returns None when no file mtime can be read, instead of `time.time()`. The
fabricated default put the SEAL time into a SIGNED sealed header as `closedAt` — the instant every
downstream reader (unseal, the Dex consuming the night) takes as the night's close — in-band and
indistinguishable from a real reading, off by however long the night sat before sealing. The caller
now refuses with NOT_RUN naming the race, reusing the existing precondition branch rather than
teaching the signed header a null `closedAt`. A per-file OSError mid-scan is skipped rather than
raised: a file that vanished between the listing and the getmtime is not a close time either.

ABSENCE-SURVEY row `sealbox.py:280` (default-reads-as-measured, high).
