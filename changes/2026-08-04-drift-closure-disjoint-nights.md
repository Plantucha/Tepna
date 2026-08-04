---
bump: patch
type: changed
nodes: []
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---

Runs the three-source drift closure the brief left open, and finds it cannot be run on this corpus
because its two requirements are satisfied by disjoint sets of nights.

The device-to-host legs need a box capture with a genuinely independent host clock, available from
2026-07-16 onward. The independent H10-to-Verity leg needs beat intervals in device-axis exports, which
exist only up to 2026-07-13. No night has both: the box nights' trio exports carry no interval series at
all, predating the interval-series export work, while the interval-bearing nights are phone captures
where dual-clock-rate reports no second clock, with a residual spread of exactly one stamp quantum
because the host column is the device stamp rounded.

The host legs themselves are solid and are recorded so the check is ready when the third leg exists.
Across five box nights the H10 runs -19.2 to -21.9 ppm against the host and the Verity -23.9 to -30.2,
predicting an H10-to-Verity rate of +3.9 to +11.0 ppm with a median of +5.7. That prediction is not the
closure; it is precisely the algebra the brief forbids passing off as one, and it is the number an
independent leg would have to reproduce.

The remedy is to regenerate the box nights' trio exports with the interval series, and specifically to
keep them on the device axis. Regenerated host-disciplined, the third leg becomes the difference of two
host-referenced series and the check can no longer fail.
