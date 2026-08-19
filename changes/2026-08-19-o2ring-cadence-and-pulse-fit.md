---
bump: minor
type: added
brief: none
---

**Two O2Ring time-analysis tools, and one negative result that says a third is unnecessary.**

`tools/o2ring-frame-cadence.mjs` — settles "is the ring's ~1 Hz a firmware clock or host BLE framing?"
by measuring, not assuming. From `_PMDARRIVAL.csv` it reads the OXYLIVE duration counter
(`first_sensor_ns`) against host arrival; on a real night the device counter steps EXACTLY 1.000 s
(exact-tick 100 %, a dropped frame steps 2.000) beside a host clock that jitters (spread 464 ms →
`independent=true`). So the firmware 1 Hz checkpoint is real — but it lives in the DURATION counter,
which the onboard `.dat` also uses. From `_PPG2W.txt` it confirms the other half: ppg2w is 101.65 Hz
with `sensor ns = 0` (no device clock) and ~0.99 Hz frame re-anchor boundaries that are BLE delivery
events, not clock ticks. `independent` uses the Clock-Contract 2 ms spread rule; a drawn-host control
pins the false case.

`tools/o2ring-dat-timefit.mjs` — now fits the PULSE column alongside SpO₂ and cross-checks the two.
SpO₂ is a coarse 1 %-integer observable; pulse (bpm) is finer, so an agreeing pulse lag confirms the
SpO₂ lag with an independent, sharper column, and a disagreement flags a spurious fit. On 08-13 both
land at lag 4178 s (SpO₂ error 0.000, pulse 0.095 bpm) — pinning `.dat` sample 0 to host 20:21:58 and
thereby MEASURING ~47 s of RTC drift against the filename stamp.

**The `.dat` is its own 1 Hz clock — anchor once, count seconds.** Because the device tick is exactly
1.000 s (proven by the cadence tool) and the fit shows zero accumulated drift over the overlap, one
anchor plus `i × 1 s` timestamps every stored record. That is why the ppg2w→.dat fit is NOT shipped:
it is unnecessary (the `.dat` self-clocks from a single SpO₂/pulse anchor; ppg2w's own per-sample host
stamps already place its waveform on the same host timeline), AND it was measured underpowered —
ppg2w-derived 1 Hz HR recovered lag 1552 s vs the true 4178 s on a flat-HR fragment. A tool that
recovers the wrong lag is worse than none; recorded here so it is not rebuilt.

Both tools carry `--selftest` (cadence 11 assertions incl. drawn-vs-independent and seamless-ramp
controls; timefit 10 incl. a pulse-recovery leg and the agree/disagree cross-check). No bundle,
manifest, or fixture moves — analysis tooling only.
