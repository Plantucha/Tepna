---
bump: patch
type: fixed
brief: none
---

The Integrator no longer reads a CGM wear that declares no cadence as a five-minute CGM. `glucoseMetricsInWindow` now takes the cadence from the median step of the cells' own stamps. When the cells give no step, the window coverage and `timeBelow70Min` are `null`. Before the fix, a fully covered 15-minute wear read coverage 0.34 and lost its glucose pair. A 1-minute wear published five times its real time below 70.

`adaptOxyDex` no longer places a synthesized desat or arousal at 1 Hz when the night publishes no sample count. It skips the event and counts it in the additive field `summary.undatedEvents`. Shrike found both sites in its absence audit of `integrator-dsp.js`, and Kestrel verified them on `origin/main`.
