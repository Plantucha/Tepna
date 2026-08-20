<!--
  O2RING-TIME-CAPABILITY-WIRING-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-19 · **Follows:** `O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md` §9 (RTC readable), `O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md` (step 1 DONE)

# Wiring the ring's readable clock into the Dexes, the Integrator, and the trio fold

> **Scope:** Dex lane (bundles + fixtures + gates) + `tools/trio-batch.mjs`. The capture-host half
> already shipped (#1543 readback · #1544 settings · #1548 monitor).
> **Owner question this answers:** "wire new o2ring time capability to dexes and integrator, trio,
> re-assess 3 corner hat, try run PAT" — the PAT run and TCH verdict are §4/§5, measured 2026-08-19.

## 1 · What the new capability actually gives each consumer

The RTC readback (GET_INFO [24:31], ±1 s quantum) verifies the **1 Hz summary layer's** absolute
placement — the stored `.dat` and the live SPO2 rows. It gives NOTHING at waveform resolution: the
ring's 125 Hz pleth axis remains host-back-timed and its device stamp remains drawn
([[o2ring-timestamp-is-drawn]]). Every wiring item below must respect that boundary.

## 2 · The wiring items (Dex lane — each is a gated behavioral change)

- **2a · OxyDex `.dat` import carries a verified timebase.** `oxydex-dsp.js`'s stored-session path
  stamps `timingSource: 'device+host-verified'` + the measured `rtcOffsetS` into the night object and
  the `ganglior.node-export` (additive field, MINOR) when a capture-side RTC readback exists for the
  session; `'device'` (unverified) otherwise. Consumers stop treating all `.dat` nights as
  free-running-RTC nights.
- **2b · The Integrator's clock-skew veto consumes the readback.** The veto that caught the CPAP's
  42-min skew currently has no O2Ring leg; feed it `ring_rtc_offset_s` from the night's QC/arrival
  metadata so a ring whose RTC was reset by a battery event (known failure) is vetoed instead of
  silently mis-placed. Additive: a missing offset changes nothing.
- **2c · trio fold records the offset.** `tools/trio-batch.mjs` copies the capture's ring-RTC
  readings (offset, read time) into `arrival_<night>.json` so the fold's provenance names the clock
  state it folded under — same pattern as the existing arrival-quality fields.

## 3 · What is deliberately NOT wired

- No waveform-timing change anywhere: the readback cannot improve beat-level placement (±1 s vs the
  ~10 ms PAT needs). The buzz fiducial (2b/three-way leg) remains the only path there.
- No badge/tier upgrades: a verified 1 Hz timebase does not upgrade any metric's evidence tier.

## 4 · Three-cornered hat — REASSESSED (verdict: unchanged, and now provably so)

The RTC readback adds a ±1 s-quantized clock; TCH estimates σ_y(τ) from ms-scale phase series. A third
corner needs an independent clock at the NOISE level of the other two, and ±1 s quantization sits 2–3
orders above it — the readback is structurally unable to be a corner. The binding limits remain the
measured ones: ρ≈0.77 common-mode correlation between the "independent" pairs, and the corpus's
phone-captured nights carrying no second clock at all. **What COULD change TCH is the buzz fiducial's
three-way leg** (ring↔H10↔Verity, one mechanical event in three records, ~±8–20 ms): three genuinely
shared fiducials would over-determine the pairwise offsets — that is a fiducial network, not a hat,
and it is the better instrument for this corpus. Route TCH effort there.

## 5 · PAT — first scored run under the shipped hostAxis offset (2026-08-19)

`node tools/pat-host-offset.mjs --dir uploads/captures --night 2026-08-14` (ECG ref, PPG foot,
120-min windows, 50 surrogates):

| win | beats | legacy match (chance) | p | strict ≤40 ms (chance) | p |
|---|---|---|---|---|---|
| 0 | 6191 | 48 % (20 %) | 0.020 | 7 % (7 %) | 0.510 |
| 120 | 6329 | 81 % (21 %) | 0.020 | 12 % (7 %) | 0.020 |

**Reading:** cross-device beat PAIRING is real and strong (legacy 65 % mean vs 20 % chance, both
windows p=0.02) — trend-level PAT exists on box nights today. **Beat-level PAT is not yet a
measurement**: the strict 40 ms bar beats its own null in one window of two, marginally — and the
literature (Mukkamala 2015, IEEE TBME, DOI 10.1109/TBME.2015.2441951) puts BP sensitivity at
~1 mmHg/ms, so even 40 ms is coarse for per-beat BP. The chain stays: buzz fiducial → ±20 ms clock →
beat-level PAT → per-user calibration (Finnegan 2021, Sci Rep, DOI 10.1038/s41598-021-01358-4;
foot fiducial per Block 2020, Sci Rep, DOI 10.1038/s41598-020-73143-8). 2026-08-15 scored no window
(the duty-cycle-fragmented night; input pairing failed before scoring — recorded as unscoreable, not
as absence of coupling). O2Ring-side PAT (finger) additionally waits on the buzz because the ring's
waveform axis is drawn and is refused as a clock by design.

## 6 · Stream routing (owner question, settled)

1 Hz oximetry (SPO2.csv / stored .dat) → **OxyDex**. Waveform streams (125 Hz pleth, ~100 Hz ppg2w)
→ **PpgDex machinery** (PPGDSP consensus → buildPPI → Malik correctRR — the Verity path). PAT consumes
the waveform side.

## Done when

- [ ] 2a ships behind the OxyDex gates (suite + provenance; export field is additive).
- [ ] 2b ships in the Integrator with a fixture where a planted RTC reset is vetoed.
- [ ] 2c lands in trio-batch with the offset visible in a real night's arrival JSON.
- [ ] §4's fiducial-network alternative is either adopted into the TCH roadmap or explicitly declined.
