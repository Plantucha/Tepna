---
bump: minor
type: added
brief: none
---

The OxyDex night view shows six charts of the night:

- an Asleep/Awake strip per 30-s epoch
- SpO₂ per second, with the desaturations shaded
- desaturations per clock hour
- minutes at each whole SpO₂ percent
- pulse rate per second, with the periodic-breathing episodes shaded
- motion per 5-min epoch

A second with no sample is a gap in the trace.
The night object and the export carry the strip as a new `sleepWake` field.
The strip is a 2-state heuristic from motion and pulse rate, and it over-counts sleep.
A 4-stage heuristic failed its pre-stated criterion: REM fell in the second half of sleep on only 56 % of 39 nights, against a 70 % bar.
