<!--
  CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (deferred 2026-08-27 — every executable item is closed; the single remaining box is ⛔ BLOCKED on **corpus**, not on effort: it needs nights with ≥2 fragments per device AND consistent legs, and where such nights exist the closure FAILS) · **Created:** 2026-08-01 · **Follows:** `IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md` §Retraction · `ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md` §3.7 · **Affects:** every cross-node measurement in the suite that assumes one timeline · ⛔ **§2.3 and §2.6 VOIDED 2026-08-03** — their third corner is the O2Ring's drawn axis (see the banners) · **DRAIN 2026-09-02 (Osprey) — the BLOCKER'S FRAMING IS WRONG and is corrected here; the park stands on the corrected reason.** The header says the last box is blocked on **corpus** (nights with >=2 fragments per device). ⚠️ **CORRECTED 2026-09-02 (Osprey) — the conclusion was right and the EVIDENCE was wrong.** This stamp originally cited *"237 PPG fragments on 2026-08-16 alone"*. That specimen cannot support the claim: **2026-08-16 has ECG = 1**, so it is single-fragment on the H10, while the box's requirement is ≥2 fragments **per device** — I counted one stream and asserted about both. Measured properly over the 46 box nights carrying both streams: **37 have ≥2 fragments on BOTH devices**, 9 are ECG-single, 0 are PPG-single. Better specimens are `2026-07-18` (ECG 110 / PPG 555) and `2026-07-19` (ECG 34 / PPG 459). So multi-fragment nights ARE abundant, and this brief's *"mostly single-fragment (H10 on 20 of 33 nights, Verity on 18)"* does not describe the current box corpus. ⚠️ **This is NOT an unpark.** The blocker has two clauses — ≥2 fragments per device **AND consistent legs**. Clause 1 is satisfied on 37 nights; **clause 2 is unmeasured**. So the stated DATA blocker is substantially wrong for this corpus and what remains is a DIFFERENT park from the one written down: an unmeasured leg-consistency question, not a shortage of fragmented nights. So the item is not waiting on data. What the header's own parenthesis already concedes is the real state: *where such nights exist the closure FAILS*. That is a **negative result**, not a block. **Owner: Osprey. Next step:** one work-unit to either record the failed closure as the brief's answer (-> DONE with a negative) or state why the failure is not yet conclusive — NOT more corpus.


> ### 🔴 PARKED, NOT ABANDONED — 2026-08-27, and the status vocabulary is the reason it still reads PROPOSED
>
> 8 `[x]`, 1 `[⛔]`, **zero open**. §📌's status set is exactly five values and **BLOCKED is not one of
> them**, so a brief whose only remainder is blocked is parked as `PROPOSED (deferred …)` with the reason
> inline — not flipped to DONE, which would claim work that has not happened.
>
> **What the measurement concluded** (§PAT box): 49 nights → 33 with both devices → **7 bandable** →
> PASS 3 · FAIL 2 · REFUSE 2. But the three passes are **not** evidence of closure. The verdicts separate
> **perfectly by band width** — the three PASSes hold the three widest bands (9.64 / 12.49 / 20.56), the two
> FAILs the two tightest (4.16 / 0.71), with no overlap. **A dispersion-derived band used as an inclusion
> gate anti-selects for measurement quality:** noisy legs earn a band nothing can fail, consistent legs earn
> a sharp band a real discrepancy does fail. Every night where the test had power, the closure **failed**.
> 2026-08-24 "passes" on a ±20.56 ppm band — wider than the entire measured spread of device rates — which
> is a verdict that is computable and carries no information.
>
> ⚠️ **So this box does not unblock by widening bands or by finding more nights of the same kind.** It
> unblocks when the corpus carries nights with **≥2 fragments per device AND consistent legs**. The present
> corpus is mostly single-fragment (H10 on 20 of 33 nights, Verity on 18), which is why only 7 were bandable
> at all.

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

> ### ⛔ VOID — the O2Ring corner was never a clock (added 2026-08-03)
> Both sections below rest on a **three-device** geometry whose third corner is the O2Ring, and the
> O2Ring's `sensor timestamp` column is **drawn, not measured**: the device emits no per-sample
> timestamp, so capture built the axis as `sample_index × an assumed rate`. Its apparent ppm is the
> error in that constant — the same night reads **+783 ppm** on a fragment written at 125.738 Hz and
> **+92 ppm** on one written at ~128.024 Hz.
>
> Two of the three pairwise rates contain that corner, so the closure identity was being asked to hold
> over two comparisons against a drawing and one real measurement. **The closure residuals and the
> normalised per-device rates below are void, and the TCH degeneracy (ρ = 0.45–0.79, negative
> variances) needs no correlated-physiology explanation** — a drawn corner produces exactly that.
> The **ECG↔Verity** pair is unaffected; neither of its ends is the ring.
>
> Computed, not remembered: `quality.timingSource` and `hostAxis`'s `independent`/`spreadMs`, gated by
> `ppgdex · axis-provenance`. See `O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF.md`.

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
header-only (**113 of 113 real files**; the 4 `_PPI.txt` with rows are `uploads/synthetic/` twins — recounted 2026-08-08), and the H10's `_HR.txt` is firmware-smoothed.

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

Six is the whole corpus and it will not grow backwards. The reason is worth stating exactly, because
the obvious version is wrong and would send someone looking in the wrong place.

**It is not that the O2Ring started late. It is that ALL optical raw starts late.** Counted across
every tree on disk:

```
raw H10 ECG        40 dates
raw Verity PPG      7 dates   2026-07-25 … 07-31
raw O2Ring PPG      7 dates   2026-07-25 … 07-31
pair ECG + Verity   7
trio, all three     7
```

The chest ECG is plentiful; the binding constraint is the **optical waveform**, and both optical
devices begin on the same date. 2026-07-31 then falls out because its `Wellue_..._SPO2.csv` is **zero
rows**, so the fold has no ring anchor — a file-present-but-empty case, the same class as
`CPAP-SA2-OXIMETRY-SOURCE`'s sentinel channel. Seven raw, six foldable.

**And `trio-onset`'s 36 nights are not a larger corpus in disguise.** They look like one: 36 PpgDex
exports spanning 2026-06-10 → 07-30. But **0 of 36 carry `timeseries.ppi`** — they were folded before
the beat series existed. A beat series can only come from a fresh fold, a fresh fold needs raw
waveforms, and the June raw is **gone from every tree**. What survives June is exports that predate
the field this analysis needs.

That is the third time in one night a measurement has been bounded by raw data discarded after
folding — with 2026-07-23's clock-fit night and the ODI-4 paper's corpus (`PAPER-ODI4-REPRODUCIBILITY`
§2). The pattern is worth naming: **an export is not a substitute for its input.** Once a new field is
added, every night whose raw is gone is permanently out of reach for it, and no amount of re-analysis
recovers that. Nothing here proposes a retention policy; it does argue that one is a real question and
that "we still have the exports" is not an answer to it.

Nor can anything else substitute. A drift measurement needs **two beat sources**; the second is always
optical, so it is capped at the same 7 dates. Event channels will not do it either —
`ENVELOPE-ANCHOR-EXPORT` measured exactly that and got **3 usable pairs a night from 75 movements**.

> ### ⛔ VOID — the O2Ring corner was never a clock (added 2026-08-03)
> Both sections below rest on a **three-device** geometry whose third corner is the O2Ring, and the
> O2Ring's `sensor timestamp` column is **drawn, not measured**: the device emits no per-sample
> timestamp, so capture built the axis as `sample_index × an assumed rate`. Its apparent ppm is the
> error in that constant — the same night reads **+783 ppm** on a fragment written at 125.738 Hz and
> **+92 ppm** on one written at ~128.024 Hz.
>
> Two of the three pairwise rates contain that corner, so the closure identity was being asked to hold
> over two comparisons against a drawing and one real measurement. **The closure residuals and the
> normalised per-device rates below are void, and the TCH degeneracy (ρ = 0.45–0.79, negative
> variances) needs no correlated-physiology explanation** — a drawn corner produces exactly that.
> The **ECG↔Verity** pair is unaffected; neither of its ends is the ring.
>
> Computed, not remembered: `quality.timingSource` and `hostAxis`'s `independent`/`spreadMs`, gated by
> `ppgdex · axis-provenance`. See `O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF.md`.

## 2.6 · Normalised, and put through the repo's own three-cornered hat

Closure is not all three devices give. Two further steps, both using code the suite already ships
(`integrator-tch.js`, written for amplitude σ and never pointed at timing):

**Normalisation.** Where closure holds, pairwise rates are exact differences, so picking a reference
device and expressing the others against it is lossless. On 2026-07-27 with the chest ECG as
reference: **Verity +97 ppm, O2Ring +71 ppm** — both wearables run fast against the strap. This is
only ever *relative*; no wearable triple yields an absolute rate. The capture host could — chrony on
the vigil box holds 0.008 ppm — which is §3.3's argument, strengthened.

Normalisation is also what makes the data *shaped* for TCH: `threeCorneredHat` and `allanTriplet`
want three per-device series, not three pairwise differences. The two steps are one step.

**Three-cornered hat — and it must be detrended first.** TCH decomposes **noise** variance. A 100 ppm
drift is a deterministic trend, and feeding the raw offset series in makes the tool measure the trend:
done that way the repo's implementation returns `ok:false — negative variance; no non-negative
correlated fit ≤ rhoMax` on **both** closing nights. Detrend each normalised series first (Theil–Sen,
as the drift fit already does) and it resolves:

| night | closure | method | ρ | σ ECG | σ Verity | σ O2Ring |
|---|---|---|---|---|---|---|
| **2026-07-27** | **−2.2** ✓ | **classic** | **0** | **128 ms** | **29 ms** | **81 ms** |
| 2026-07-28 | −7.0 ✓ | correlated | **0.79** | 6 | 244 | 615 |
| 2026-07-25 | 264.8 ✗ | correlated | 0.45 | 177 | 2 | 868 |
| 2026-07-26 | −99.1 ✗ | correlated | 0.47 | 92 | 1 | 1012 |
| 2026-07-29 | 38.5 ✗ | correlated | 0.79 | 179 | 318 | 4 |
| 2026-07-30 | −142.3 ✗ | classic | 0 | 127 | 121 | 998 |

**Exactly one night decomposes cleanly.** On 2026-07-27 the classic solution is valid at ρ = 0 — the
module's own precondition (*"the well-posed application is CROSS-NODE, where the noise is largely
independent"*) is met and no common-mode correction is invoked. Everywhere else the solver needs
ρ = 0.45–0.79, i.e. it can only fit by assuming half to four-fifths of the residual is shared.

### What those numbers are NOT

**σ_ECG = 128 ms is not the ECG's clock.** Both ECG-containing pairs carry **pulse arrival time**, so
TCH assigns variance common to them to the ECG — and per-block PAT IQR on this corpus is 43–112 ms,
the same order. What TCH returns here is *residual variance attributable to each device*, and for
beat-derived offsets that residual is dominated by physiology, which is not a device property.

That is the tool working, not failing. Its assumption is independent per-device noise, and
**beat-derived offsets cannot satisfy it, because the pulse is common to all three devices by
construction.** A well-posed timing TCH needs three channels with independent timing paths — three
IMUs (movement is mechanical, no transit delay) or a host reference. This hardware has two IMUs and a
ring whose motion column is not one, so **it is not available on this corpus.**

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

### 3.4 · `inverseVarianceWeights` is exported, and the pooled fit does not use it

`fitClockOffsetPooled` pools channels by summing per-channel z over √n — **equal weighting**.
`integrator-tch.js` exports `inverseVarianceWeights`, the principled alternative once per-channel
precision is known. No new machinery is needed; the estimator already computes each channel's curve.

It should **not** be wired on this brief's evidence. Per-device σ resolves on one night of six, and
what it resolves to is contaminated by physiology. But the connection is worth recording: a fit that
weights equally and an exported weighting function have been sitting one file apart without meeting.

### 3.5 · The over-determined check generalises beyond clocks

Closure worked here because three pairwise measurements of a three-body system have one constraint.
The suite already uses the same idea for **amplitude** — `integrator-tch.js` decomposes per-device σ
from three pairwise variances without a reference. It has never been applied to **timing**.

Once closure holds on more nights, the same three-cornered hat gives **per-device timing jitter**: not
just how pairs differ, but *which* clock is unstable. That is the question a fleet operator actually
has, and it is unanswerable from any pair.

## 3.6 · A trap in USING any of this: an alignment fitted to beats cannot then measure PAT

Found while trying to verify `PAT-PERBLOCK-ALIGNMENT`'s correction of §3.2, and worth recording
separately because it is not the same mistake and anyone re-measuring will meet it.

The obvious way to get pulse arrival time from this work is: take the per-block offset the drift fit
produces, apply it, then for each R-peak find the first pulse foot after it. Done that way on
2026-07-27 the answer looks superb — **beat-to-beat IQR 12 ms, median lag 73 ms**, comfortably inside
`pat-gate.js`'s ≤ 60 ms IQR bar.

It is meaningless. The lag histogram for a single block:

```
  50 ms  199 ####################################################################################
```

**Every one of 199 lags in one 50 ms bin, hard against the search window's 60 ms lower edge.** The
block offset was fitted by *maximising beat coincidence* — which is to say it aligned R-peaks onto
pulse feet, absorbing the transit into the offset. What remains is not PAT; it is the residue after
the fit already removed it.

**So the alignment used to measure a physiological delay must not have been fitted on the two channels
whose delay is being measured.** It has to come from a channel with no physiological path between the
devices — the ACC envelope — or from a host reference. This is the same circularity `REM-STAGING-
REDESIGN` §8 warns about for oracles, in a place nobody had looked for it.

Concretely: §3.2's claim that PAT is reachable was wrong for the reason
`PAT-PERBLOCK-ALIGNMENT` gives (a fit residual and a beat-to-beat interval are different quantities
that happen to share units), **and** it cannot be rescued by measuring the right quantity through this
alignment, for the reason above. Both routes close.

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

A third, added after §3.6: **check where your answer sits inside its own search window.** A result
piled against a window edge is the window, not the signal — and it is visible in one histogram, before
any statistic is computed.

`AUDIT-PROMPT.md` and the deep-audit charter already hunt hollow gates. This adds a sibling class worth
naming: **a model that is too simple passes every control you can build out of its own assumptions.**
The defence is redundancy in the measurement, not more surrogates.

## 5 · Done when

- [x] **DONE 2026-08-04 — the closure residual now gates the figure, and the first run says the corpus
      cannot close AT ALL.**

      *"…or a sibling tool does"* had already happened: `tools/drift-report.js` owns the four-state
      `driftVerdict` and `trio-batch` routes every clock line through it. **`beat-comb-analysis.mjs` was
      the straggler** — it derives drift from per-block lag by Theil–Sen, not `fitClockDrift`, so no
      closure could reach it, and it printed a bare `ppm` column spanning **−133 to +185 ppm against a
      crystal error of ~20**. Precisely the §6 guardrail, violated by the tool §5 names.

      Fixed by closing over the legs *that tool* fitted. `DriftReport.closeTriple(legs)` takes directed
      `{a,b,ppm}` legs and checks `d(A,B)+d(B,C)+d(C,A)=0`; the tool's three pairs are the three edges of
      one triangle over `{ECGDex, PpgDex, PpgDexFinger}`, so `--pair all` is the only mode that can check
      itself. A night's rows are now **buffered, closed, then printed** — printing first and closing
      twenty lines later is the ordering bug `drift-report.js` was extracted to fix.

      ⚠ **THE FIRST HONEST RUN: 0 closed · 0 inconsistent · 25 unclosed, of 25 nights.** Not one ppm this
      tool has ever printed was a measurement. The cause is not a failing check but an **absent** one:
      **0 of 41 nights carry a `PpgDexFinger` export**, so two of its three pairs (`optical`,
      `ecg-finger`) produce no rows at all — silently, because a pair with no data has no lines. The tool
      now names the silent pairs rather than leaving them invisible. OxyDex cannot substitute: its export
      carries `spo2`/`epochs` and **no beat timeseries**, so there is no third beat train on those nights.

      **Gated, and verified RED by value** — `drift-report · closure-identity`, 14 assertions in both
      lanes. Two mutants confirm it fails on the value: a constant tolerance kills 4 assertions, and
      letting an absent leg default to 0 produces exactly the fabricated pass (`consistent: true` on a
      hole) the §2.6 never-default rule forbids. The tolerance `max(5, 0.25·max|leg|)` is **mirrored**
      from `fitClockClosure` (one is bundled, one is not) and the gate reads the rule out of **both**
      sources as text, so the two copies cannot drift apart.

- [x] **ANSWERED 2026-08-04 — attempted twice, and it is not the blocker.** Superseded by
      `JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md`, which implemented both readings. Sequential per-pair
      unwrap made closure **worse** (101/101/58 ppm → −266/209/−202: one wrong multiple rides the
      cumulative sum). Wrapped-residual slope regression removes the propagation entirely and leaves
      closure free — and still does not lock, because **per-block offset precision** is the real
      constraint: phase concentration runs 0.15–0.38 where 1 is total agreement, so there is no phase to
      regress. `_wrappedSlopeFit` ships as a diagnostic. Do not re-attempt the unwrap; the leverage three
      devices give is real but unreachable until a block offset is good to well under one RR.
- [x] **DONE — the contract existed; its RATE was retracted (fixed 2026-08-04).** `maxTolerableDriftPpm`
      already shipped, exported, with a per-consumer table. But it justified its two "NOT safe" rows with
      *"(wearables run 100+)"* — the beat-derived figure `WEARABLE-DRIFT-DIRECT` **retracted**. Measured
      directly off the two clocks in every capture file: H10 −20.3 ppm, Verity −27.0 ppm vs the capture
      host, each stable to ±2–3 across fragments and nights ⇒ **inter-device ≈ 7 ppm**, not 100+. Over
      7 h that is **202 ms, not 2.5 s**.

      **The verdicts do not flip** — 7 ppm still exceeds a ~3 / 2.4 ppm budget — which is exactly why the
      stale number survived: the ordering holds at both rates, so every assertion stayed green while the
      stated reason was wrong by an order of magnitude. Both rates are now asserted, so the leg can no
      longer pass for the wrong reason.

      **What the correction changes is the engineering answer.** The margin is 2–3×, not 30×, so a
      constant offset at beat resolution IS defensible over a short enough window. Added
      `maxSafeSpanSec(resolutionSec, driftPpm)` — the precondition asked the way a caller can act on it:

      | consumer | resolution | safe window at 7 ppm | under the retracted 100+ ppm |
      |---|---|---|---|
      | `pat-gate.js` | ≤60 ms | **2.4 h** | ~10 min |
      | `fitClockDrift` beat matching | ±80 ms | **3.2 h** | ~13 min |

      At ~10 minutes nobody would bother; at hours it is a real option for PAT. A zero or non-finite
      rate **refuses** rather than returning `Infinity` — "no limit" is a claim, and this function has
      not measured one.
- [⛔] **BLOCKED 2026-08-27 — evidence-backed, not deferred. The gating set does not exist, and where it
      is best measured the closure FAILS.** PAT re-tested under drift-aware alignment, against
      `pat-gate.js`'s full bar (IQR **and** coupling **and** a physiological median — plus the
      **fourth**, unstated-in-prose `physical` condition: median lag in **[60, 700] ms**), on the nights
      where closure holds.

      > **Which closure.** Not §2.3's — that is ⛔ VOID above (two of its three legs run through the
      > O2Ring's **drawn** axis). The VOID exempts **ECG↔Verity** by name, and that pair *is* PAT, so the
      > voided closure was doubly wrong as this box's gate. The only non-void closure over this geometry
      > is the **host-leg** one — H10 ↔ Verity ↔ capture host, `tools/beat-leg-closure.mjs`, third corner
      > a real 0.008 ppm clock. Its §7.3 "impossible" blocker was **stale**: it bound the *exports*, and
      > that tool reads raw waveforms (see `WEARABLE-DRIFT-DIRECT` §7.3's 2026-08-27 amendment).
      >
      > **Method, fixed BEFORE any data was seen** (three constants, in this order): band
      > `|legC − (A−B)| ≤ 2·σ_pred`, `σ_pred = √(σ_H10² + σ_Verity²)`; coverage factor **2**; range→σ by
      > Hartley **d₂** (1.128 at n=2, 1.693 at n=3); fragment rule = largest ECG × largest Verity by file
      > size. A night with <2 fragments on either device **REFUSES** rather than borrowing an uncertainty.
      > Licence for attributing residuals to the host legs: `--selftest` recovers planted rates to
      > **±0.0 ppm** over −40…+40 ppm under realistic corruption, 7/7.
      >
      > **Result — 49 nights → 33 with both devices → 7 bandable → PASS 3 · FAIL 2 · REFUSE 2:**
      >
      > | night | pred | leg C | resid | band 2σ | blocks | |
      > |---|---|---|---|---|---|---|
      > | 2026-07-19 | +9.3 | — | — | 4.88 | 0 | REFUSE |
      > | 2026-07-20 | +9.4 | +7.6 | −1.8 | 12.49 | 36 | PASS |
      > | 2026-07-22 | +8.5 | +2.4 | −6.1 | 9.64 | 26 | PASS |
      > | 2026-07-25 | +3.9 | — | — | 6.06 | 0 | REFUSE |
      > | 2026-08-09 | +6.5 | +13.2 | +6.7 | 4.16 | 40 | **FAIL** |
      > | 2026-08-13 | +6.5 | **−14.6** | **−21.1** | **0.71** | 28 | **FAIL** |
      > | 2026-08-24 | +7.5 | +20.1 | +12.6 | 20.56 | 34 | PASS |
      >
      > 🔴 **The three passes are not evidence of closure, and the reason generalises.** The verdicts
      > separate **perfectly by band width**: the three PASSes hold the three **widest** bands (9.64,
      > 12.49, 20.56), the two FAILs the two **tightest** (4.16, 0.71). No overlap.
      >
      > > **A dispersion-derived band used as an INCLUSION gate anti-selects for measurement quality.**
      > > Noisy legs earn a wide band nothing can fail; consistent legs earn a sharp band that a real
      > > discrepancy does fail. So "passing" enriches for exactly the nights **least** fit for the
      > > downstream use — here, PAT, which wants trustworthy timing and would have been handed the
      > > three nights whose clocks are worst measured. **Never use a per-night uncertainty band as a
      > > selection filter without checking the band↔verdict correlation.**
      >
      > 2026-08-24 "passes" on a **±20.56 ppm** band — wider than the whole physical spread of the
      > measured device rates (−14.6 … −30.2 vs host) — so it excludes essentially nothing. A verdict
      > that is computable and carries no information.
      >
      > ⚠️ **2026-08-13 is a SIGN flip, not a magnitude miss**: host legs predict Verity **+6.5 ppm
      > faster**, leg C measures **−14.6 ppm slower**, on 28 blocks with the corpus's cleanest legs
      > (ranges 0.3 / 0.4 ppm). The two methods disagree about **direction** where both are best
      > measured. Spun out as **`CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md`** — finding which
      > method is wrong is the real prize, and no PAT gate built on leg C is trustworthy until it is
      > answered.
      >
      > **Unblocks when** the corpus carries nights with **≥2 fragments per device AND consistent legs**,
      > and the closure holds on them. The present corpus is mostly single-fragment (H10 on 20 of 33
      > nights, Verity on 18), which is why only 7 were bandable at all. **The re-test will not be run
      > ungated on the passing set** — that would select for poorly-measured timing.

- [x] **DECIDED 2026-08-09 by the owner — BOTH: capture-time PRIMARY, exported envelope as a marked
      FALLBACK.** The item asked for a choice between them; the answer is that they answer different
      questions and only one of them can ever be a measurement.

      **Capture-time is primary because it is the only place the measurement exists.** The host holds
      both clocks while it holds both devices; after the fact, that information is gone. This is no
      longer an argument from principle — measured 2026-08-09, every H10 night in the corpus shows a
      host↔device residual spread of **0.98 ms**, one stamp quantum, so `independent === false` and the
      host column is the device stamp rounded. On such a file there is no second clock left to recover,
      and no downstream reconciliation can manufacture one. The box (chrony local-stratum-1, 0.008 ppm,
      re-syncs both Polar clocks per connect) is where a real offset can be recorded.

      **The envelope is the fallback because ~40 nights already exist and cannot be re-recorded.** It
      must carry `independent` and `spreadMs` through to every consumer and be **marked**, never
      silently substituted: on a phone capture the envelope restates a derived column, so a consumer
      that spends it as a second clock fabricates a timebase. That is the failure this brief's own
      §2.3/§2.6 were voided for.

      **The rule that follows:** a consumer needing a genuine second clock reads `independent` and
      **refuses** when it is false — shipped for the coupling gate as `NO SHARED CLOCK` (PR #1069) and
      ~~owed for the ECGDex `fs` correction (branch `fix/ecgdex-fs-independent`, which currently applies
      a rate derived from a non-clock on every phone-captured night)~~ — **SHIPPED, see below**. A
      consumer that only needs an approximate alignment may use the envelope, but must not upgrade its
      provenance by doing so.

      > **✅ NO LONGER OWED — verified in the tree 2026-08-15.** The ECGDex leg landed as **PR #1101**
      > (*"the fs correction never asked whether there is a second clock (Clock §7)"*) and was extended by
      > **#1121**. `ecgdex-dsp.js` now carries `ecgHostAx.independent !== false` on **both** consumers —
      > the `fs` division *and* `_ecgCorrAt` (the latter was never in the WIP branch, so main went further
      > than the fix this brief was waiting for) — and forwards `independent` + `spreadMs` into the export
      > so a refusal is auditable rather than an indistinguishable `applied:false`.
      >
      > **The gate the WIP called owed also exists**, in `tests/dex-tests.js` (`ecgdex-dsp` group), and it
      > tests both directions rather than only the fix: a DERIVED capture (host = device restamped, zero
      > divergence) must report `independent:false` / `applied:false`, and an INDEPENDENT one (500 ppm
      > planted, deterministic ±4 ms jitter so the residual clears the 2 ms discriminator) must report
      > `true`/`true` — *"the guard did not break the feature"*. It asserts the consequence on `fs`
      > itself, and deliberately asserts the recovered rate as a **band** (100–600 ppm from a planted
      > 500, ~250 measured) because §7's running median under-reads by `(1 − 5/(n−1))` at the ends;
      > asserting the planted value would assert the bias away.
      >
      > ⚠️ **The stranded branch `fix/ecgdex-fs-independent` (`d6b15a39`) still exists on `origin` with no
      > PR**, 240 commits behind and marked `NOT FOR MERGE`. It is superseded — **do not resurrect it**: it gates
      > only the `fs` division and would *narrow* the shipped guard. Left in place rather than deleted —
      > deleting a remote branch with no PR makes its commit unreachable, and that is the owner's call.
      >
      > **Why this sat stale:** the fix landed under a title naming Clock §7, not this brief, so nothing
      > linked the two. The blocker sentence named a *branch* — which is what made it cheap to falsify.
- [x] **ACCEPTED STATEMENT RECORDED 2026-08-08 — the optical spine is not validated against hardware,
      and will not be on this equipment.** The choice this item offered was "a device that emits real
      PPI, or an accepted statement". No such device exists in the corpus, so the statement is taken.

      **Re-measured before accepting, and the count needed correcting.** Not 107 of 107: there are
      **117 `_PPI.txt` files, 113 header-only and 4 carrying rows** (465–583 each). The four are
      `uploads/synthetic/` fixtures with 14-digit-stamp filenames — *generated twins, not hardware*.
      So the honest split is **113 real files, 113 header-only, zero hardware intervals**, and the
      original figure undercounted the corpus while reaching the right conclusion about it.

      That distinction is the load-bearing part. `PPGDSP.validatePPI` **is** exercised — by the
      synthetic twins — so the comparator has coverage and cannot rot. But a comparator exercised only
      against a file this repo generated is a **contract test, not a control**: it proves the function
      agrees with our own generator, which is exactly the shape of gate this suite has repeatedly found
      passing while checking nothing. It is legitimate here only because it is now stated.

      **The accepted statement.** Optical intervals are validated against (a) **each other** — 3-LED
      consensus before `buildPPI` — and (b) the **ECG spine**, which itself has a real hardware control
      (`ECGDSP.validateRR` against the H10's `_RR.txt`, §2.4). They are **never** validated against
      device-reported PPI, because no device here reports any. No claim of hardware-validated optical
      intervals may be made anywhere in the suite on this corpus.

      **What reopens it:** any device that emits real PPI. The comparator is already wired, so the leg
      is one corpus away, not one implementation away.
- [x] Per-device timing jitter via three-cornered hat — **attempted 2026-08-01 through the repo's own
      `integrator-tch.js`, and the answer is bounded** (§2.6). It decomposes cleanly on exactly one
      night (classic, ρ = 0); elsewhere the solver needs ρ = 0.45–0.79. And the σ it returns is **not
      clock jitter**: beat-derived offsets carry pulse arrival time into both ECG pairs, so TCH
      attributes physiology to a device.
- [x] **DONE 2026-08-17 — measured against the capture host, on 344 streams across 16 box nights. The
      third mechanical channel was never needed; the host is the independent timing path.**
      `tools/device-stability.mjs` (`--selftest` for the known answer), gated by
      `device-stability · per-device-sigma`. It reuses `DexClock.hostAxis(…).stability` — **not** a
      fourth Allan implementation (`HOSTAXIS-STABILITY` §4.3); the corpus walk and the roll-up are its
      only contribution.

      **Why the host route works where §2.6's TCH did not.** §2.6 got σ_ECG = 128 ms and rightly
      refused to call it a clock: both ECG-containing pairs carry pulse arrival time, so TCH attributed
      physiology to a device. `Phone timestamp` vs `sensor timestamp [ns]` contains **no beat**, so
      nothing in it *can* carry a transit delay. That is the property §2.6 found missing, and it was
      already in every raw capture file.

      | device | streams | nights | ADEV slope | σ_y(τ = 256 s) | noise type |
      |---|---|---|---|---|---|
      | **Polar H10** | 98 | 16 | −0.99 [−1.06…−0.91] | **388 ppm** [171…764] | white/flicker **phase** |
      | **Polar Verity Sense** | 218 | 16 | −1.00 [−1.03…−0.88] | **843 ppm** [248…1945] | white/flicker **phase** |
      | Wellue O2Ring-S | 28 | 14 | −0.55 [−0.98…−0.30] | 1195 [178…15032] | white **frequency**, mixed |

      ⚠ **THE QUESTION AS ASKED — "WHICH CLOCK IS UNSTABLE" — IS NOT WHAT THIS ANSWERS, and the slope
      is what says so.** Every Polar curve is τ⁻¹ across the whole reachable τ range: phase noise all
      the way out, so **neither crystal is ever reached** and this instrument cannot rank the crystals.
      What it ranks is the **timing PATH**, and there the answer is unambiguous — the H10 is quieter
      than the Verity on **16 of 16 paired nights**, median ratio **2.27×**, holding on the primary
      streams alone (H10 ECG 452 ppm vs Verity PPG 808 ppm). Inverting the τ⁻¹ model names the
      mechanism: implied arrival jitter **50 ms for the H10** (≈1 × its 45 ms connection interval)
      against **124 ms for the Verity** (≈4 × its 30 ms). That is BLE delivery, not crystal quality.

      **The corollary is the part that generalises:** because the noise is white phase throughout,
      **averaging always pays — the limit on any rate estimate here is recording LENGTH, not a
      stability floor.** No device in this corpus needs a stability gate. This reproduces
      `ALLAN-DEVIATION`'s four-stream and `HOSTAXIS-STABILITY` §2's two-file results at 344-stream
      scale, and it is why §6's guardrail still binds: a ppm from a short fragment is mostly noise —
      now quantified rather than asserted.

      **A method finding worth more than the table, because it nearly shipped as its opposite.** The
      first crystal check here compared fragment rates by raw max−min spread, and failed **25 of 40
      device-nights** — including 10 H10 nights, which would have contradicted
      `WEARABLE-DRIFT-DIRECT` §1's ±2–3 ppm. §1 was right and this was wrong: it filtered to fragments
      > 3 MB. On 2026-08-01 the H10's 563-minute fragment reads **−21.0 ± 2.4 ppm** while its 28-minute
      fragments read −119.5 ± 309 and +12.5 ± 307 — **the same measurement**, every short value inside
      1σ. Judged through the error bars (inverse-variance mean, reduced χ² = 0.07) the night is a
      crystal at −21.0 ± 2.4, and **39 of 40 device-nights** now hold one; the single failure is the
      O2Ring on 2026-08-01, χ²red 6.30, exactly as `WEARABLE-DRIFT-DIRECT` §7.1 predicted. **This is
      the concrete payoff of publishing `ppmUncertainty`:** without σ_i the decision cannot be made
      correctly, only made confidently.

      ⛔ **What this does NOT license: revisiting ECGDex's 2400 s span gate.** The arithmetic is
      tempting — σ_y ∝ τ⁻¹ from 388 ppm at 256 s reaches ~20 ppm only near 5000 s — and it is precisely
      the claim `HOSTAXIS-STABILITY` §3 **made and withdrew**. Its lesson 2 stands: ADEV and the
      uncertainty of the endpoint estimator ECGDex actually uses are different quantities, coinciding
      only for white phase and even then differing by a constant. The gate moves when someone derives
      the bound **for that estimator**, not before.

- [x] **ANSWERED 2026-08-17 — still NO, but now for a measured reason instead of a missing one.** The
      item deferred inverse-variance weighting because it "needs a σ that is not physiology". That σ
      now exists (above), so the question is properly answerable — and the answer holds, with the
      reasoning moved from *absent evidence* to *wrong quantity*.

      **`hostAxis.stability` yields a per-DEVICE CLOCK σ; `fitClockOffsetPooled` weights per-CHANNEL
      OFFSET estimates.** Different quantities: the pooled fit's channels differ in how sharply each
      event type localises in time (a desaturation edge against a movement onset), which is
      **event-morphology**, not a clock property. Weighting channels by their devices' clock stability
      would import a number that differs 2.27× between two devices whose *events* may localise
      identically — a confident wrong weight in place of an honest equal one.

      **What would justify it is a per-channel σ of the offset estimate itself**, which §3.4 already
      notes the estimator computes a curve for. That remains unbuilt, and it — not the clock σ — was
      always the real precondition.

      ⚠ **And `integrator-tch.js inverseVarianceWeights` is the wrong function to reach for even then.**
      It **floors** each σ² at 8 % of the largest, so a spuriously near-zero σ² cannot capture all the
      weight on short records. In clock work the σ span two orders of magnitude legitimately (2.4 ppm
      against 376 ppm on one night) and the **smallest is the most trustworthy, not the most suspect** —
      that regularisation would discard the fragment carrying the answer. Same formula, opposite failure
      mode. Found while building the crystal check above, which needed exactly this weighting and could
      not reuse it.

## 6 · Guardrail

**Do not quote a ppm figure that has not closed.** The six nights here produce drift estimates spanning
−21 to +754 ppm; two of them are credible. The rest are unwrap failures wearing the same units, and
they are indistinguishable from real measurements without the closure column beside them.
