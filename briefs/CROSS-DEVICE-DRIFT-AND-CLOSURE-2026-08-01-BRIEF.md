<!--
  CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-01 · **Follows:** `IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md` §Retraction · `ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md` §3.7 · **Affects:** every cross-node measurement in the suite that assumes one timeline

# Two devices are never on one clock, and the suite has been assuming they are

## 1 · The finding, in one line

**Body-worn devices drift relative to each other by tens to hundreds of ppm — enough to walk past a
whole heartbeat inside one night.** Every cross-node measurement that fits a *single* offset per night
is therefore measuring a moving target, and reports the movement as noise, as poor coupling, or as a
physiological limit.

This is not a hypothesis. It has now been reached three times independently, twice by sessions that
retracted their own earlier conclusions on the way:

| reached by | via |
|---|---|
| `ENVELOPE-ANCHOR-EXPORT` §3.7 | refitting locally after two self-retractions; 16 % → 90.6 % correspondence |
| `IBI-ALIGNMENT-LIMIT` §Retraction | re-running its own tool per 5-min block; 5–26 % → 43–98.8 % |
| this brief | three-corner closure across ECG / Verity / O2Ring |

## 2 · What was measured

Six nights carrying all three interval sources — H10 RR (chest ECG), Verity PPI, O2Ring PPI. Per
5-minute block, each **pair's** offset is refit independently; the slope of that offset against time is
the pair's relative drift.

### 2.1 · Beat correspondence is high once drift is removed

| night | one offset per night | refit per 5 min | best block |
|---|---|---|---|
| 2026-07-25 | 20.2 % | 43.0 % | 61.9 % |
| 2026-07-26 | 18.5 % | 55.3 % | 92.5 % |
| 2026-07-27 | 39.9 % | **98.8 %** | **100 %** |
| 2026-07-28 | 23.6 % | **90.0 %** | **100 %** |
| 2026-07-29 | 34.0 % | **92.5 %** | **100 %** |
| 2026-07-30 | 21.1 % | 62.5 % | **100 %** |

**Chance control** — partner shifted +1 h, identical per-block ±3 s search, so the same degrees of
freedom: **22.4–27.1 %** on every night. The gain is not the extra freedom.

### 2.2 · The per-block offset is a PHASE, and it must be unwrapped

The search window spans several comb teeth (`IBI-ALIGNMENT-LIMIT`: two periodic trains give a
coincidence comb one RR apart). As the true offset drifts past a tooth boundary, the argmax falls back
exactly one RR. On 2026-07-27 ECG↔Verity the raw per-block series climbs +20…40 ms per block and then
jumps −1160 ms, fifteen times across the night:

```
block 85    680 ms   +20
block 90   -480 ms  -1160   ← one RR
block 100   760 ms  +1200   ← one RR
block 105  -380 ms  -1140   ← one RR
```

Fitting a slope through that measures the sawtooth, not the clock. **Unwrap by whole RRs first** —
the same step any phase measurement needs, and the one this analysis was missing.

### 2.3 · Three-corner closure is a free check, and it is what caught the missing unwrap

Three devices give three pairwise drifts, and they are **not independent**: pairwise rates are
differences of three absolute rates, so

```
d(ECG↔Verity)  ≡  d(ECG↔O2Ring) − d(Verity↔O2Ring)
```

must hold exactly. It costs nothing to compute and it is a genuine falsifier. Before unwrapping it
failed on **every** night (8–95 ppm residual). After unwrapping:

| night | ECG↔VE | ECG↔O2 | VE↔O2 | closure residual | worst pair corr | blocks |
|---|---|---|---|---|---|---|
| 2026-07-27 | 97.2 | 71.1 | −28.3 | **−2.2** ✓ | 96 % | 86–88 |
| 2026-07-28 | 100.5 | 264.6 | 157.1 | **−7.0** ✓ | 91 % | 86–94 |
| 2026-07-29 | −21.1 | −9.5 | 50.0 | 38.5 ✗ | 95 % | **29–32** |
| 2026-07-25 | 215.6 | 65.0 | 114.3 | 264.8 ✗ | 47 % | — |
| 2026-07-26 | 90.3 | 754.7 | 565.3 | −99.1 ✗ | 59 % | — |
| 2026-07-30 | 22.2 | 183.3 | 18.8 | −142.3 ✗ | 66 % | — |

**Closure holds to ≤7 ppm where a night has both high correspondence (≥91 %) and enough blocks (≥86).**
Where a pair locks poorly the phase is undersampled, the unwrap picks the wrong multiple, and the drift
figure is meaningless — 754 ppm is not a crystal, it is a broken unwrap.

**So: a drift figure without a closure check is not evidence.** That includes the "up to 123 ppm"
quoted in `IBI-ALIGNMENT-LIMIT`'s retraction, which survives on 07-28 (157 ppm, closure −7.0) but
should not have been stated for the nights that do not close.

### 2.4 · Control — the drift is in the CLOCKS, not in the beat detection

Every interval used here is **waveform-derived**, never a device file: ECGDex `timeseries.rr` is
*"SELF-COMPUTED, sub-sample-refined Pan-Tompkins R-peaks, Malik-corrected"*, and both PPI series are
*"SELF-COMPUTED optical spine (3-LED consensus → buildPPI → Malik correctRR)"*, `spine: foot`. That is
required, not preferred — CLAUDE.md records that the Verity's `_HR.txt` is all-zero and its `_PPI.txt`
header-only (measured tonight: **107 of 107** files), and the H10's `_HR.txt` is firmware-smoothed.

But the H10 *does* write a real `_RR.txt`, which makes a control available for the one device that has
one. Run through the **built-in comparator** (`ECGDSP.validateRR`) rather than a fresh one:

| night | nSelf | nDev | dMean % | dRMSSD % | closure |
|---|---|---|---|---|---|
| **2026-07-27** | 21 872 | 20 999 | **0.23** | **1.2** | **−2.2 ✓** |
| 2026-07-28 | 23 449 | 17 001 | 3.26 | 5.6 | **−7.0 ✓** |
| 2026-07-25 | 30 993 | 7 475 | 1.09 | 0.3 | 264.8 ✗ |
| 2026-07-30 | 20 155 | 7 043 | 0.76 | 0.6 | −142.3 ✗ |
| 2026-07-29 | 7 172 | 20 174 | 5.26 | 6.6 | 38.5 ✗ |
| 2026-07-26 | 22 460 | **86 881** | **21.67** | 18 | −99.1 ✗ |

**On the night where closure holds best, the waveform RR reproduces the device's own to 0.23 % in mean
and 1.2 % in RMSSD.** Beat extraction is therefore not the source of the drift — the clocks are.

Two caveats, stated because the table invites over-reading. The `nDev` counts swing from 7 k to 87 k
against ~20–30 k self beats: this harness concatenates every `_RR.txt` in a night directory without the
concurrency filtering `trio-batch` applies, so on nights with many overlapping sessions the device side
is inflated and `dMean` is partly an artifact of that, not of the device. And a **low `dMean` does not
imply closure** — 07-25 and 07-30 agree well with the device yet fail closure, because their *optical*
pairs lock poorly. The control bounds one failure mode; it does not certify the night.

### 2.5 · The corpus is exactly six nights, and that is a hard bound

Three-source nights require the O2Ring's live PPG, which capture began **2026-07-25**. 2026-07-31 has
all three raw streams but its `Wellue_..._SPO2.csv` is **zero rows**, so the fold has no ring anchor —
a file-present-but-empty case, the same class as `CPAP-SA2-OXIMETRY-SOURCE`'s sentinel channel. Six is
the whole corpus and it will not grow backwards.

## 3 · Where this bites in the project — the part that is not about this analysis

### 3.1 · Anything that fuses two nodes over a night

The Integrator's whole premise is that `tMs` puts every node on one timeline (Clock Contract §1: *"two
devices recording the same wall-clock minute produce the same `tMs` by construction"*). That is true of
the **encoding** and false of the **clocks**. Every consumer of a per-night offset inherits it:

- **`fitClockOffsetPooled`** fits one offset per night. For CPAP↔wearable that is currently safe —
  measured CPAP drift is −9…−29 ppm, i.e. 0.24–0.78 s across a night, far below the fit's 15 s
  support. For **wearable↔wearable at 100 + ppm it is not safe**, and nothing marks the difference.
- **Event-coincidence measures** (`_coincidenceCurve`, the desat↔surge coupling, the cross-channel
  latency table in `POOLED-CLOCK-FIT-FOLLOWUPS` §1) all match within a fixed window across a whole
  night. A drift larger than the window silently thins every pairing in the second half.
- **The transit measurements** (apnea → desaturation, median 53 s) used the CPAP fit, so they are in
  the safe regime — but that is luck, not design, and it is not recorded anywhere as a precondition.

### 3.2 · PAT becomes reachable, which it currently is not

`pat-gate.js` wants beat-to-beat IQR ≤ 60 ms. Measured with one offset per night, the IQR is 264–330 ms
and — crucially — **flat across the whole offset sweep, with a chance control sitting inside the range**
(`ENVELOPE-ANCHOR-EXPORT` §3.6). Measured per block, it is **43–112 ms, median ≈50 ms**.

That does not declare PAT feasible: the gate also wants coupling ≥55 % and a median lag in [60,700] ms
established as a real pulse-arrival delay. It does mean **the alignment precision PAT needs is
reachable on this hardware**, which the previous measurement concluded it was not. PAT is the largest
single unlock in the suite's roadmap and it was closed on a measurement artifact.

### 3.3 · The capture host is the right place to fix it, not the DSPs

`ENVELOPE-ANCHOR-EXPORT` §4 direction 3 already argues this and it is strengthened here: the vigil box
holds both raw streams and already disciplines its own clock (chrony, local stratum-1, 0.008 ppm). It
can measure the device-to-host offset **continuously**, at capture time, where the raw data still
exists — rather than every downstream analysis re-deriving it from summaries. A per-session
`driftPpm` + `offsetMs` pair costs bytes, not a contract redesign.

The alternative — carrying an envelope in the node-export — is costed in `ENVELOPE-ANCHOR-EXPORT` §4
and no option is obviously right: 4 Hz is ~700 KB, 1 Hz is affordable but not sub-second, and anchors
(measured) are too sparse at 3 usable pairs per night.

### 3.4 · The over-determined check generalises beyond clocks

Closure worked here because three pairwise measurements of a three-body system have one constraint.
The suite already uses the same idea for **amplitude** — `integrator-tch.js` decomposes per-device σ
from three pairwise variances without a reference. It has never been applied to **timing**.

Once closure holds on more nights, the same three-cornered hat gives **per-device timing jitter**: not
just how pairs differ, but *which* clock is unstable. That is the question a fleet operator actually
has, and it is unanswerable from any pair.

## 4 · The method lesson, which is the most portable part

Three sessions reached the same wrong conclusion tonight — *"beat correspondence is physiologically
poor"* — and all three had run **honest chance controls that passed**. A circular-shift null, a +1 h
shift, a shuffled-anchor surrogate: each correctly says *"you beat chance"*. **None of them can say
your model is too simple.**

What exposed it was not a better statistic. It was:

1. **refitting locally and watching the parameter march** (a constant that will not stay constant is a
   missing term), and
2. **an over-determined consistency check** — closure — which has no free parameters to absorb the
   error.

`AUDIT-PROMPT.md` and the deep-audit charter already hunt hollow gates. This adds a sibling class worth
naming: **a model that is too simple passes every control you can build out of its own assumptions.**
The defence is redundancy in the measurement, not more surrogates.

## 5 · Done when

- [ ] Drift is measured with **unwrapping** and reported with a **closure residual**; a figure without
      one is not published. `tools/beat-comb-analysis.mjs --local` gains both, or a sibling tool does.
- [ ] The unwrap is made robust by using the closure constraint across all three pairs **jointly**
      rather than unwrapping each pair independently — three pairs with one constraint is
      over-determined, which is the actual leverage three devices give.
- [ ] A stated **precondition** wherever a per-night constant offset is used: the pair's drift × night
      length must be small against the measurement's own resolution. `fitClockOffsetPooled` should say
      so in its contract, since it is safe for CPAP and not for wearable↔wearable.
- [ ] PAT re-tested under drift-aware alignment, against `pat-gate.js`'s full bar (IQR **and** coupling
      **and** a physiological median), on the nights where closure holds.
- [ ] A decision recorded on §3.3: capture-time offset measurement vs an exported envelope. Both are
      costed; neither is chosen.
- [ ] The **PPI** side gets the same control the RR side has. `PPGDSP.validatePPI` exists and is
      wired, but there is nothing to compare against: the Verity's `_PPI.txt` is header-only on 107 of
      107 files and the O2Ring writes no PPI at all, so the optical spine is currently **unvalidatable
      against hardware**. Either a device that emits real PPI, or an accepted statement that the
      optical intervals are checked only against each other and the ECG.
- [ ] Per-device timing jitter via three-cornered hat — **only after** closure holds on more than two
      nights. Applying TCH to mutually inconsistent inputs would be the same error one level up.

## 6 · Guardrail

**Do not quote a ppm figure that has not closed.** The six nights here produce drift estimates spanning
−21 to +754 ppm; two of them are credible. The rest are unwrap failures wearing the same units, and
they are indistinguishable from real measurements without the closure column beside them.
