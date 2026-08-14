---
bump: minor
type: added
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

ECGDex can now pair its own Pan-Tompkins R-peaks against the H10's firmware RR intervals BEAT BY BEAT,
and reports WHERE that pairing holds rather than only how close the two agree on average.

`validateRR` already compared whole-record summaries — beats, mean, RMSSD, SDNN. Those are invariant to
WHICH beat matched which, so a recording whose beat correspondence has come apart still reports healthy
numbers. On 2026-08-10 the whole-night median |self − device| reads 4.88 ms and the beat counts match to
33 in 17 848, while the per-decile medians run

    2.36  2.33  2.22  2.27  2.31  |  16.93  17.26  25.94  27.76  30.79   ms

flat for half the night, then climbing monotonically. No existing gate can see that.

WHY INDEX ALIGNMENT AND NOT TIMESTAMPS. The `_RR.txt` header is `Phone timestamp;RR-interval [ms]` — the
stamps are ARRIVAL times, so differencing against them measures BLE batching rather than the detector.
Measured: arrival-gap minus device-reported RR has median -79 ms, SD 299 ms, p1-p99 spread 1275 ms; if
the intervals were arrival-differenced that would be ~0. The VALUES are device-measured even though the
AXIS is not, so the stamps are ignored entirely and the two interval series are aligned by index. (A
first attempt cumulated the device train from one arrival-stamped anchor: it drifted 510 ms across a
night and paired 63.6 %. Index alignment needs no axis, which is why the arrival-only header stops
mattering — the same exclusion applied to PpgDex's `_PPI.txt` is about the AXIS, not the intervals.)

A SINGLE GLOBAL OFFSET IS NOT SUFFICIENT, and assuming one flatters the result. The trains differ by a
few dozen beats over a night and that surplus is not necessarily at the ends; where it is distributed,
the pairing decays with beat index and mis-paired beats inflate the short-scale term or thin the
long-scale one. So the offset is re-fitted per third, the median |difference| is reported per decile, and
the longest trustworthy stretch is located.

THREE THINGS THE WIDER CORPUS CORRECTED, each of which had shipped as a plausible rule:

  · THE BASELINE IS THE BEST WINDOW, NOT THE FIRST. 2026-07-25 is bad at the START (17.5, 18.7), clean
    through the middle, bad again at the end. Referencing the first window made that file's own worst
    data the yardstick, so nothing exceeded it and the verdict read "uniform". Reporting a RANGE rather
    than a prefix length follows from the same observation.
  · THE RELATIVE TEST NEEDS AN ABSOLUTE FLOOR. Two detectors reading one ECG cannot meaningfully
    disagree by less than a sampling interval. A rise from 2.27 to 6.96 ms trips a purely relative 3x
    rule while sitting INSIDE one sample at 130.04 Hz; the genuine decays reach 25-50 ms, i.e. 3-7
    samples. Tolerance is now the looser of 3x-best and one sample, which also fixes a very good match
    driving the relative band toward zero.
  · THE MEDIAN FAN IS THE VERDICT; a differing per-third offset is reported BESIDE it, not OR-ed into
    it. A one-beat offset difference is common when every window is already sub-sample, and folding it
    in fired on recordings where nothing was wrong. Where a distributed surplus is real, both signals
    appear together.

AND IT CORRECTS A CHARACTERISATION MADE FROM ONE FILE. This was first described as "back-half
degradation" on the strength of 2026-08-10. Across the wider corpus the non-uniformity is more often a
degraded START — 15-28 ms across the first two deciles, then clean — sometimes with a bad end as well.
The verdict deliberately assumes no shape.

Which SIDE is dropping beats is not determinable from the intervals alone, so it is reported and not
corrected; guessing would fabricate the more interesting half of the answer.

No Allan deviation leg: ECGDex loads no Allan implementation, and a fourth one is explicitly out of
scope (`HOSTAXIS-STABILITY-2026-08-13-BRIEF` §4.3 — three exist and are pinned to each other). That leg
waits on `allanFromPhase` being promoted.

Additive and export-inert: a new DSP function plus its gate, no existing field changed.
