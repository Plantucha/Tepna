<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (deferred 2026-10-18 — owner: drain briefs and residue first) · **Created:** 2026-10-18

> **Owner ask, 2026-10-18:** "integrator definitely should have come comparators for each shared metrics like ecgdex have … all wit table and graphs", then "are we able create neural network that will make it better, similar to oxydex sleep network?", then "for now just write brief. we return to it."

# Integrator comparators, and a CPAP-referenced breathing-rate model

Rule 0: "Integrator comparator shared metrics respiration rate CPAP ECG EDR ACC agreement table" → `briefs/FUSION-REPORTS-2026-10-11-BRIEF.md`, `docs/ECGDEX-RRACC-EDR-AGREEMENT-2026-09-01.md`, `papers/cpap-flow-reference.html`, `resp-acc-analysis.js`, `integrator-dsp.js` (`gateHRVByMotion`).

## 1 · Why this exists

Several nodes measure the same quantity. Breathing rate comes from the CPAP flow, the ECG, the PPG and the accelerometer. Heart rate comes from the H10 ECG, the Verity PPG, the O2Ring and the CPAP oximeter. The ECGDex page compares some of these pairs in panels of its own. The Integrator, which sees every node, compares a few of them with one number per night and draws none of them.

The owner wants one comparator per shared metric in the Integrator, each with a table and a graph. The owner also asked whether a neural network can improve the poor accelerometer-vs-ECG breathing agreement. Part B answers that question.

## 2 · What exists today (measured 2026-10-18 on `main` @ `433cf53b0`)

| metric | Integrator fuser | sources it reads | gap |
|---|---|---|---|
| breathing rate | `fuseRespirationRate` (`integrator-dsp.js:3520`) | ECGDex RSA, PpgDex RSA, MotionDex ACC (`summary.respRateBrpm`) | **CPAPDex is absent.** `cpapdex-dsp.js:1193`/`:1447` computes `respRateMedian` from the flow, and the CPAPDex normalize branch (`integrator-dsp.js:607`) never reads it. The strongest breathing reference in the suite reaches no fusion. |
| heart rate | `hrAgreement` (`:5902`), `fusePulseCrossCheck` (`:3262`) | finger PPG vs O2Ring 1 Hz pulse; HR sources | one number per night, no series graph |
| HRV | `fuseHRVConsensus` (`:3689`) | RR-bearing nodes | no per-source table |
| sleep stage | `fuseStagingConsensus` (`:3932`) | staging nodes | the ACC motion vote and the cardiorespiratory staging live only in `ecgdex-app.js` |
| H10 beat intervals | none | — | the "computed RR vs firmware RR" check (`ECGDSP.validateRR`, `alignFirmwareRR`) runs only in the ECGDex page. The orchestrate ECG export does not carry the device RR. |
| RRacc vs EDR | none | — | lives only in `ecgdex-app.js buildV2` / `_accRespAt` |

Node exports carry one number per night for most of these metrics. A graph needs a timed series, so most comparators need a new export field first.

## 3 · Part A — the comparators

One PR per unit. Each comparator shows a per-source table (value, `n`, covered span, badge) and a graph over the night. Where two sources pair epoch by epoch, it also shows a Bland–Altman plot. Every series carries its evidence badge (CLAUDE.md §🎫). An absent source is a named absence, never a zero (§∅).

- [ ] **A1 · breathing rate.** Read CPAPDex `respRateMedian` into `summary.respRateBrpm` with method `cpap-flow`. Make the CPAP the reference when present. Export a per-epoch breathing-rate series from CPAPDex, ECGDex (EDR/RSA), PpgDex and MotionDex. Draw the table, the series graph and Bland–Altman against the CPAP. This moves the CPAPDex, ECGDex and MotionDex `manifestHash` and `computeHash`; regenerate their fixtures with `tools/regen-<node>-goldens.mjs`.
- [ ] **A2 · heart rate.** Export an HR series from ECGDex (Pan–Tompkins), PpgDex, OxyDex and CPAPDex (oximeter pulse). Draw the table and the series graph, with each pair's bias and limits of agreement.
- [ ] **A3 · H10 beat intervals, computed vs firmware.** Carry the device RR into the orchestrate ECG export (ECGDEX-FOLLOWUPS-2026-06-27 §1 names the companion-less export). Move `validateRR` / `alignFirmwareRR` agreement into the Integrator, with a table and a delta-over-time graph.
- [ ] **A4 · posture and staging.** Compare ECGDex posture against MotionDex posture. Move the ACC motion vote and the cardiorespiratory staging into the shared engine, and show the four-way staging agreement.

**Context.** PR #3649 (2026-10-18) routes the Polar ACC to MotionDex in OverDex. It pairs the chest and arm ACC of one night into ONE MotionDex run, so the Integrator receives one MotionDex export. A1 and A4 depend on that export.

## 4 · Part B — a CPAP-referenced breathing-rate model

### 4.1 · The finding that frames it

`docs/ECGDEX-RRACC-EDR-AGREEMENT-2026-09-01.md`: RRacc vs EDR, median Pearson r 0.07 over 45 nights, 95 % limits typically −4 … +7.5 br/min. **Both are surrogates.** Their disagreement does not say which one is wrong. A network trained to make them agree would learn to copy one of them. A model needs a reference target.

### 4.2 · The reference exists

`papers/cpap-flow-reference.html` uses the CPAP flow as a breathing reference:

| property | value | population |
|---|---|---|
| reference self-noise (two flow estimators) | median MAE 0.74 br/min (range 0.56–1.19) | 26 nights |
| clock drift fit, CPAP vs strap | +0.589 s/day, residual SD 1.03 s | 37 days |
| weak-correlation nights still locked correctly | 4 of 26 | 26 nights |

The paper's interpretive rule holds here: a model that scores below ~0.70 br/min against this reference is fitting the reference's quirks, not breathing.

### 4.3 · Step 1 — score each surrogate against the CPAP flow (no model)

- [ ] Extend `resp-acc-analysis.js` to score ECGDex EDR, ECGDex RSA and PpgDex RSA on the same aligned epochs. It already scores `MOTIONDSP.respiratoryRate` against the flow.
- [ ] Report per source: bias, 95 % limits, MAE, and the share of epochs > 3 br/min off. Split each by posture and movement. Split it also by the 8–12 br/min band that `ECGDEX-EDR-RESP-ACCURACY-2026-07-31` left open.
- [ ] Emit one `tepna.verdict/1` per source, with the criterion stated before the run.

If one surrogate tracks the flow well and the other does not, a quality-weighted fusion may suffice and Step 2 is not needed. Step 1 decides that.

### 4.4 · Step 2 — the model (only if Step 1 shows the need)

The model takes the same path as the stage-lab network. PyTorch trains it on rig-x870. `tools/seqnet-export.py` exports the weights as `tepna-seqnet/1` JSON. `tools/seqnet-infer.mjs` runs them in plain JS inside the bundle, and `tests/seqnet-port-tests.mjs` holds the port to 1e-4. The bundle needs no runtime library and no network.

- [ ] **Features** per 30-s epoch: chest and arm ACC band spectra, EDR, RSA, the `sqi` flags, posture.
- [ ] **Target**: the CPAP-flow rate of that epoch, on the clock-aligned axis of `resp-acc-analysis.js`.
- [ ] **Validation**: leave-nights-out. No night is in both training and testing. Report against the 0.74 br/min floor.
- [ ] **Output**: a fused breathing rate per epoch with a confidence, as one more series in comparator A1.
- [ ] **Grade**: `experimental` at most until a second subject exists.

### 4.5 · Limits, stated before any build

- **n-of-1.** One person, one mask, one machine. A model that works here proves nothing about anyone else.
- **CPAP changes the respiration.** Every training night is a therapy night. Whether the model holds on a night without CPAP needs its own check.
- **Corpus.** Lazy-load under 8 GB (owner standing rule, 2026-09-15). Real recordings stay out of the repo. A commit carries aggregates only.

## 5 · Cost

| unit | size |
|---|---|
| A1 breathing rate | 1 unit, plus three nodes' fixture regeneration |
| A2 heart rate | 1 unit |
| A3 beat intervals | 1 unit |
| A4 posture and staging | 1–2 units |
| B Step 1 | 1 unit |
| B Step 2 | 3–4 units: features, training, JS port with parity, Integrator wiring |

## 6 · Done when

The executing PR ticks every box above, `npm run check` passes on the final state of each unit, and `Dex-Test-Suite.html?full` is all green after each bundle change.
