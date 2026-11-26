<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-11-26 · **Created:** 2026-11-26

# The common-mode protocol, run on a real detector change

This brief discharges the §7 remainder of
[`CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md`](CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md),
which residue row `2026-10-26-the-common-mode-protocol-has-run-on-no-detector-change` carries. That row
states the protocol has run on no real detector change. It has now run on one.

The tool is `tools/common-mode-blind-trial.mjs`. It imports the four steps from
`tools/detector-change-advisory.mjs`, so the protocol keeps one source. The run record is
`analysis/common-mode-blind-trial-2026-11-26.json`.

## 1 · The occasion

PR #5904 changed what the SpO2 spectrum decides. The red-noise background now reads persistence as
lag 2 over lag 1, because whole-percent rounding lowers a lag-1 autocorrelation and let a featureless
record report a cycle. `tools/detector-change-advisory.mjs --base origin/main` named 7 declared
detector sites in that diff, among them `detectSpO2Periodicity`.

Nobody manufactured this occasion. The advisory census routed §7 to a diff that was already in flight.

## 2 · The two arms, and why they are not one instrument

| arm | device | modality | site | quantity |
|---|---|---|---|---|
| detector | the ring | optical | finger | the shipped `computeSpO2FFT` over the night's SpO2 |
| reference | the H10 | electrical | chest | `apnea.cvhrIndex` from the same night's ECGDex export |

Two arms through one instrument are one measurement, so a second column of the ring would prove
nothing. These two arms are two devices at two sites.

⚠ **The reference measures a neighbouring thing, and never the same thing.** Cyclic heart-rate
variation accompanies the apnea that drives periodic breathing. It is not an SpO2 cycle. So a
disagreement carries two causes — the detector, or the physiology — and this run cannot separate them.

## 3 · The four steps, as the run took them

1. **STATE.** Every threshold sits in the tool's `STATED` object. The run prints its hash,
   `9476e584861e`, before it reads a night. The agreement band is Cohen kappa at 0.2 or above. The
   reference cut is 5.0 events per hour, pre-stated and fitted to no night here.
2. **BLIND.** The run labels the two arms `X` and `Y` by a per-run permutation, and prints each night
   under an opaque key. The frozen criterion is kappa, which is symmetric, so a reader who breaks the
   blind cannot move the verdict.
3. **FREEZE.** The thresholds live in the hashed object, and the arithmetic lives in the file. Nobody
   tunes anything at run time.
4. **UNBLIND, once.** The run then prints both arms per night, with the seed, the plants and the
   exclusions.

**The plant is load-bearing.** A blind instrument flags nothing, which reads exactly like a quiet
corpus, so a pre-registered band cannot test its own detection power. The run plants an 80 s cycle of
amplitude 0.5 % into the detector arm's input on the nights the seed picks. The agreement number stays
unreadable until those plants come back at 0.9.

## 4 · What the run measured

Command: `node tools/common-mode-blind-trial.mjs --seed 20261126`, over commit `4b515604`.

- **CLAIM blindTrialNights = 17 FROM analysis/common-mode-blind-trial-2026-11-26.json#verdict/population/checked nights read**
- **CLAIM blindTrialExcluded = 0 FROM analysis/common-mode-blind-trial-2026-11-26.json#verdict/population/excluded nights excluded**
- **CLAIM blindTrialDetectorPositives = 0 FROM analysis/common-mode-blind-trial-2026-11-26.json#verdict/result/spo2Positives detector positives**
- **CLAIM blindTrialReferencePositives = 12 FROM analysis/common-mode-blind-trial-2026-11-26.json#verdict/result/cvhrPositives reference positives**
- **CLAIM blindTrialPlantsBack = 6 FROM analysis/common-mode-blind-trial-2026-11-26.json#verdict/result/plantRecovered plants recovered of 6 planted**

The window is the 17 trio-eligible nights, 2026-06-10 through 2026-07-05. The reference index spans
3.4 to 7.9 events per hour, so the 5.0 cut splits the nights 12 against 5. The detector flags no real
night. All 6 planted cycles come back at 80 s, inside the 10 s tolerance. Kappa is 0.0000, and the
verdict is `UNDERPOWERED`.

On these nights the two persistence estimators nearly agree: lag 1 spans 0.9719 to 0.9874, and the
lag-2 figure sits at most 0.0032 below it and 0.0002 above it. The exported series carries no
whole-percent rounding, which is the condition the lag-1 fault needs, so the change moves no verdict
here. That is the same answer the 42 real ring nights gave in PR #5904.

## 5 · What this establishes

- The protocol RAN, on an occasion nobody manufactured, and its record is machine-readable.
- The detector is not blind on these nights, because every plant came back.
- The cross-instrument comparison carries no power on this corpus, and the run says so by name.

## 6 · What this does not establish

- It does not measure the detector's accuracy. The reference measures cyclic heart-rate variation.
- It does not test the rounding fault. These exported series are not whole-percent.
- It does not settle a disagreement, because no night disagrees in the direction that informs.

**The pattern repeats §7.2.** Capture–recapture also refused on quiet sleep, where the detectors agree
on every beat. A method that needs disagreement has power where the data is bad. These nights are
quiet, so the next run of this trial belongs on artefact-heavy nights, and the ring nights with poor
perfusion are the first candidate.

## Done when

- [x] The §7 protocol runs on a real detector change, with its four steps recorded in order.
- [x] The two arms sit on two devices, and the brief states what the reference measures instead.
- [x] A plant rides the same run, and the agreement band stays unreadable until the plants return.
- [x] The run emits one `tepna.verdict/1` object, registered in `tools/verdict-adoption.json`.
- [x] The record names the nights, the exclusions and the seed.
