<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-12

# The PPG foot is measurable to ~1 ms on half the nights and ~13 ms on the rest — and we cannot yet tell which estimator is better

A 2026-08-12 sweep of the box corpus (20 Verity nights, 2026-07-16 → 08-04) measuring where the
systolic foot actually lands, prompted by a simple question: are the good nights the RECENT ones?

They are not. **The good nights are scattered, and the last three nights of the corpus are all bad.**
There is no drift, no learning curve, and nothing about the setup that visibly improved.

## 1 · The measurement, and the audit that halved it

The metric is **inter-LED pairwise IQR**: three co-located LEDs, one clock, one pulse, so whatever
differs between them is detection error. `tools/pat-per-led.mjs` already argued this.

⚠️ **Six of the twenty nights are NOT MEASURED, and the first version of this sweep reported them as
if they were.** On 07-16, 07-20, 07-21, 07-25, 07-30 and 07-31, two of three channels sit >200 ms
apart, the pairing window rejects everything, and fewer than 70 beats of tens of thousands survive.
Their IQRs describe a handful of beats. The worst artefact was **07-20 reported at 204.80 ms and
"improved 98.7 % to 2.67 ms"** — both numbers came from one surviving pair while the others collapsed
to 27 paired beats. Neither figure means anything. **Always print the pairing count beside the IQR**;
this is the `PHYS`-censoring failure in a new costume.

On the **14 nights that pair ≥95 % of beats**, the shipped intersecting-tangent detector gives:

| good (≤3.3 ms) | | bad (≥20 ms) | |
|---|---|---|---|
| 07-17 | 1.59 | 07-26 | 20.45 |
| 07-27 | 1.73 | 08-01 | 25.67 |
| 07-22 | 1.88 | 07-29 | 26.22 |
| 07-24 | 2.17 | 08-03 | 30.17 |
| 08-02 | 2.47 | 07-28 | 33.61 |
| 07-19 | 3.27 | 07-18 | 35.92 |
| | | 07-23 | 37.63 |
| | | 08-04 | 41.68 |

**6 good, 8 bad, and NOTHING between 3.27 and 20.45.** A gap that clean is a switch, not a quality
gradient. Per-channel foot error is ≈0.9 ms in one mode and ≈13 ms in the other — a 14× swing.

**What does NOT explain the split**, each measured and refuted:

- **beat-doubling** — refuted on all 20 nights; channels agree on beat COUNT to <0.5 %, HR ratio ≤1.006
- **channel SNR** — refuted, and anti-correlated if anything: the two lowest-SNR nights (08-02, 07-31)
  are both GOOD, two of the highest (07-28, 08-01) are bad
- **one bad LED** — refuted; on bad nights all three pairs fail together and by the same amount
  (08-01: 25.47 / 25.71 / 25.83)
- **bistability / snapping between two candidate feet** — refuted; the difference distribution is
  unimodal and simply WIDE (good nights put 87 % of beats within 3 ms of the mode, bad nights 12.6 %)
- duration and heart rate — neither separates the groups

**The mechanism is still unknown.** That is the honest state.

## 2 · RETRACTION — `CROSS-DOMAIN-METHODS` §2's premise was measured on one night, and it was a bad one

§2 states the PPG foot at **12.7 ms σ** is now the dominant error term and is therefore what to attack
next. That figure came from a single night in the BAD mode. On good nights the foot is **≈0.9 ms** —
inside the PAT budget, and better than the 5.69 ms intersecting-tangent RMSE the literature supplied.
**The fiducial is not the bottleneck; it is the bottleneck on half the nights and a non-issue on the
other half.**

This also re-explains §2.1's template result, whose stated cause was wrong. The template was scored on
2026-08-11 at 55 Hz (18.78 ms, **bad mode**) against 2026-08-02 at 176 Hz (1.70 ms, **good mode**), and
the win/loss was attributed to SAMPLING RATE. Rate was confounded with mode. §2.1 already flagged the
11× as confounded without being able to name the confound — this is it.

## 3 · Constant-fraction discrimination: measured, NOT adopted

From nuclear instrumentation: *time-walk* is the amplitude-dependent deviation of a measured
time-of-arrival that afflicts leading-edge discriminators, and an intersecting-tangent construction is
structurally one. A **CFD** triggers at a fixed fraction of each pulse's OWN peak and is
amplitude-independent by construction; digital CFD reaches sub-sample resolution by interpolating the
crossing, which is what 55 Hz needs.

Measured on the 14 valid nights, CFD at f=0.10 improves inter-LED IQR on **14 of 14**, median **−13 %**
(good nights −5 %, bad nights −33 %, best −65 %).

**It is NOT adopted, because that number does not survive verification:**

1. **The acceptance metric is blind to the failure mode.** Inter-LED agreement is COMMON-MODE across
   co-located channels, so an estimator that moves all three to a DIFFERENT feature improves it while
   being wrong. The metric can refute a self-consistent estimator; it cannot validate one. This was a
   hole in the reasoning, not only in the data.
2. **There is direct evidence of exactly that.** CFD−tangent shift is **+8 ms (IQR 1–2 ms)** on good
   nights but **−107 to −177 ms (IQR 60–137 ms)** on bad ones. A displacement that large is a different
   feature — and the bad nights are precisely where the gains are.
3. **The independent ECG test is inconclusive** (§4).

`AIC onset picking` — the dominant method in seismic phase picking and ultrasonic NDT — is a confirmed
**negative** across all 20 nights (8.46–42.29 ms, never competitive). It detects a step emerging from
noise; a pleth foot is a smooth curvature change with no onset to find. Recorded so it is not
re-derived.

## 4 · 🔴 THE BLOCKER — PAT against the H10 is mis-referenced on the box corpus

Scoring a fiducial needs a reference the estimator cannot fool. PAT = foot − preceding R-peak should
be **150–400 ms** for arm PPG. Measured, on the host-disciplined ECG axis (`tMsAt`):

| night | tangent med / IQR / paired | CFD med / IQR / paired |
|---|---|---|
| 07-27 (good) | 457.0 / 89.5 / 99.2 % | 465.2 / 90.8 / 99.2 % |
| 07-18 (bad) | 903.9 / 76.7 / 95.6 % | 749.6 / 67.8 / 99.8 % |
| 08-01 (bad) | 766.3 / 184.3 / 79.3 % | 646.9 / 270.6 / 94.7 % |
| 08-03 (bad) | 857.8 / 854.1 / 45.0 % | 845.0 / 139.4 / 89.2 % |

**750–900 ms is impossible physiology**, and even the good night's 457 ms is high. Something —
an unmodelled inter-device offset, or R-peak misdetection — sits underneath every number here. A
bounded-median test cannot work when the baseline is already outside the bound.

The pairing rates then make the IQRs mutually incomparable: tangent pairs 45–99 % of beats, CFD
89–99.8 %, each IQR computed over a different subset. On 08-03 CFD pairs **twice** as many beats and is
**six times** tighter, which no artefact explains; on 08-01 it pairs more and is worse, meaning
tangent's tighter 184.3 was flattered by discarding the 20 % it could not place.

**So there is currently no reference on this corpus capable of telling a better foot from a worse one.**
Fixing that outranks any estimator change — it blocks every PAT measurement, not just this one.

## Done when

- [x] 20-night inter-LED sweep, with pairing counts audited and 6 nights excluded as unmeasurable
- [x] doubling / SNR / single-LED / bistability all refuted with the measurement that refuted them
- [x] CFD and AIC implemented and scored; CFD's gain shown UNVERIFIED, AIC shown negative
- [x] `CROSS-DOMAIN-METHODS` §2's 12.7 ms premise retracted and §2.1's rate attribution corrected
- [ ] the PAT reference fixed — medians inside 150–400 ms and pairing ≥95 % on both modes
- [ ] only THEN: re-score CFD against it, and adopt or reject on that number
- [ ] the mode-splitting mechanism identified (still unknown)

Related: [`CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md`](CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md) ·
[`PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md`](PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md)
