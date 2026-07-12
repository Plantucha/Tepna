<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [PpgDex]
brief: none
---
Arbitrate the PPI spine by Malik correction rate — foot-to-foot vs the 3-LED-voted peak spine — fixing optical HR that read 2–3× true when `pickChannel` selects a harmonic-counting LED as the reference.

`consensusBeats` builds a reference-INDEPENDENT peak spine (a beat survives only where ≥2 of 3 LEDs
agree within ±50 ms), but `refineFeet` then re-derives the systolic feet on the SINGLE reference channel
chosen by `pickChannel`, and `buildPPI` measures foot-to-foot. `pickChannel` ranks channels by pulse-band
SNR (0.7–3.0 Hz) over one 90 s mid-record window — and a channel counting harmonics still lands inside
that band (a doubled 48 bpm = 96 bpm = 1.6 Hz), so a corrupted LED can be picked as the reference. When
it is, the vote's robustness is discarded exactly where it matters: the peak spine stays correct while
the feet collapse. On 2026-06-30 the voted peaks give 50.6 bpm (chest ECG: 50.0) while every reference
channel's feet give 80–132.

Because the failure is a SCALED copy of the true HR it stays highly correlated with it, so the
decorrelation-based Verity gate (`sensor-trio-worker.js:315` — σ>12 AND r<0.4 against both corners)
cannot see it: that gate is built for lost-contact noise, not harmonic multiple-counting.

Fix: build BOTH spines off the same consensus beats, Malik-correct each, and let the CORRECTION RATE
arbitrate — `correctRR` rejects impossible intervals, so a coherent series needs few repairs and a
doubled one needs many (measured separation on the real corpus: good half 1–29%, corrupted half 43–98%).
An agreement threshold was tried first and REJECTED: it detects only THAT the halves disagree, never
WHICH is right, and both directions occur (06-30 needs peaks, 06-15 needs feet) — a 0.90 cutoff duly
regressed 06-15 from a correct 49.1 bpm to a wrong 57.5. Feet remain the default and are displaced only
by a 10 pp margin, so clean records keep their foot spine and the committed `PpgDex_2026-06-27_equiv`
fixture reproduces byte-identically (`ppiSpine: 'foot'`, same `contentId`).

New rich-export quality fields: `ppiSpine`, `ppiAgreementPct`, and BOTH spines' repair rates
(`ppiCorrFootPct`, `ppiCorrPeakPct`). The winning rate alone does NOT separate good records from bad
(06-25 is correct at 28.8% while 06-29 is wrong at 30.5%), so consumers must not gate on it in isolation —
the decisive test is CROSS-NODE against a paired chest-ECG corner (Integrator/ECGDex), where the HR ratio
is 0.99–1.01 on good nights vs 1.6–2.9 on all-LED failures. Exporting both rates is what lets that
consumer decide with evidence rather than a guess.

Validated against chest-ECG truth on 17 concurrent trio nights: HR-clean nights 11 → 13 (recovers
2026-06-25 and 2026-06-30, no regressions). Four nights (06-29, 07-01, 07-02, 07-05) have all three LEDs
mis-detecting — NOT fixed by any spine choice, now flagged rather than silently wrong; a detector-level
fix is still owed. Verity's three-cornered-hat σ over the clean nights is 4.29 bpm, against 6.83 bpm when
the four broken nights are left in.
