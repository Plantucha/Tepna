---
bump: minor
type: added
nodes: []
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---

The three-source drift closure runs and passes on four of four box nights, with residuals between -0.3
and +3.0 ppm against tolerances near 7. It is a genuine check rather than algebra: the third leg is
derived from beat times on each device's own sensor nanosecond axis and never touches the host column,
so it could have failed.

Both Polar crystals run fast against the chrony-disciplined box, the H10 by 20.3 to 22.6 ppm and the
Verity by 27.6 to 29.6, making the Verity faster by 5.5 to 9.1; an independent beat-derived measurement
returns 7.0 to 10.7 for the same quantity. Adds tools/beat-leg-closure.mjs with a known-answer selftest.

Two sign conventions had to be established by planting truth, and both were assumed wrong first. Each
error alone yields a confident wrong answer, and neither convention is stated in prose anywhere.
dual-clock-rate reports a negative ppm when the device runs fast, since it fits host milliseconds per
device millisecond and subtracts one; planting a device fast by 20 ppm makes it report -19.5. Assuming
the opposite inverts the prediction and turns this closing triple into an 18 ppm inconsistency.

The matcher must also track rather than band-filter. With a fixed acceptance window, once accumulated
drift pushes the true lag outside it the estimator adopts the adjacent beat one interval away and the
trend inverts: a planted -20 ppm read +17.9, and on one real night it returned a value that agreed with
the then-assumed prediction closely enough to publish. Tracking from a seeded reference recovers -40 to
+40 ppm exactly under realistic variability, dropouts and arrival jitter. That safety is specific to
this regime, where block-to-block lag change is about 12 ms against a 1000 ms interval, and does not
generalise to the per-block offsets that defeated the earlier joint-unwrap attempt.
