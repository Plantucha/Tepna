---
bump: minor
type: added
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

The O2Ring inserts one `156` row per beat it detects. PpgDex counted those rows — the device-crystal
axis needs the count, to deflate them off the 125.000 Hz grid — and then discarded their POSITIONS,
because the code called the value `O2_PPG_INVALID`, a "missing-sample sentinel". That name asserted
the opposite of what the row means: a sentinel says data was lost here, a marker says a beat happened
here, and the second is a measurement. `DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md` §2 recorded the correct
reading; the code was never updated to match it.

Publishes them as `rec.beatMarkerSec` — the same rows `sentinelRejected` tallies, as times on the
published axis rather than a count. Seconds, not row indices, because the device-crystal path rebuilds
`relSec` underneath and an index would not survive it. Null for the wrist layout, where 156 is an
ordinary raw ADC count and claiming beats from it would fabricate a beat train out of signal.

Nothing about the waveform changes: an inserted row is still not an ADC sample, still excluded, still
never median-filled or interpolated. `sentinelRejected` / `sentinelKept` keep their names — they are a
published contract (`trio-batch`, `ppg-gap-bridge-scan`, the crystal-timebase gate) — and
`markO2Sentinels` stays reachable as an alias of the renamed `markO2BeatMarkers`.

The isolation test that separates a marker from genuine 156-valued signal was built from amplitude
statistics on a 90 s probe. It is now corroborated by a criterion it was never tuned against — the
regularity of the intervals it yields — on two full nights: the ISOLATED set (18 039 rows, 99.2 % of
all 156s) has a 1152 ms median interval, 52.1 bpm, 97.7 % of intervals within 0.5-2x the median; the
147 trend-consistent leftovers give 5296 ms, 11.3 bpm, 3.4 %. One population is a beat train and the
other is scattered signal, and the amplitude rule already told them apart.

What this buys: a beat fiducial that is SAME-DEVICE and SAME-STREAM, so it carries no inter-device
clock offset and no cross-channel common mode - precisely the blind spot that let the optical polarity
defect hide behind three agreeing LEDs. Against our own foot detector on three real nights the marker
lands 184.0 / 200.0 / 192.0 ms later with a MAD of 8.0 / 16.0 / 8.0 ms; 8 ms is ONE sample at 125 Hz,
so two independent detectors on the same stream agree to within the sampling grid.

Caveat recorded in the source: the marker is the firmware's DETECTION instant and carries an unknown
fixed latency, so it is sound for intervals (PPI/HRV) and for detector timing variability, and must
never be spent as an absolute PAT reference.

Additive only - no existing field changes and no export moves.
