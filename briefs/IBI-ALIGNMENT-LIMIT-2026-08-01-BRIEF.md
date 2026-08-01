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
- ~~**2026-07-27 is an outlier worth chasing**~~ — **withdrawn 2026-08-01. There is no defective
  night; see the next section.** It is the *best* night in the set.

## Diagnosed 2026-08-01 — the wrist↔finger table was measuring the wrong thing too

Chasing the 07-27 "defect" showed the fault was in my instrument, one level below where I had already
found one. `tools/beat-comb-analysis.mjs` (committed with this update; `--selftest` for the
known-answer, `--dir` for the corpus) replaces nearest-beat matching with a **lag sweep** — for each
candidate offset τ, count the wrist beats having a finger beat within ±100 ms of (t + τ).

**Why the sweep and not a better statistic.** Nearest-beat matching is bounded by ±RR/2, so its output
is a **circular** quantity; a linear median of it is undefined near the wrap. τ is unbounded, so the
sweep has no wrap to be undefined at.

What it shows is worse than a resolution limit:

```
night          meanRR   @lag0%   peak%   floor%   ratio   teeth   spacing (ms)
2026-07-25        979     19.8    20.1     16.6    1.21       0
2026-07-26       1177     16.5    18.4     15.4    1.19       0
2026-07-27       1164      4.7    39.7     15.6    2.54       6   1185 1145 1115 1150 1240
2026-07-28       1168     10.5    23.5     14.4    1.63       4   1245 1255 1580
2026-07-29       1174     23.5    33.9     15.3    2.21       5   1290 1280 1290 1270
2026-07-30       1141     16.4    23.9     14.0    1.70       1
```

**The coincidence curve is a comb whose period is the mean RR, with teeth of equal height.** On 07-27
the teeth stand at −3000, −1860, −720, **+420**, +1560, +2820 ms, each reaching 37–40 %, and the
tallest non-peak tooth is 94–100 % as tall as the peak on every night that has teeth at all. **The
offset is therefore identifiable only modulo one heartbeat.** No statistic escapes that — it is a
property of correlating two periodic trains, not of the estimator, the fiducial, or the data.

Three consequences, and they retire the two open items below:

1. **The old table's `|Δ|<100 ms` column was the comb sampled at zero lag.** The sweep's `@lag0`
   reproduces it to within 2 points on all six nights (19.8/21, 16.5/16, 4.7/5, 10.5/12, 23.5/26,
   16.4/16). It varies from 5 % to 26 % purely by where zero falls on the comb — it never measured
   correspondence.
2. **2026-07-27 has the highest correspondence of the six nights**, 39.7 % against a 15.6 % chance
   floor (2.54×). Its 5 % was zero landing in a trough, and its 326 ms median / 420 ms mode was the
   +420 ms tooth — a real tooth, and no more the true offset than the other five. Nothing about that
   night is defective.
3. **The claim that near-zero medians "prove the timebase and the export are sound" does not hold
   either.** The three nights whose peak sits near zero (07-25, 07-26, 07-30) are exactly the nights
   with almost no beat sharing — ratios 1.19–1.70, too low for teeth to form. A flat curve is centred
   at zero because it is flat. That is consistent with a sound timebase but is not evidence of one;
   the ACC↔ACC concentration test remains the thing that actually establishes it.

### The same comb explains this brief's *first* table

The ECG→PPG table at the top — "near-uniform deltas across the whole RR interval", modes jumping
10 → 1010 ms between nights — was diagnosed as poor foot detection. It is the same comb. Sweeping
ECG RR against both optical PPI trains on the same six nights:

```
$ node tools/beat-comb-analysis.mjs --dir <corpus> --pair all

night          pair            meanRR   @lag0%   peak%   floor%   ratio   teeth   spacing (ms)
2026-07-25     ECG→wrist          980     21.1    24.4     17.7    1.38       0
2026-07-26     ECG→wrist         1180     16.1    22.5     15.0    1.50       1
2026-07-27     ECG→wrist         1169     12.9    26.2     15.5    1.69       4   1110 1135 1165
2026-07-28     ECG→wrist         1190     15.2    24.6     15.4    1.59       2   1197
2026-07-29     ECG→wrist         1257     16.6    45.8     14.1    3.25       6   1210 1255 1255 1270 1265
2026-07-30     ECG→wrist         1177     21.0    39.9     14.0    2.85       6   1195 1200 1185 1200 1235
2026-07-25     ECG→finger         980     17.7    19.2     16.6    1.16       0
2026-07-26     ECG→finger        1180     15.8    20.1     15.4    1.31       0
2026-07-27     ECG→finger        1169     17.3    23.4     15.6    1.50       0
2026-07-28     ECG→finger        1190     17.0    22.6     14.4    1.57       2   1275
2026-07-29     ECG→finger        1257     23.4    39.8     15.3    2.60       6   1311 1341 1309 1165 1319
2026-07-30     ECG→finger        1177     17.5    20.2     14.0    1.44       0
```

Wherever beat sharing is strong enough for teeth to form at all, **the spacing is the mean RR again**
— 1110/1135/1165 on 07-27, 1195–1235 on 07-30, 1210–1270 on 07-29. And the argmax behaves exactly as
an argmax over a comb must: across the six ECG→wrist nights it lands at −1959, −909, +573, +2931,
−201 and +759 ms, hopping whole beats between nights. That *is* the first table's "mode unstable
10 → 1010 ms", seen with the wrap removed.

On the low-ratio rows (1.16–1.5, most of the ECG→finger column) no teeth form at all: those nights
share too few beats for the sweep to say anything, and their peak lag is noise. Reporting a mode for
them — as the first table did — was reading structure out of a flat curve.

So the original diagnosis (a fiducial too poor to match beats) was half right and drew the wrong
remedy. The fiducial *is* poor here, but fixing it would not deliver an offset: the ambiguity is
structural, not statistical, and it survives a perfect fiducial.

**The structural reason ACC↔ACC works and this cannot.** An activity envelope is **aperiodic**, so its
cross-correlation has one peak. A beat train is periodic by construction, so its coincidence curve
cannot have one, however good the fiducial gets. The design rule for anything downstream: **align on
aperiodic features.** This also sharpens the note on doi:10.1088/1361-6501/ae6a09 — a method reaching
0.2–0.4 ms from intervals must be resolving the comb ambiguity by some other means (a coarse prior
under one beat, or continuous tracking from a known start), not by matching beat times alone.

## The general lesson, which is the reason this is a brief and not a commit message

A stronger correlation was taken as a better instrument. Those are different properties: **r says the
two signals share structure; it says nothing about the scale at which they share it.** The 1.3 s
disagreement between two methods was the evidence that one of them was being read past its resolution,
and it was visible immediately — it was reported as an open question rather than treated as a
falsification.

**And the same mistake was one level down, in the control I used to make the point.** The wrist↔finger
table was offered as the thing that *proved* the timebase sound, and it was built from a linear median
of a circular quantity. The tell was there in the published numbers: a column ranging 5–26 % with no
mechanism proposed for the spread, and one row flagged as a defect purely because it was furthest from
the others. **An unexplained outlier is more often a broken instrument than a broken night** — and the
cheapest check is to ask what the statistic does when its assumptions fail, before going to look for
the defect it implies.

## Done when

- [x] The 1.3 s IBI-vs-ACC disagreement is resolved, with the control that distinguishes a
      reconstruction fault from a physiological limit.
- [x] The 2026-07-31 claim that IBI is "the stronger alignment signal" is corrected in place.
- [x] 2026-07-27's 326 ms wrist↔finger median is diagnosed — **2026-08-01: not a defect.** It is the
      +420 ms tooth of a comb with period = mean RR, and the night has the *highest* beat
      correspondence of the six (2.54× chance). The measurement is now reproducible via
      `tools/beat-comb-analysis.mjs`, which the original table was not.
- [x] ~~If sub-second alignment is wanted from intervals, the fiducial has to improve first~~ —
      **superseded 2026-08-01: a better fiducial would not help.** Beat-time matching identifies the
      offset only modulo one heartbeat regardless of fiducial quality, because both trains are
      periodic. Sub-second alignment must come from an aperiodic feature (ACC envelope, desaturation
      onset), with intervals at best refining *within* a beat once a coarser method has picked which
      beat.
