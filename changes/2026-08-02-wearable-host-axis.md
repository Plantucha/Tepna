---
bump: minor
type: fixed
brief: WEARABLE-HOST-AXIS-2026-08-02-BRIEF.md
---

Discipline the exported PpgDex/ECGDex time axis to the capture host's clock instead of the device
crystal. Both nodes read the host stamp only once (to anchor `t0Ms`) and then rode the device's own
`sensor timestamp [ns]` / `timestamp [ms]` column for the whole recording, while a chrony-disciplined
stratum-1 clock sat unused in column 0 of every row. Measured cost with no fitting: −0.70 s over 434 min
(H10), −0.34 s over 189 min (Verity), and −18.49 s over 190 min on the O2Ring — the last non-linear, so
no single rate could remove it.

New `DexClock.hostAxis()` samples host anchors 1 row in 500, rejects outliers with a running median and
interpolates. The correction is slow enough that RR/PPI intervals are preserved (a 1 s interval survives
as 999.14 ms) and robust enough that ~100 ms of BLE jitter is not injected into beat times. It refuses
beyond ±50000 ppm rather than fabricating a timebase, distinguishes a transient spike from a sustained
step, and reports `maxStepMs` where it cannot correct one.

Also fixes `tools/dual-clock-rate.mjs`, which selected fragments by file size rather than span and so
quoted the same H10 at −20.3 ppm (373 min) and −65.8 ppm (10.9 min) with equal weight.

MINOR rather than PATCH: node exports gain an additive `hostAxis` block, and exported sample/beat times
move by a real, measured amount. ECGDex/PpgDex fixtures regenerated via the sanctioned regen tools and
re-verified green against the real corpus.
