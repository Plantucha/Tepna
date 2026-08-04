---
bump: minor
type: fixed
nodes: [Integrator]
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---

The constant-offset precondition's contract table justified its two "NOT safe" rows with a wearable
drift rate of "100+ ppm" — the beat-derived figure WEARABLE-DRIFT-DIRECT retracted. The measured
inter-device rate, taken directly off the two clocks in every capture file, is ~7 ppm: 202 ms over a
7 h night, not 2.5 s. The verdicts do not flip, which is why the stale number survived — the ordering
holds at both rates, so every assertion stayed green while the stated reason was wrong by an order of
magnitude. Adds `maxSafeSpanSec(resolutionSec, driftPpm)`, the precondition asked the way a caller can
act on: at the measured rate a constant offset is defensible for 2.4 h at PAT's ≤60 ms bar and 3.2 h at
beat matching's ±80 ms, where the retracted rate said ~10 minutes. A zero or non-finite rate refuses
rather than returning Infinity.
