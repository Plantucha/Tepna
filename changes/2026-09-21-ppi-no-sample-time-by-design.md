---
bump: patch
type: fixed
brief: none
---

Stop counting a Verity PPI frame's zero device stamp as an absent measurement — Polar documents that PPI/HR sample time "is either zero or missing" by design, and its SDK parser branches on exactly that — so the stream is declared timestamp-less once at onset instead of refused 7283 times a day, while every stream that does carry a sample time keeps the guard unchanged.
