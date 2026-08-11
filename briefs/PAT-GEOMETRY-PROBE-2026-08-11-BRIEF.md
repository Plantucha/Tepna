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
shape fires its own probe and *only* its own, and four controls — a clean noisy signal, a smooth trend,
a random walk, and a ppm-CORRECTED axis — fire nothing at all. Plus the real numbers each probe was built from: the nine
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
2026-08-04   1 ECG axis        ok           ladder 0.122/1.000  (see §3.1)
             3 PPG axis finger DRAWN        ladder 0.993/0.993
             5 lag finger      CENSORING, SATURATION   median 603, 59.8 % discarded
             6 binned finger   STEP, SATURATION        6 wraps, step-ratio 22.4
2026-08-05   3 PPG axis finger DRAWN, STEP  step-ratio  46.5     ← a genuine axis discontinuity
             4 PPG foot times  STEP         step-ratio 283.5        propagating into the feet
2026-08-10   1 ECG axis        ok           ladder 0.000/0.700   ← after the capture-side timebase fix
             3 PPG axis finger ok           ladder 0.291/0.626
             5 lag finger      CENSORING, SATURATION   median 238, 42.1 % discarded
             5 lag ankle       ok                      median 368,  0.4 % discarded
```

On 2026-08-04 the axes are clean at stages 2 and 4 and the defect enters at **pairing** — which is the
attribution the whole `PAT-WANDER-ELIMINATION` exercise spent nineteen tests failing to make.

### 3.1 · `drawn` needed THREE tolerances — the first version produced six false findings

Shipped with a single 1e-3 relative tolerance, `drawnAxis` reported the **ECG sample axis** as drawn at
exactly **1.000 on six real nights** whose host axis was applied and working. The arithmetic says why: at
130 Hz the deltas are 7.69 ms, so the tolerance is 0.0077 ms, while a 20.7 ppm correction changes each
delta by **0.00016 ms — 48× below it**. A corrected axis is indistinguishable from a synthesized one at
that resolution.

Fixed by computing the share at three tolerances and taking the verdict at the fine one. **The spread
across tolerances is the diagnosis**, and it separates the populations on real data:

| night · stage | fine (1e-6) | coarse (1e-3) | verdict |
|---|---|---|---|
| 2026-08-04 ECG axis | **0.122** | 1.000 | ok — corrected, was falsely `DRAWN` |
| 2026-08-07 ECG axis | **0.249** | 1.000 | ok — corrected |
| 2026-08-04 PPG finger | **0.993** | 0.993 | **DRAWN** — constant at both, a true ladder |
| 2026-08-10 PPG finger | 0.291 | 0.626 | ok — after the capture-side timebase fix |

`1.000 / 1.000` is synthesized; `1.000 / low` was never drawn at all. The `corrected` plant is now a
first-class fixture asserting exactly that, and it had to be rescaled onto the same range as the `drawn`
plant after the first cut spanned 0–952 ms and tripped the bounded probes — **the isolate-one-shape rule
broken by the very file that states it, twice in one session.**

⚠️ Even sharpened, confirm a `drawn` verdict against `hostAxis.applied` or the file's `# timebase=`
header before acting on it.

⚠️ **The scanner had this defect itself and it is worth keeping as a warning:** the first cut decimated
the axis to ~4000 points before probing, and decimation destroys a constant-delta signature — so it
reported `ok` on the O2Ring's known-synthesized axis. An inert detector reads exactly like a clean
result. `drawn` now takes a contiguous block and `step` takes the decimated series, because the two
probes need opposite samplings.

## 6 · `tools/geometry-passthrough.mjs` — testing the FUNCTIONS, not the data

§3's scanner runs the probes over real recordings, which characterises **data**: this night censors,
that night steps. It cannot say whether a function is *wrong*, because a real night's true geometry is
unknown — that is the thing being argued about. This is the software test, and it is the actual
mutation analogue.

A synthetic ECG and PPG are built whose lag is **flat by construction** — uniform sampling, constant
heart rate, every PPG foot placed exactly `LAG_MS` after its R-peak — and pushed through the production
chain. Any shape appearing downstream was introduced by the **code**.

```
case                          fs(ecg/ppg)  pairs  medLag   IQR  | probes fired
CLEAN — nothing planted        130.0/55.0   1787   256.9   0.0  | (none)
ECG host stamp STEP +400 ms    130.0/55.0   1787   857.2 600.0  | step
PPG host stamp STEP +400 ms    130.0/55.0   1787   490.7 400.0  | step
PPG host rate error +5000 ppm  130.0/54.7   1578   493.3 445.4  | sawtooth, step
ECG host rate error +5000 ppm  130.0/55.0   1608   457.0 455.5  | sawtooth, step
```

**A flat input comes back FLAT — IQR 0.0, six bin medians identical to six decimals.** The alignment
chain introduces no geometry of its own. And the converse holds: every planted input defect reaches the
output, so the chain is not merely quiet, it is *sensitive* — a chain that stayed silent on a planted
defect would be BLIND, which is the failure this repo has shipped before.

**A relative rate error produces a SAWTOOTH by construction.** Three real nights show that shape, and
until now the mechanism was inference; this is the first evidence it really is an ECG↔PPG rate mismatch
rather than something that resembles one.

(The recovered 256.9 vs a planted 300 is a definition offset, not drift: the foot is planted relative to
complex ONSET while `detectPeaks` reports the R PEAK, 35 ms later by construction — 300 − 35 = 265,
leaving ~8 ms of estimator bias.)

### 6.1 · The fixtures were wrong five times, and each was the same mistake

Building this found no defect in the chain and five in my own synthetic inputs. Every one was an
**unrealistically clean fixture**, and each produced a confident false result first:

| fixture defect | what it produced |
|---|---|
| plants outside `[200,650]` | bounded probes fired — read as a detector failure, was a fixture failure |
| `ramp` control with hash jitter | `step` fired, **correctly** — a hash contains real discontinuities |
| `sawtooth` with noiseless ramps | also fired `drawn` — a constant-slope ramp *is* locally a ladder |
| **three identical PPG channels** | the parser's replicated-column path collapsed them and applied a 125 Hz assumption, so a 55 Hz fixture parsed at 125 and every downstream number was scrambled by 125/55 |
| **a 12 ms QRS** (1.6 samples at 130 Hz) | Pan–Tompkins could not localise it, scattering the recovered lag by **130 ms on an input flat by construction** — which looked exactly like a chain defect |

The last two are the instructive ones: both looked like software findings and both were the fixture.
**A synthetic input must be physically plausible, not merely geometrically suggestive** — and the way to
tell is that the production code was right in every case.

### 6.2 · A constant series has no shape

The clean passthrough exposed a real probe defect: on a perfectly constant output the modal delta is
**0**, so `drawn`'s tolerance collapses to epsilon and `stepiness` divides by ~0 — and the probes
"found" two shapes in a flat line. `probeAll` now refuses a degenerate series outright. A diagnosis of a
constant is not a finding, and reporting one is the same false confidence these probes exist to remove.

## 4 · What this does NOT do

- **Not a gate on real data.** The gate asserts the *detectors*; the scanner is a tool. Wiring a probe
  into `PATGate` would need its own brief and its own threshold argument.
- **Not a diagnosis.** A fired probe names a shape and a stage. `drawn` at stage 3 does not say whether
  the cause is the device, the parser or the correction.
- **Not exhaustive.** Five shapes are the ones this project has actually been bitten by. A sixth will
  turn up; add it beside its plant.

## 5 · What the first corpus-wide run found

Fourteen nights, every stage. Three results worth keeping:

- **The O2Ring axis is drawn on 12 of 14 nights**, at fine-share **0.991–0.996** — and that number is
  the mechanism, not just a verdict: ~0.7 % of deltas differ, and at 125 Hz with ~60 bpm one inserted
  marker row per beat is 1/125 = 0.8 % of rows. The probe reproduced the marker-row signature
  independently of the work that first described it.
- **A new defect, localised in one pass: 2026-08-05 finger** — `3 PPG axis: DRAWN, STEP` (step-ratio
  46.5) propagating into `4 PPG foot times: STEP` (283.5). That is the night whose `duration_s` counter
  fit badly and whose dual-site result was internally inconsistent, and which had resisted explanation.
- ⛔ **The sawtooth is RARER than previously claimed.** It fires on **3 of 14** nights (1–2 wraps each).
  `PAT-WANDER-ELIMINATION` §1.2 says the censored nights "are the sawtooth"; most are **step +
  censoring**, a different shape with a different cause. That sentence should be read as corrected here.

## Done when

- [x] `tools/geometry-probe.mjs` — five pure detectors + `probeAll` + `plant`
- [x] `tools/geometry-scan.mjs` — six-stage walk over a real recording
- [x] `geometry-probe` group asserts the specificity matrix, the three silent controls, the real
      measured values, and that each probe can say NO on the shape it hunts
- [x] `npm run check` green

Related: [`PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md`](PAT-WANDER-ELIMINATION-2026-08-10-BRIEF.md) ·
[`PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md`](PAT-WINDOW-CENSORING-2026-08-11-BRIEF.md) ·
[`PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md`](PAT-DRIFT-STATISTIC-2026-08-10-BRIEF.md)
