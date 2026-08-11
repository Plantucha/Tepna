<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-11 · **Created:** 2026-08-11

# Every timeline defect here was a SHAPE — detect the shapes, not the symptoms

Six timeline defects have been found in this project. Every one was a **geometric signature**, none was
a wrong number, and each was noticed by eye — weeks apart, usually only after a wrong conclusion built
on it had already been published. This brief ships detectors for the five shapes and a scanner that
walks the alignment chain applying them stage by stage.

The design principle is borrowed from mutation testing: **the signature is the mutant.** A probe earns
trust by firing on a planted instance of its own shape and staying silent on the other four.
Specificity, not sensitivity — a detector that fires on everything would have "found" all six defects
and located none.

## 1 · The five shapes, and what each one cost

| shape | where it bit | what it cost |
|---|---|---|
| **SATURATION** | `driftRange` is bounded by the 450 ms pairing window and pins there — nine box nights over ~6 h read 420–442 | gated on for months as if it were a measurement; Phase 0 returned **0 GO** |
| **SAWTOOTH** | the ECG↔PPG offset ramps and wraps mod one RR (821–1162 ms) | a fixed window sliced it into something that read as slow physiological movement |
| **CENSORING** | `PHYS = [200,650]` treated as a plausibility filter | discarded up to **97.4 %** of beats; a night at 97.4 % with an 831 ms median lag still produced a confident PAT number |
| **DRAWN** | an axis synthesized as `index × assumed_rate` | carries no timing information yet is *smoother* than a real clock, so it wins any comparison that rewards smoothness — measured 34 ms "scatter" against the host axis's honest 61 |
| **STEP** | `hostAxis` discontinuity smeared across one anchor gap | the O2Ring steps **3796–22416 ms** against the H10's 16–40, and every shipped guard passed it |

## 2 · `tools/geometry-probe.mjs` — the detectors

Pure functions, no I/O, no clock: `saturation` · `sawtooth` · `censoring` · `drawnAxis` · `stepiness`,
plus `probeAll` and `plant(kind)`. The planted shapes live beside the detectors deliberately — a mutant
kept in a different file from the thing it tests drifts away from it.

**The gate asserts the full specificity matrix** (`geometry-probe` group, Node-lane only): each planted
shape fires its own probe and *only* its own, and three controls — a clean noisy signal, a smooth trend,
a random walk — fire nothing at all. Plus the real numbers each probe was built from: the nine
`driftRange` values read as saturated, the O2Ring's 8 ms ladder reads as drawn, and a jittered version
of the same rate does not.

**Two fixture defects had to be fixed first, and both are the same mistake this project keeps making.**
The first plants put `drawn` and `step` at values outside `[200,650]`, so the bounded probes fired on
them — which reads as a specificity failure of the detector when it is a defect of the fixture. A plant
must isolate exactly one shape, exactly as a mutation fixture that trips two rules at once tests
neither. The second: the `ramp` control used hash-shaped jitter, which puts occasional jumps many times
the typical delta into the series — that *is* a discontinuity, so `step` firing was correct. A physical
slow drift wobbles smoothly.

**`saturation`'s edge band is 10 % of the interval, and that is the band, not a tuned value.** The real
case it must catch is nine values at 93–98 % of a 450 ms ceiling; a 5 % band splits that population in
half. At 10 % a uniform series puts ~20 % of its mass in the two bands, so the 50 % threshold sits
clear of it.

## 3 · `tools/geometry-scan.mjs` — walk the chain

Six stages, in the order a sample travels: ECG sample axis → ECG beat times → PPG sample axis → PPG foot
times → R→foot lag → binned lag medians. Stage 5 pairs **without** the physiological window, bounded
only by `0.9 × the local RR` — the window is one of the things under test, so pairing through it would
hide the censoring it causes.

Measured, and the value is the **attribution**:

```
2026-08-02   every stage ok                                       (median lag 366, 0.1 % discarded)
2026-08-04   1 ECG axis        DRAWN        delta-share 1.000
             3 PPG axis finger DRAWN        delta-share 0.993
             5 lag finger      CENSORING, SATURATION   median 603, 59.8 % discarded
             6 binned finger   STEP, SATURATION        6 wraps, step-ratio 22.4
2026-08-10   1 ECG axis        ok           delta-share 0.700     ← after the capture-side timebase fix
             3 PPG axis finger ok           delta-share 0.626
             5 lag finger      CENSORING, SATURATION   median 238, 42.1 % discarded
             5 lag ankle       ok                      median 368,  0.4 % discarded
```

On 2026-08-04 the axes are clean at stages 2 and 4 and the defect enters at **pairing** — which is the
attribution the whole `PAT-WANDER-ELIMINATION` exercise spent nineteen tests failing to make.

⚠️ **`drawn` at stages 1/3 is a LEAD, not a verdict.** A host-disciplined axis interpolates between
anchors, so over a 5000-sample window its correction can be locally constant and the deltas come out
exact. The share separates the cases in practice — exact ladder 1.000, the O2Ring's legacy synthesized
stamp 0.993, a real corrected axis 0.61–0.74 — but confirm against `hostAxis.applied` or the file's
`# timebase=` header before calling an axis drawn.

⚠️ **The scanner had this defect itself and it is worth keeping as a warning:** the first cut decimated
the axis to ~4000 points before probing, and decimation destroys a constant-delta signature — so it
reported `ok` on the O2Ring's known-synthesized axis. An inert detector reads exactly like a clean
result. `drawn` now takes a contiguous block and `step` takes the decimated series, because the two
probes need opposite samplings.

## 4 · What this does NOT do

- **Not a gate on real data.** The gate asserts the *detectors*; the scanner is a tool. Wiring a probe
  into `PATGate` would need its own brief and its own threshold argument.
- **Not a diagnosis.** A fired probe names a shape and a stage. `drawn` at stage 3 does not say whether
  the cause is the device, the parser or the correction.
- **Not exhaustive.** Five shapes are the ones this project has actually been bitten by. A sixth will
  turn up; add it beside its plant.

## Done when

- [x] `tools/geometry-probe.mjs` — five pure detectors + `probeAll` + `plant`
- [x] `tools/geometry-scan.mjs` — six-stage walk over a real recording
- [x] `geometry-probe` group asserts the specificity matrix, the three silent controls, the real
      measured values, and that each probe can say NO on the shape it hunts
- [x] `npm run check` green

Related: [`PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md`](PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md) ·
[`PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md`](PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md) ·
[`PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md`](PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md)
