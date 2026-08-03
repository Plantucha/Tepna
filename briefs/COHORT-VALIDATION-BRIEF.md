<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-08-03 · **Created:** (undated — pre-2026-07-03, grandfathered) · **Verified:** `cohort-runner.html` ships the harness and carries the 10k scale it was specified for; `cohort-worker` is namespaced against `<Node>._bare` and its `matchRecall` copy is now gated (PR #726).

# Build Brief — Ganglior Cohort Validation Harness (10k synthetic patients)

> **For the next thread / an AI coder.** Read `CLAUDE.md` first (esp. THE CLOCK CONTRACT), then
> `SYNTHETIC-CORPUS-BRIEF.md` + `SYNTHETIC-CORPUS-README.md` (the single-subject generator this
> generalizes), then this. Goal: a self-running, local, reproducible harness that generates N
> synthetic patients, runs each through the real headless Dex pipeline, and harvests an aggregate
> `summary.json` for analysis. 100% local, no network. Start with a **measured 1k pilot**, then 10k.

## Why / what
Validate the whole Dex + Integrator stack against a large, physiologically-coherent synthetic cohort
that explores the state space (severity × age × BMI × therapy × glycemia × **artifacts × missingness ×
longitudinal arc**) — not the same few patterns reseeded. Output = calibration (est-AHI vs truth-AHI,
ODI↔CVHR, hypo↔HRV, change-point recall), metric distributions/percentiles per stratum, edge-case
coverage matrix, and a failure ledger (seed-reproducible).

## Reuse (do NOT rebuild these)
- **`synth-gen.js` (710 lines)** — already has `MasterTimeline(nightConfig) → events[]` + per-device
  renderers (`renderOxy/ECG/PPG/PPI/ACC/GYRO/Gluco/HRV`) + `ground_truth.json`, deterministic
  (`mulberry32`). Lift these renderers unchanged; wrap them in a patient sampler.
- **Headless DSP globals** (all expose pure `.analyze()` / builders, no DOM):
  `window.ECGDSP.analyze` · `PPGDSP.analyze` · `GLUDSP.analyze` · `CpapDsp.buildSessionFromEdf/buildNight`
  · OxyDex dsp · `IntegratorDSP.normalizeFile` + `runFusion` · `CrossNightEnvelope` · registries · `DexKernel`.
- **`Dex-Test-Suite.html`** — copy its module-loading block (the exact `<script src>` list + the `env`
  wiring at ~line 120) so the runner loads every module the same way and always tracks live source.

## Three new files (each <1000 lines; reference modules via `<script src>`, do NOT inline/bundle)
1. **`cohort-gen.js`** (~900 ln) — `patient(seed) → {profile, nights[], groundTruth}`. Samples the
   parameter space below with a seeded RNG (seed = patient index → byte-reproducible, independent draws).
   Reuses synth-gen renderers. **Fast mode:** emit PpgDex at PPI/summary level (skip 176 Hz waveform).
   **Full mode:** emit a ~9-min 176 Hz PPG window for real `PPGDSP.analyze`.
2. **`cohort-worker.js`** (~200 ln) — a Web Worker: loads the DSP globals once, then per patient runs
   `Oxy→ECG→PPG→CPAP→Gluco→HRV→Integrator.normalize→runFusion`, scores recall vs groundTruth, returns one
   compact `result` record (node headline metrics + fusion findings + recall/precision + kernel hash +
   provenance completeness + **per-node wall-time** + error/warning flags).
3. **`cohort-runner.html`** (~600–900 ln) — shell + UI (progress, ETA, throughput, live metric
   histograms, failure list) + worker pool (`navigator.hardwareConcurrency`) + IndexedDB resume
   (append-only; refresh/crash-safe) + end-of-run `summary.json` aggregation + "Download cohort.zip".

## Parameter space (the credibility axis)
age 20–85 · sex · BMI 19–48 (drives OSA prior) · OSA severity none/mild/mod/severe (AHI 0–80) · event mix
(obstructive/central/hypopnea/CSR) · CPAP state (untreated/new/adherent-residual/non-adherent) · glycemic
(normal/pre-DM/T2D + nocturnal-hypo & dawn flags) · autonomic rMSSD/SDNN baseline + age-decline ·
**artifact model** (dropout %, motion density, leak, ectopy) · **missingness** (which nodes present,
partial nights, empty-PPI, off-body) · **longitudinal arc** (flat/improving/worsening/intervention-step,
1–12 nights).

## File structure (local, resumable)
```
cohort/
  manifest.json          # seed, N, scenario-mix weights, dex+kernel versions, started/finished
  patients/pNNNNNN/
    profile.json · ground_truth.json · raw/ (Full only) · result.json
  results.jsonl          # 1 compact line/patient, appended live (≈1–3 KB/patient)
  summary.json           # aggregates — the upload-to-Claude artifact (~1–5 MB regardless of N)
```

## Harvest / analysis payload (`summary.json`)
- **Calibration:** est-AHI vs truth-AHI (R², bias) per severity; ODI↔CVHR coupling; hypo↔HRV-collapse
  detection rate; change-point recall at interventions.
- **Distributions:** every headline metric, mean/median/percentiles per stratum (→ percentile tables).
- **Edge-case coverage matrix:** scenario × severity × age × BMI cells actually hit.
- **Failure ledger:** node threw / null / fusion mismatch / recall <80% / metric out-of-physiological-range,
  each with its seed to reproduce.
- Cross-node coherence + provenance/kernel consistency across N.

## PpgDex is the pacing item (per perf discussion)
176 Hz beat-detect + morphology dominates runtime. **Fast (default, 10k):** PPI-level PpgDex →
sub-second/patient → 10k in minutes. **Full (≤500 cert lane):** real waveform analysis. Runner records
per-node wall-time so the **1k pilot measures the true cost** before scaling (don't guess).

## Build order
1. **Pilot:** `cohort-gen.js` + `cohort-runner.html` (single-thread, 1k, Fast) → first `summary.json` +
   measured per-node timing.
2. Add Web-Worker pool + IndexedDB resume; rerun 1k to confirm scaling.
3. Scale to **10k Fast**; add **500 Full** PpgDex/morphology lane.
4. Freeze seeds → reproducible corpus + `COHORT-VALIDATION-README.md` (honest README badge).

## Open decisions (confirm at kickoff)
1. v1 scale: **1k pilot → 10k** (bigger only after pilot timing). 
2. Nights/patient: fixed 5 vs **variable 1–12** (lean variable, better for longitudinal/change-point).
3. Output: `summary.json` + a random 200-patient `result` sample, vs full `results.jsonl` sharded to
   ≤19 MB parts (reuse `ECG Splitter.html`) for failure auditing.

## Status carried in from the prior session (all on disk, done)
- Provenance bug fixed: `ganglior-provenance.js` now hooks `Blob.text/arrayBuffer`; ECGDex worker calls
  `noteInput`. Re-bundled PpgDex/PulseDex/ECGDex. (Other 5 use FileReader → unaffected.)
- ECGDex `qtcTrend` now flags `unstable:true` windows (>60 ms from trend median = delineation artifact).
- `ECG Splitter.html` exists (splits large ECG/PPG into ≤19 MB line-aligned parts).
- Test gate `Dex-Test-Suite.html` = 425 green; `verify-provenance.html` = no mismatches.

---

## DSP I/O CONTRACT (verified — the cold-start map)

Each `*-dsp.js` documents its global in its header comment; confirm names there. The headless pipeline
per node is **generate native-format text → parse → analyze → assemble a MINIMAL `ganglior.node-export`**
(the Integrator's `adaptEnvelopeNode`/`adaptOxyDex` in `integrator-dsp.js` is the authoritative list of
fields it actually reads — build only those). Globals confirmed present: `OXYDSP, ECGDSP, PPGDSP (+PPGMorph),
GLUDSP, PULSEDSP, CpapDsp (+CpapFusion), IntegratorDSP, CrossNightEnvelope, DexKernel, GangliorProvenance`.

| Node | Parse → analyze (headless) | Input it needs | Export envelope |
|---|---|---|---|
| **OxyDex** | `OXYDSP.parseCSV(text,meta)` → night/processNight flow | O2Ring CSV text (synth-gen `renderOxy`) | array-of-nights summary (see `adaptOxyDex`) |
| **ECGDex** | `ECGDSP.analyze({int16,fs,t0Ms,deviceRR,deviceACC})` | **raw int16 ECG µV** ⚠ | minimal: `recording.{startEpochMs,durationMin}`, `hrv.time.{rmssd,sdnn,lfhf,wholeRecordSDNN,wholeRecordRMSSD}`, `ganglior_events:r.events`, `apnea`, `sleep.stageMinutes`, `kernel` |
| **PulseDex** | `PULSEDSP.parseRRInput(text)` → analyze | RR text (REUSE ECG's RR series — built-in cross-check) | `recording.durationMin`, `ganglior_events`, `hrv.time.{rmssd,sdnn}` |
| **PpgDex** | `PPGDSP.parsePPG(text)` → `analyze(rec)` (+`PPGMorph`) | 176 Hz PPG text ⚠ **SLOW** | minimal HRV envelope |
| **GlucoDex** | `GLUDSP.parseCSV(text)` → `analyze(parsed,prog,opts)` | CGM CSV (continuous across nights) | timeseries cells + fusion |
| **HRVDex** | `hrvdex parseCSV(text)` → daily rows | Welltory CSV (derive row from night RR) | daily array |
| **CPAPDex** | `CpapDsp._synthEdfSet(opts)` → `buildSessionFromEdf(set,meta)` → `buildNight([sess])` → **`CpapFusion.cpapBuildExport(night)`** | EDF-shaped `set` ⚠ (NOT raw bytes) | `cpapBuildExport` returns it **headless** ✅ |

**Integrator step:** per patient collect each node's minimal export JSON → `IntegratorDSP.normalizeFile(json,name)`
per node → `runFusion(recs, {toleranceSec:120})` → score findings vs `ground_truth`.

## KNOWN HARD PARTS (don't rediscover — design these first)
1. **ECGDex wants raw int16 ECG, not RR.** synth-gen produces RR text. The RR→PQRST-µV-waveform renderer
   lives *inside* `ECGDSP.genSynthetic` ("renders PQRST morphology into a µV Int16Array" from a ground-truth
   RR). Factor it out (or add a `genSynthetic({rr, events})` option) so you can render an ECG from the
   master-timeline RR and keep events coherent. Easiest alternative for a pilot: drive ECGDex with
   `genSynthetic({scenario})` and treat its *own* ground-truth RR as the timeline for the RR-nodes — but then
   cross-node event coherence with Oxy/PPG is looser. Decide explicitly.
2. **Most export envelopes are app-layer (DOM).** `ecgdex-app.buildV2`, `ppgdex-app.buildV2`,
   `pulsedex-app.exportGanglior` need DOM. The runner must **replicate the minimal envelope** from the DSP
   result (only the fields in the table above). **CPAPDex is the exception** — `CpapFusion.cpapBuildExport`
   is headless; use it directly.
3. **CPAP synthetic input.** `_synthEdfSet(opts)` is test-shaped (`{oxi,squeeze,cs}`), not AHI-parameterized.
   Extend it to accept an event list / AHI target, OR build an EDF-shaped `set` (channels MaskPress/Press/
   Leak/SpO2 + EVE annotations) matching `readEDF()`'s output shape. synth-gen has **no** CPAP renderer yet.
4. **PpgDex 176 Hz is the runtime driver.** Fast mode (PPI-level, skip waveform) is the default for 10k;
   Full mode (real `PPGDSP.analyze` on a ~9-min window) is a ≤500-patient lane. Measure both in the pilot.

## PILOT SCOPE (do this first, smallest end-to-end loop)
Start with the **easy nodes only** to prove the loop + measure timing: **OxyDex + PulseDex + GlucoDex +
HRVDex + Integrator** (all parse-text→analyze→minimal-envelope, no waveform). Add **CPAPDex** (headless
export) next. Add **ECGDex** (needs the RR→ECG renderer) and **PpgDex Full** last. 1k patients, single
thread, Fast → first `summary.json` + per-node wall-time. THEN parallelize + scale.
