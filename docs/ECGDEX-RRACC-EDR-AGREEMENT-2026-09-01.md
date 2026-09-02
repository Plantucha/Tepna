<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living validation note) · **Created:** 2026-09-01 · **last-verified:** 2026-09-01
· **Executes:** `briefs/DEEP-AUDIT-VI-2026-09-01-BRIEF.md` F4 (the tier the badge would have asserted)
· **Apparatus:** the shipped `ECGDSP.accExtras` agreement block, driven over the real corpus

# ACC-derived respiration (RRacc) vs ECG-derived respiration (EDR) — the agreement, measured

**One-line verdict: the two do NOT cross-validate each other, so `rraccRate` is `experimental`, not
`emerging`.** Median Pearson r **0.07** across 45 nights, 95 % limits of agreement typically
**-4 ... +7.5 br/min** against a mean rate near **16 br/min** (+/-44 %), and a median **27 %** of paired
5-min epochs differing by more than 3 br/min. This is a legitimate outcome, not a deferral: it is what
the grade now rests on, and the registry cite points here.

## 1 - Why this exists

`rraccRate` carried `evidence: 'emerging'` and a `dormant: true` flag asserting it reached "no export
and no surface". Both were wrong - the metric has been computed by `accExtras` and surfaced by the
ACC sub-cards since the initial commit - and the flag's own contract says promotion means removing it
**and re-adjudicating the grade at that moment**. Nothing in the repo recorded what had been measured
or against what, so DEEP-AUDIT-VI F4 measured it before wiring the badge the coverage mandate requires.

## 2 - Data & method

- **Corpus:** `/srv/data/tepna-corpus/smoketest-captures`, every night with a Polar H10 `_ECG.txt` and
  its `_ACC.txt` sibling. Real recordings are gitignored (personal biosignal data); this note records
  the numbers, the apparatus re-derives them.
- **Fragment selection, stated because it is a choice:** one fragment per night - the **largest**
  `_ECG.txt` of that night, and only if it exceeds 20 MB (~40 min at 130 Hz). Short fragments are
  excluded deliberately: with a handful of paired epochs the agreement statistics are dominated by
  their own sampling error, the mirror of the span-gate reasoning in Clock Contract section 7.
  45 nights qualified.
- **Pipeline, entirely the shipped code, no bespoke estimator:** `ECGDSP.parseECG` ->
  `ECGDSP.analyze` -> `ECGDSP.parseDeviceACC` -> `ECGDSP.accExtras(acc, accFs, t0Ms, durSec, epochs,
  stages)`, then its own `agreement` block (paired 5-min epochs, Bland-Altman bias and 95 % limits,
  Pearson r, and the >3 br/min disagreement share the card prints).
- **What is being compared:** RRacc (chest-axis accelerometer magnitude, dominant FFT frequency in
  0.15-0.45 Hz per 30-s epoch, low-SNR epochs excluded) against EDR (respiration from R-peak amplitude
  modulation). **Both are surrogates.** Neither is a reference standard, which is exactly why their
  agreement was the only evidence available for the tier - and why a negative result caps both.

## 3 - Result

| night | dur (min) | paired epochs | r | MAE (br/min) | 95 % LoA (br/min) | bias | pairs >3 apart | high-conf epochs |
|---|---|---|---|---|---|---|---|---|
| 2026-07-16 | 187.4 | 37 | -0.16 | 3.04 | -4 … 9.5 | 2.73 | 35 % | 51 % |
| 2026-07-17 | 122.4 | 24 | -0.23 | 4.37 | -4.5 … 11.2 | 3.36 | 58 % | 46 % |
| 2026-07-18 | 295.4 | 58 | 0.07 | 2.5 | -5.9 … 9 | 1.58 | 21 % | 54 % |
| 2026-07-19 | 251.1 | 49 | 0.32 | 3.07 | -3.4 … 8.6 | 2.62 | 35 % | 60 % |
| 2026-07-20 | 374.6 | 73 | -0.07 | 2.65 | -4.1 … 8 | 1.98 | 29 % | 40 % |
| 2026-07-21 | 344.4 | 68 | 0.16 | 3.27 | -5.1 … 10.3 | 2.62 | 38 % | 60 % |
| 2026-07-22 | 388.5 | 78 | 0.12 | 1.8 | -4.5 … 6.8 | 1.12 | 14 % | 84 % |
| 2026-07-23 | 206.3 | 41 | -0.29 | 3.12 | -4.4 … 9.6 | 2.62 | 37 % | 49 % |
| 2026-07-24 | 123 | 25 | 0.05 | 1.59 | -3.6 … 5.1 | 0.77 | 16 % | 69 % |
| 2026-07-25 | 174 | 35 | 0.12 | 3.09 | -3.4 … 8.4 | 2.5 | 34 % | 38 % |
| 2026-07-26 | 433.5 | 86 | 0.13 | 2.09 | -3.7 … 6.8 | 1.51 | 23 % | 62 % |
| 2026-07-27 | 373.2 | 71 | 0.13 | 1.55 | -4.2 … 5.1 | 0.45 | 11 % | 49 % |
| 2026-07-28 | 182.4 | 37 | 0.28 | 2.11 | -3.8 … 6.4 | 1.32 | 22 % | 52 % |
| 2026-07-29 | 234.4 | 47 | 0.21 | 2.77 | -3.3 … 8.3 | 2.49 | 40 % | 62 % |
| 2026-07-31 | 144.6 | 29 | -0.03 | 3.92 | -3.1 … 10.2 | 3.58 | 55 % | 55 % |
| 2026-08-01 | 563.2 | 111 | -0.03 | 2.65 | -4.9 … 8.1 | 1.57 | 32 % | 67 % |
| 2026-08-02 | 109.2 | 22 | -0.39 | 2.45 | -5 … 8.1 | 1.52 | 27 % | 39 % |
| 2026-08-03 | 478.7 | 92 | -0.08 | 3.28 | -5.2 … 9.9 | 2.32 | 41 % | 62 % |
| 2026-08-04 | 465.9 | 89 | 0.25 | 2.66 | -3.7 … 8 | 2.17 | 31 % | 55 % |
| 2026-08-05 | 455.3 | 90 | -0.1 | 2.37 | -4.8 … 7.8 | 1.51 | 27 % | 68 % |
| 2026-08-06 | 565.3 | 108 | 0.06 | 2.1 | -4.8 … 7.2 | 1.21 | 23 % | 53 % |
| 2026-08-07 | 544.2 | 91 | -0.09 | 2.85 | -5.4 … 8.7 | 1.66 | 35 % | 44 % |
| 2026-08-09 | 412.3 | 81 | 0.07 | 1.96 | -3.8 … 6.7 | 1.44 | 21 % | 55 % |
| 2026-08-10 | 423.7 | 73 | 0.16 | 1.84 | -4 … 6.1 | 1.05 | 18 % | 60 % |
| 2026-08-11 | 469.4 | 80 | 0.26 | 2 | -3.7 … 6.3 | 1.3 | 26 % | 65 % |
| 2026-08-12 | 455.4 | 89 | 0.12 | 2.26 | -4.6 … 7.3 | 1.35 | 27 % | 58 % |
| 2026-08-13 | 285.3 | 53 | 0.32 | 1.56 | -3.7 … 5.4 | 0.89 | 15 % | 49 % |
| 2026-08-14 | 251.6 | 47 | -0.34 | 2.53 | -3.9 … 8.1 | 2.12 | 26 % | 34 % |
| 2026-08-15 | 489.1 | 96 | -0.1 | 2.28 | -4 … 7.1 | 1.52 | 24 % | 50 % |
| 2026-08-16 | 368.6 | 70 | 0.05 | 2.57 | -4.6 … 8.8 | 2.09 | 26 % | 51 % |
| 2026-08-17 | 302.1 | 55 | 0.02 | 2.72 | -4.3 … 7.8 | 1.76 | 40 % | 35 % |
| 2026-08-18 | 443.8 | 84 | -0.1 | 2.37 | -4 … 7.5 | 1.74 | 24 % | 50 % |
| 2026-08-19 | 368 | 73 | 0 | 2.28 | -4 … 7.5 | 1.72 | 23 % | 58 % |
| 2026-08-20 | 226 | 43 | -0.15 | 2.2 | -3.5 … 7.4 | 1.97 | 23 % | 56 % |
| 2026-08-21 | 472.5 | 88 | 0.07 | 2.12 | -4.6 … 7.1 | 1.26 | 19 % | 42 % |
| 2026-08-22 | 265.7 | 52 | 0.25 | 2.02 | -3 … 6.4 | 1.73 | 23 % | 53 % |
| 2026-08-23 | 152.2 | 25 | 0.41 | 1.52 | -2.3 … 4.5 | 1.13 | 16 % | 31 % |
| 2026-08-24 | 368.8 | 74 | -0.24 | 3.07 | -4.6 … 9.2 | 2.31 | 39 % | 58 % |
| 2026-08-25 | 634.6 | 124 | 0.08 | 3.53 | -6.6 … 9.8 | 1.61 | 51 % | 48 % |
| 2026-08-26 | 524.5 | 102 | -0.09 | 3.22 | -7.2 … 8.9 | 0.84 | 41 % | 47 % |
| 2026-08-27 | 48.9 | 10 | 0.58 | 0.92 | -2.4 … 3.4 | 0.5 | 10 % | 86 % |
| 2026-08-28 | 371 | 71 | 0.24 | 2.1 | -3.6 … 6.4 | 1.42 | 20 % | 42 % |
| 2026-08-29 | 339.5 | 58 | 0.17 | 3.65 | -8.3 … 9.8 | 0.74 | 55 % | 54 % |
| 2026-08-30 | 289.5 | 53 | 0.09 | 2.9 | -4.9 … 8.2 | 1.68 | 40 % | 43 % |
| 2026-08-31 | 305.9 | 50 | -0.12 | 3.19 | -6.7 … 9.5 | 1.37 | 40 % | 38 % |

**Summary over 45 nights** - median **r 0.07** (range -0.34 ... +0.58) - median **MAE 2.5 br/min**
(0.92 ... 4.37) - median **bias +1.58 br/min** (RRacc reads high) - median **27 %** of pairs >3 br/min
apart - median 70 paired epochs/night - median 53 % of RRacc epochs high-confidence.

## 4 - Reading it

- **The near-zero r is not the whole story, and neither is it rescued by the usual defence.** The card
  carries a note saying a low r reflects EDR's narrow nightly range rather than poor tracking, and
  that Bland-Altman governs when the spread is small. The first half is fair - with a compressed true
  range, r is uninformative. The second half is where it fails: **by the statistic it nominates**, the
  limits are -4 ... +7.5 br/min on a ~16 br/min mean. A method that may read 12 where the other reads
  20 has not been cross-validated by it.
- **The bias is systematic and one-signed.** RRacc reads **higher** than EDR on 45 of 45 nights
  (median +1.58). A constant offset between two surrogates is the most benign disagreement there is -
  but it is still a disagreement, and nothing here identifies which signal carries it.
- **Best and worst nights are informative about apparatus, not physiology.** The tightest night
  (2026-08-27, r 0.58, LoA -2.4 ... +3.4) is also the shortest qualifying one at 49 min with 86 %
  high-confidence epochs; the loosest (2026-07-17, MAE 4.4, 58 % of pairs >3 apart) has 46 %. Agreement
  tracks **RRacc confidence**, i.e. how still the sleeper was, not the hour of the night.
- **What would change the grade.** A promotion to `emerging` needs agreement against a REFERENCE, not
  a second surrogate - a respiratory band, capnography, or a PSG thoracic channel - or a demonstration
  that the +/-7 br/min limits collapse once low-confidence epochs are excluded on both sides. Neither
  is available in this corpus.

## 5 - What was changed on the strength of it

- `rraccRate`: `emerging` -> **`experimental`**, with the summary in its cite and this note as the link.
- `edrAgreement`: tier unchanged (it is the agreement STATISTIC, and its standing does not depend on
  the answer being positive), cite corrected - it called itself "a cross-validation of two surrogate
  respiration signals", which is the claim this measurement refutes.
- `edrDisagree`: `dormant` flag removed, `heuristic` unchanged and consistent with the 27 % median.
- The ACC card no longer prints "they agree to within N br/min, cross-validating both" off a
  whole-night delta of two means. It prints the paired-epoch limits, the bias and the >3 br/min share.
