<!--
  IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Found while executing:** the interval-series export (#615) and the O2Ring finger fold (#621) · **Affects:** the IBI-alignment claim made on 2026-07-31, `WEARABLE-SYNC-APPLIED` §open questions

# IBI sequences correlate strongly and cannot align these devices to under a second

On 2026-07-31, immediately after exporting per-beat intervals, this project reported that the IBI
sequence is a **better alignment signal than ACC↔ACC** — r = 0.532 against a circular-shift null of
0.032, a 16× margin, versus ACC's r ≈ 0.29 against 0.065 on the same night. That measurement is real.

**The conclusion drawn from it was wrong.** The two methods disagreed on the lag — IBI said 1.50 s,
ACC said 0.20 s — and rather than resolve the 1.3 s gap, the stronger correlation was reported as the
better instrument. It is not.

## What the correlation actually measures

Heart rate wanders over seconds to minutes (RSA, arousals, position changes). Two devices watching the
same heart track that wander together, and a cross-correlation of their interval-vs-time curves picks
it up easily. **That is slow co-variation, not beat correspondence** — and a 4 Hz grid with
forward-fill across short holes, which is how the 1.50 s was produced, cannot resolve sub-second lag
out of a signal whose informative structure lives at the tens-of-seconds scale.

## The measurement that settles it

Matching beats directly — for each ECG R-peak, the nearest following pulse foot — the delta should be
pulse arrival time: physiologically ~100–400 ms, tight. Measured across 6 box nights:

```
ECG → wrist    median 509–962 ms   IQR ~240–890 ms   mode unstable (20 / 230 / 510 / 580 / 700 / 1010 ms)
ECG → finger   median 499–960 ms   IQR ~240–890 ms   mode unstable (10 / 250 / 610 / 630 / 740 / 900 ms)
```

That is **near-uniform across the whole RR interval** — no beat correspondence at all. A mode that
moves from 10 ms to 1010 ms between nights is not measuring physiology.

### The control, which is what makes this a finding rather than a bug report

Wrist and finger are both optical, both through the same PpgDex code, both stamped by the same capture
host — so if the fault were in the time reconstruction they would be just as scattered:

```
2026-07-25  median   -6 ms   mode    0 ms    |Δ|<100 ms:  21 %
2026-07-26  median  -36 ms   mode -140 ms    |Δ|<100 ms:  16 %
2026-07-27  median  326 ms   mode  420 ms    |Δ|<100 ms:   5 %
2026-07-28  median  129 ms   mode  190 ms    |Δ|<100 ms:  12 %
2026-07-29  median   34 ms   mode  110 ms    |Δ|<100 ms:  26 %
2026-07-30  median  -27 ms   mode -410 ms    |Δ|<100 ms:  16 %
```

**Centred but broad.** Four of six nights sit within 36 ms of zero at the median — which is what two
sites on one body sharing a host clock must do, and it proves the timebase and the export are sound.
But only **5–26 %** of beats land within 100 ms of their counterpart.

So beat-level correspondence is genuinely poor in consumer PPG during sleep, in *both* optical streams
independently. "Nearest following foot" therefore picks the wrong beat most of the time, which is
exactly how the ECG→PPG deltas come out uniform.

## What this means

- **The IBI-sequence method as implemented is not fit for sub-second alignment on this corpus.** Its
  correlation is real and its null is honest; its *resolution* was never established, and was assumed.
- **ACC↔ACC remains the better sub-second instrument here** — 0.2 s on box nights, and its windowed
  concentration test is a resolution claim rather than a correlation strength.
- **The published 0.2–0.4 ms IBI synchronisation** (doi:10.1088/1361-6501/ae6a09) is not contradicted.
  It rests on beat correspondence this corpus does not have; a chest ECG against a clinical-grade
  peripheral channel is a different signal from a wrist PPG on a sleeping subject.
- **2026-07-27 is an outlier worth chasing** — wrist and finger disagree by 326 ms at the median and
  only 5 % of beats correspond. Every other night is inside ±36 ms. That is a per-night defect, not a
  method limit.

## The general lesson, which is the reason this is a brief and not a commit message

A stronger correlation was taken as a better instrument. Those are different properties: **r says the
two signals share structure; it says nothing about the scale at which they share it.** The 1.3 s
disagreement between two methods was the evidence that one of them was being read past its resolution,
and it was visible immediately — it was reported as an open question rather than treated as a
falsification.

## Done when

- [x] The 1.3 s IBI-vs-ACC disagreement is resolved, with the control that distinguishes a
      reconstruction fault from a physiological limit.
- [x] The 2026-07-31 claim that IBI is "the stronger alignment signal" is corrected in place.
- [ ] 2026-07-27's 326 ms wrist↔finger median is diagnosed — the only night outside ±36 ms.
- [ ] If sub-second alignment is wanted from intervals, the fiducial has to improve first: foot
      detection at 5–26 % correspondence cannot support it regardless of the statistic applied.
