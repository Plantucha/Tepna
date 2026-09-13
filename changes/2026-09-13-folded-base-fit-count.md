---
bump: patch
type: fixed
brief: ZEPHYR-INSTRUMENT-2026-08-23-BRIEF.md
---

`jitterfloor._folded_base` picked the wrong base interval on a stream with dropped frames, because its
score was a median residual over a population that is bimodal by construction. Scored by lattice fit
count instead, with candidates finer than the smallest observed delta admitted only when the deltas are
whole multiples of it. Measured: the 1-in-3-dropped fixture goes base 999 ms / jitter 248 ms → 499.5 ms
/ 2 ms; the 400/800 fixture whose true base lies below every observed gap still resolves to 200 ms; a
stream with genuinely irregular intervals keeps the coarse base, so its irregularity stays visible
instead of being subdivided to zero.
