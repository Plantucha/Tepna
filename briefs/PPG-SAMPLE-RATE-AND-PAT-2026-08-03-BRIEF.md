<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — measured on hardware, one night) · **Created:** 2026-08-03 · **Device:** Polar Verity Sense `0C301E3F` (sw 3.0.16) + Polar H10 `02849638` · **Corrects:** `POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md` §2.2a · **Related:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` · `PAT-FEASIBILITY-2026-07-08-BRIEF.md`

# What PPG sample rate actually buys — and where PAT's floor really is

SDK mode raised the Verity's PPG ceiling from 55 Hz to **176 Hz** (`POLAR-PMD-COMMAND-SURFACE` §2.2a),
and it was switched on in production on 2026-08-02. This brief is the measurement that should have come
first: **what does the extra rate change?**

Short answer: **nothing above 25 Hz, and the reason is not that the tooling is blind.**

---

## 0 · The question was mis-framed, by me, in the brief that justified the change

`POLAR-PMD-COMMAND-SURFACE` §2.2a argued for 176 Hz like this:

> at 55 Hz one sample is **18.2 ms** against a sleep rMSSD of 20–60 ms, so beat-timing quantisation is a
> large fraction of the measurement; 176 Hz cuts it to **5.7 ms**

**That argument is wrong**, and the code already said so. `ppgdex-dsp.js:942` (`refineFeet`) interpolates
each systolic foot to a **fractional sample index**:

```js
const cross = ms - (bp[ms] - mv) / msv;      // fractional index — sub-sample
foot = Math.max(lo, Math.min(p, cross));
```

Beat times were never quantised to the sample grid, so raising the grid density cannot sharpen them by
the mechanism claimed. The rationale was inferred from a sample interval without checking whether
anything downstream was actually limited by it.

---

## 1 · Method — decimation, because a cross-night comparison cannot answer this

The first comparison run was **55 Hz night vs 176 Hz night**, which showed rMSSD dropping 35 % (58.5 →
37.8 ms) and looked like a striking confirmation. It is not evidence: different nights carry different
physiology, and mean RR differed 7 % between them, so autonomic state was not held fixed.

**The control that works is decimation.** Take ONE 176 Hz recording and drop samples: the beats, the
subject, the night, the perfusion and the motion are identical, and only the sampling changes.
`/tmp/decimate.py`-style 1-in-N thinning of a Polar `_PPG.txt`, then the real DSP on each result.

Windows used: rMSSD on 21:54→00:16 (1.5 M rows), PAT on 02:10→04:32 (141.7 min, 7339 H10 R-peaks).

⚠️ **Decimation is not identical to native capture at the lower rate** — the device's own anti-alias
filtering and AGC differ. What it isolates cleanly is *whether the DSP uses the extra samples*, which is
the question that was actually in dispute.

---

## 2 · HRV — flat from 44 Hz up

| sampling | rMSSD | SDNN | sdnnRobust | pNN50 | beats | mean RR |
|---|---|---|---|---|---|---|
| 176.42 Hz | 37.8 | 68.8 | 43.7 | 16.9 | 7227 | 1174 |
| 88.21 Hz | 37.8 | 68.8 | 43.4 | 16.7 | 7227 | 1174 |
| 58.81 Hz | 37.7 | 68.8 | 43.4 | 16.7 | 7227 | 1174 |
| 44.11 Hz | 37.8 | 68.8 | 43.3 | 16.6 | 7227 | 1174 |

Identical beat count, identical mean RR, rMSSD stable to 0.1 ms. The 35 % cross-night difference was
therefore **physiological**, not a sampling artefact.

Per-epoch HR accuracy against the chest ECG is likewise unchanged: median error 0.2–0.3 bpm at both
rates, and flat across the night (so battery sag does not degrade detection either — tested separately,
9 of 11 nights show no trend).

---

## 3 · PAT — a cliff at 22 Hz, flat everywhere above it

Measured with the repo's own machinery (`pat-feasibility-worker.js` → `ecgRpeakTimes`, `ppgFootTimes`,
`coupledPAT`), scored against the published gate (`pat-gate.js`: residIQR ≤ 60 ms · matchRate ≥ 55 % ·
median lag ∈ [60, 700] ms).

| sampling | interval | residIQR | note |
|---|---|---|---|
| 176 Hz | 5.7 ms | **18.68 ms** | |
| 59 Hz | 17.0 ms | 18.61 ms | |
| 44 Hz | 22.7 ms | 18.96 ms | |
| 35 Hz | 28.3 ms | 18.96 ms | |
| 29 Hz | 34.0 ms | 19.60 ms | |
| **25 Hz** | 39.7 ms | **18.65 ms** | last good rate |
| **22 Hz** | 45.5 ms | **40.39 ms** | **cliff — 2.2×** |
| 11 Hz | 91 ms | *detection collapses* (0 feet) | |
| 5.5 Hz | 182 ms | 70.57 ms | fails the 60 ms bar |

It is a **cliff, not a gradient**. The ~1 ms wobble across 25–44 Hz is estimator noise; the jump at
22 Hz is twenty times that.

### 3.1 · Why it saturates — the extra rate IS used, it is just swamped

A flat result invites the objection *"a 3.2× input change that moves nothing means the measurement is
blind."* That objection is correct in principle and was tested: pushing the ladder down to 22/11/5.5 Hz
moves the metric hard, so **the chain is demonstrably sensitive**. It saturates; it is not blind.

Timing error adds in quadrature, `total² = physiological² + sampling²`. Solving for the sampling term
against the measured 18.6 ms floor:

| rate | total | implied sampling term | as fraction of the sample interval |
|---|---|---|---|
| 22 Hz | 40.39 ms | **35.8 ms** | 0.79 — interpolation failing |
| 44 Hz | 18.96 ms | **3.7 ms** | 0.16 |
| 176 Hz | 18.68 ms | **1.7 ms** | 0.30 |

The sampling contribution falls with rate exactly as physics requires — 35.8 → 3.7 → 1.7 ms. It is
simply being added to a **~18.6 ms physiological floor**, so 44 → 176 Hz moves the total by 0.28 ms,
about **1.5 %**. You cannot improve a measurement by sharpening a term already an order of magnitude
below the noise it adds to.

At 22 Hz the systolic upstroke spans less than one sample, so there is nothing for `refineFeet` to
interpolate between. That is the cliff.

---

## 4 · The recommendation

| | |
|---|---|
| **Hard floor** | **25 Hz** — below it, precision more than doubles |
| **Recommended** | **44–55 Hz** — ~2× margin over the cliff; 55 Hz is offered natively |
| **Above 55 Hz** | no measurable gain for HRV, per-epoch HR, or PAT |

**Do not sit at 25 Hz.** The cliff position depends on how fast the systolic upstroke is, which depends
on heart rate — this night was resting at ~52 bpm, and a faster upstroke during exertion pushes the
cliff **up**. A rate that is adequate asleep can fail awake.

**55 Hz now looks like a deliberate vendor choice** rather than a limitation: the cheapest rate
comfortably clear of the interpolation limit.

### 4.1 · What 176 Hz costs, measured

Same device, same ~8 h window, consecutive nights (`Tepna_*_LINK.csv` `battery_pct`):

| night | rate | battery | drain | runtime from full |
|---|---|---|---|---|
| 2026-08-01→02 | 55 Hz | 100 % → 61 % over 8.2 h | **4.74 %/h** | **21.1 h** |
| 2026-08-02→03 | 176 Hz | 86 % → 16 % over 8.1 h | **8.60 %/h** | **11.6 h** |
| 2026-08-02 daytime | idle | 94 % → 97 % | −0.15 %/h | — |

**1.81× the battery for 1.5 % of a term that is not the limiting one.** It also costs the
two-nights-per-charge margin, which is a real operational property: at 55 Hz a missed charge costs
nothing, at 176 Hz it costs a night.

**This does not by itself mandate 55 Hz.** 11.6 h against a ~6 h night is ample, and the owner elected
on 2026-08-03 to keep 176 Hz on those grounds. The trade is now quantified rather than assumed, which is
the point.

---

## 5 · Sample rate is not what blocks PAT

At **every** rate from 25 to 176 Hz the precision bar passes comfortably — 18.6 ms against a 60 ms limit
— and the gate still **fails**, on **matchRate 28.5 % against a ≥ 55 % bar**.

The cause is in the same row: **driftRange 430 ms** over 2.4 h. The H10↔Verity pair runs at ~109 ppm
relative, so the true lag walks out of the physiological pairing window part-way through the recording
and most beats never pair at all. Median lag 483 ms is inside [60, 700], so the pairs that survive are a
real pulse transit.

**A 2× shortfall against a 1.5 % one.** Effort spent on sample rate for PAT is spent on the wrong term;
the work that moves PAT is applying the drift fit to beat times before pairing. `CROSS-DEVICE-DRIFT-AND-
CLOSURE` §3.2 already frames this ("PAT becomes reachable, which it currently is not"); this night adds
that **the precision is already there** — 18.6 ms is better than the 43–112 ms per-block figures that
brief records, plausibly the host-axis fix showing through.

---

## 6 · Method notes — five wrong turns, and what each cost

Recorded because each is cheap to repeat and none produced an error message.

1. **The quantisation rationale** (§0) — inferred from a sample interval without checking that anything
   downstream was limited by it. `refineFeet` was three lines away.
2. **Cross-night comparison** (§1) — showed a 35 % rMSSD change that was physiology. Decimation is the
   only control that holds the subject fixed.
3. **Epochs paired by array index.** The nodes have different epoch counts and start times (2026-08-01:
   ECG 113, Ppg 118, Oxy 112), so index pairing silently compared different times. `tMin` does not fix
   it either — it is relative to each node's own start. Only `startEpochMs + tMin×60000` is an instant.
   This produced a confident, wrong claim that the Verity was excellent (SD 0.95) on a night where it
   was poor (5.98).
4. **A hand-rolled PAT pairing** inflated jitter 18.6 → 24.3 ms: it used one channel instead of
   `consensusBeats` across 3 LEDs, timed feet as `idx/fs` instead of `rec.relSec[idx]`, and paired to
   the most recent R-peak so a missed foot slipped a whole cardiac cycle. All three were already solved
   in `pat-feasibility-worker.js`. **Search the tree before measuring.**
5. **A flat result reported without a positive control.** "Nothing changed across 3.2×" is not a finding
   until you have shown the measurement CAN change. Pushing to 22/11/5.5 Hz turned a weak claim into a
   quantified saturation curve — and it was the owner's disbelief, not any gate, that prompted it.

A sixth belongs to the tooling and is fixed separately: `trio-batch` merged sessions of **different
sample rates** onto one grid under the first session's `fs`, doubling the night's exported HR to
108.6 bpm against the ECG's 52.1. Nothing errored, and the three-cornered hat then reported the Verity
as the night's worst sensor — a fold bug that became a false finding about hardware. Fixed in
`changes/2026-08-03-trio-mixed-rate-merge.md`.

---

## 7 · Limits of this brief

- **One night, one subject, resting ~52 bpm.** The cliff moves with heart rate.
- **The cliff is a property of `ppgdex-dsp.js`**, not of PPG physics — it is set by `detectChannel`'s
  window constants (`W1 = fs × 0.111`, `minW = fs × 0.05`, both clamped to a 3-sample minimum). A
  different foot-finder puts it elsewhere.
- **Decimation ≠ native low-rate capture** (§1).
- Morphology and perfusion-index questions are **untested** — they need shape, not timing, and are the
  one plausible remaining use for a high rate. Nothing here speaks to them.
