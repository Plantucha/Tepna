<!--
  COMBINATOR-2026-11-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED (deferred 2026-11-14 — blocked on SIGNAL-QUALITY-TABLE pilot) · **Created:** 2026-11-14

# Combinator — raw signals in, one table of quantities with σ out

Owner idea, 2026-11-14. The Combinator reads every raw signal of a night through the DSP engines.
It finds what each signal misses, measures the σ of each sensor per window and per night, and
combines the sources of each quantity. The Integrator reads node JSON exports; the Combinator
reads raw streams. This brief depends on `SIGNAL-QUALITY-TABLE-2026-11-14-BRIEF.md`.

## 1 · Prior work this brief builds on

| what | where |
|---|---|
| three-corner hat over multi-window trios, per-device σ, negative-variance checks | `sigma-no-reference-analysis.js` |
| fused-weight hat | `sensor-trio-worker.js`, `TCH-FUSED-ROBUST-HAT-2026-07-14` |
| σ window derivation | `tools/derive-sigma-window.mjs`, `docs/SIGMA-WINDOW-DERIVATION.md` |
| Verity σ corner | `briefs/VERITY-SIGMA-CORNER-BRIEF.md` |
| derived quantities across sensors | `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` and its 2026-07-18 follow-ups |
| PPG channel combination, fit half and eval half | `tools/ppg-channel-combination.mjs` |
| one timebase for every device | `clock.js` `DexClock.hostAxis` |
| absence spans | the RUNS sidecars (`PPG-ABSENCE-AS-VALUE`) |

## 2 · Pipeline

1. Alignment. Put every stream on the host axis. Measure the lag of each pair before any
   comparison. A σ over misaligned streams measures the lag, not the sensor.
2. Coverage map. Mark each quantity per window as measured, derived, absent or refused, from the
   signal-quality table. An absent window is `null`, never a fill.
3. σ per window and per night, and σ against averaging time. Run the Allan deviation on the
   pairwise DIFFERENCES between sensors, never on one sensor's series alone. The physiology
   cancels in a difference, so the curve describes the sensors, not the sleep. The existing
   `integrator-tch.js` `allanTriplet` already does this split. The curve also sets the window
   length: the window sits where the curve is lowest.
   Use the three-corner hat where three independent sources exist.
   Use an N-corner hat with a covariance term where errors correlate, because two optical sensors
   on one wrist share motion error and break the plain hat.
4. Combination. Weight each source by inverse variance and remove its Bland–Altman bias first.
   When two sources disagree past their joint limits, flag the window. Never average the
   disagreement away.
5. Conditioning. Report σ by motion state and by sleep stage, because one night σ hides a
   sensor that fails only while the sleeper moves.
6. The quantity table. One row per quantity, one column per source, plus the combined value, its
   σ and its evidence badge.

## 3 · Quantities

| quantity | sources | note |
|---|---|---|
| heart rate | ECG, PPG (Verity, O2Ring) | HR from raw streams only (CLAUDE.md "Honest HR") |
| breathing rate | CPAP flow, ECG-derived, PPG-derived, ACC | CPAP flow is the measured corner |
| SpO₂ | O2Ring only | single source: σ reads `null`, reason `single-source` |
| pulse arrival time | ECG + PPG | a derived quantity with its own σ |
| HRV | ECG, PPG | ECG is the measured corner |
| apnea and hypopnea events | CPAP, SpO₂, HR | events, not a σ |
| posture and movement | ACC (H10, Verity, O2Ring) | |
| sleep stage | ECG today, EEG later | the EEG corner waits for EEGDex |

## 4 · Boundaries

- The Integrator keeps event fusion over exports. The Combinator owns per-window quantities from
  raw streams. Neither re-implements the other.
- The Combinator is a streaming Node tool. It holds one night at a time and stays under the 8 GB
  memory rule.
- The Combinator emits a `tepna.verdict/1` object for each σ claim, with the population and the
  pre-stated window.
- Per-night values stay off the public repo.

## 5 · Phases

- [ ] Phase 0: the signal-quality table exists on ECGDex and PpgDex.
- [ ] Phase 1: HR and breathing rate, three-corner and N-corner hat, quantity table for one night.
- [ ] Phase 2: the same over the tri-device corpus, with σ by motion state.
- [ ] Phase 3: PAT, HRV and events.
- [ ] Phase 4: the EEG corner, after EEGDex ships.

## 6 · Open questions

- Is the Combinator a page, a tool, or both? A tool first keeps it off the bundle spine.
- Which grid does the per-window σ use? It must match the signal-quality table's strip.
