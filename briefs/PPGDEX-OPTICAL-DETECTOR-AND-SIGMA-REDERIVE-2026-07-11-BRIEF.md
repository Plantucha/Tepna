<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-11 · **Follows:** the PPI-spine arbiter fix (changeset `2026-07-11-ppgdex-ppi-spine-crosscheck.md`) · **Feeds:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §1 · `PAPERS-ROADMAP-2026-06-24-BRIEF.md` §3.3 · `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`

# PpgDex optical detector — the residual all-LED failure, and re-deriving the published Verity σ

> **One-line:** the PPI-spine arbiter (shipped 2026-07-11) fixed the *reference-channel* half of the optical-HR
> failure and took the real trio corpus from 11 → 13 HR-clean nights out of 17. **Two things it did NOT fix
> remain owed:** (§1) four nights where **all three LEDs mis-detect**, which no spine choice can rescue — they
> are now *flagged*, not repaired; and (§2) the **published Verity σ of 6.2 bpm**, which appears to have been
> measured on a corpus containing exactly those broken nights, i.e. it may be measuring the bug rather than
> the device.

## Background — what was already fixed (do not redo)

`consensusBeats` builds a **reference-independent** peak spine (a beat survives only where ≥2 of 3 LEDs agree
within ±50 ms), but `refineFeet` then re-derived the systolic feet on the **single** reference channel picked by
`pickChannel`, and `buildPPI` measures foot-to-foot — so the vote's robustness was discarded exactly where it
counted. `pickChannel` ranks channels by pulse-band SNR (0.7–3.0 Hz) over one 90 s mid-record window, and a
channel counting **harmonics still lands inside that band** (a doubled 48 bpm = 96 bpm = 1.6 Hz), so a corrupted
LED could be selected as the reference. Result: optical HR read 2–3× true.

Shipped fix: build both spines off the same consensus beats, Malik-correct each, and let the **correction rate**
arbitrate (a coherent series needs few repairs; a doubled one needs many — measured separation on the real corpus:
good half 1–29%, corrupted half 43–98%). Feet stay the default, displaced only by a 10 pp margin, so clean records
are byte-identical. New rich-export quality fields: `ppiSpine`, `ppiAgreementPct`, `ppiCorrFootPct`, `ppiCorrPeakPct`.

⚠️ **An agreement threshold was tried FIRST and REJECTED — do not reintroduce it.** It detects only *that* the two
halves disagree, never *which* is right, and both directions occur in the real corpus (2026-06-30 needs peaks,
2026-06-15 needs feet). A 0.90 cutoff duly regressed 06-15 from a correct 49.1 bpm to a wrong 57.5.

## §1 — The residual: four nights where ALL THREE LEDs mis-detect

On four of the 17 concurrent trio nights the optical HR is still ~2× chest-ECG truth, and **neither** spine is
correct — the beat detector is failing on every channel, so the ≥2-of-3 vote happily ratifies spurious beats
(2/3 agreement on a harmonic is still 2/3). Ground truth is the paired Polar H10 raw-ECG corner.

| night | ECG (truth) | PpgDex HR | ratio | spine | footCorr | peakCorr |
|---|---|---|---|---|---|---|
| 2026-06-29 | 49.7 | 100 | 2.01 | peak | 43.8% | 30.5% |
| 2026-07-01 | 48.0 | 94 | 1.96 | peak | 92.7% | 61.7% |
| 2026-07-02 | 48.4 | 106 | 2.19 | foot | 42.3% | 34.1% |
| 2026-07-05 | 57.8 | 110 | 1.90 | foot | 60.4% | 76.4% |

Diagnostic already established (2026-07-01, `detectChannel` per LED): LED0 39 403 beats → 91.2 bpm while LED1/LED2
give 23 569 / 23 512 → 54.6 / 54.4 bpm. So the failure is **not** uniform noise — individual channels double-count
while others are near-truth, and on these four nights enough channels fail together to carry the vote.

**Done when**
- [ ] Root-cause the detector failure itself (`detectChannel` — O(N) TERMA, Elgendi 2013: positive-slope upstroke
      energy + dual moving-average local threshold). Hypotheses to test, in order: (a) the beat-adaptive threshold
      collapses on low-perfusion/high-DC-drift segments and starts firing on the **dicrotic notch**; (b) the
      refractory (0.30 s ⇒ a 200 bpm ceiling) is too permissive to suppress a notch at a sleeping 48 bpm
      (notch lands ~0.3–0.4 s after systole — *right at the edge*); (c) channel **orientation** (`orient()`
      derivative-skew) inverts on these records so the "peak" tracked is the wrong deflection.
- [ ] Fix at the detector, not with another downstream filter. A physiological plausibility guard on the
      *detected rate* (a sleeping adult is not at 100–160 bpm) is acceptable ONLY as a flag, never as a silent clamp
      — CLAUDE.md: `null` = unknown, never fabricated.
- [ ] Recover ≥3 of the 4 nights against chest-ECG truth (ratio 0.9–1.15), with **no regression** on the 13 currently-clean
      nights and the committed `PpgDex_2026-06-27_equiv` fixture still reproducing (byte-identical, or regenerated
      per §🔏 with the output re-derived, never hand-edited).
- [ ] `pickChannel` hardening (secondary): it ranks on ONE 90 s mid-record window of a 7-hour night and its SNR
      metric is blind to harmonic counting. Consider scoring across several windows and/or rejecting a channel whose
      detected rate is a near-integer multiple of the other channels'. The arbiter made this non-fatal — it is no
      longer load-bearing — so do it for robustness, not urgency.

## §2 — Re-derive the published Verity σ (6.2 bpm may be measuring the bug)

`sensor-trio-power-analysis.html:74` plants **"the real estimates 1.7 / 2.2 / 6.2 bpm"** (O2Ring / H10 / Verity) and
sweeps the power analysis against them. Measured through `tools/tch-multinight.mjs` on the 17-night trio corpus:

| corpus | Verity σ (ρ-on) |
|---|---|
| all 17 nights (**4 harmonic-broken included**) | **6.83 bpm** |
| **published estimate** | **6.2 bpm** |
| 13 HR-clean nights (post-fix) | **4.29 bpm** |

The published figure sits on the **contaminated** number, not the clean one. ECGDex 1.24 / OxyDex 1.24 bpm on the
clean 13. **This is suggestive, not proven** — `sensor-trio-worker.js` derives Verity HR on a **per-second** grid via
`ppgHrMapReal`, whereas the above is the node's **5-min epoch** series, so the two are not the same estimator and the
numbers are not required to coincide.

The reason it matters: the canonical Verity gate (`sensor-trio-worker.js:315` — drop iff σ>12 **AND** r<0.4 vs **both**
other corners) **cannot see this failure mode**. Harmonic multiple-counting produces HR ≈ k × truth, a *scaled copy*
that stays strongly **correlated** with truth, so the decorrelation test passes it. The gate is built for lost-contact
noise. On this corpus it let 2026-06-30 through at σ = 53 bpm.

**Done when**
- [ ] Re-run `sensor-trio-worker.js`'s own per-second Verity path over the trio corpus and report σ **with** and
      **without** the four broken nights, so the per-second and per-epoch estimators are compared like-for-like.
- [ ] Decide whether the shipped `sensor-trio-worker.js` Verity gate gains a **bias/ratio** test (median PpgDex HR vs
      the paired ECG corner: 0.99–1.01 on good nights vs 1.6–2.9 on all-LED failures — **bimodal, nothing between**)
      alongside the existing decorrelation test. Note the node-local `ppiCorr*Pct` rates are NOT sufficient in isolation
      (2026-06-25 is *correct* at 28.8% while 2026-06-29 is *wrong* at 30.5% — they overlap); the decisive signal is
      **cross-node**, which the Integrator/OverDex can compute because it holds both corners.
- [ ] If the re-derived σ moves, update `sensor-trio-power-analysis.html` (the planted 1.7/2.2/6.2), the
      `SIGMA-PAPER-REWRITE-2026-07-06` outputs, and anything else citing a Verity σ — and say plainly in the paper that
      the earlier figure included a detector artifact. **Do not quietly restate the number.**
- [ ] Re-check `VERITY-SIGMA-CORNER-BRIEF.md` §7's residual non-resting item against the corrected detector.

## Inputs (already committed — no new capture needed)

`uploads/trio/` — 17 concurrent trio nights × 3 `ganglior.node-export` JSONs (ECGDex · PpgDex · OxyDex), derived by
`tools/trio-batch.mjs` from the raw Polar Sensor Logger + O2Ring capture folder, every export run through the shared
`dexScrubExport` (no device/serial/model, 5-min summary epochs, **no raw signal**). Corners are paired by **temporal
overlap** against the O2Ring anchor — filename date ≠ night, and a size-based pick silently mated a 12:14 daytime ECG
with an overnight PPG on 2026-06-13 before this was fixed. The raw capture folder itself stays gitignored.
