<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-07 (all four Do items executed. §Do 1 + §Do 2 — doc-only, no re-bundle: §Do 2 the two capture-provenance facts [Verity `_HR.txt` all-zero / H10 `_HR.txt` smoothed → derive HR from raw waveform; the real O2Ring+H10 `H10-01`+Verity `VERITY-01` corpus] added to `CLAUDE.md` §🎙️; §Do 1 the worker-DSP shim + `importScripts` pattern documented as a code snippet in `CONTRIBUTING.md` §5.5 + a forward-adopt note in `ARCHITECTURE-PRINCIPLES.md` §1 DSP. §Do 3 [Integrator TCH **decorrelation quality gate**] EXECUTED & gated 2026-07-06/07: `integrator-tch.js` `screenTriplet`/`pearson` → 1.2.0, `integrator-dsp.js` `_tchHat` drops a node decorrelated from both peers before the solve, new `dex-tests.js` group [8 assertions], Integrator re-bundled `f19fde9a7913→24ebb7156ca8` [EXPORT-INERT — golden byte-identical], `Dex-Test-Suite.html?full` all-green [2125 passed, 138 groups], `verify-provenance` GATE A/B green, changeset `changes/2026-07-07-integrator-tch-decorrelation-gate.md`. **§Do 4 [folder-batch mode in `ECG Splitter`] EXECUTED this session:** `ECG Splitter.html` gained a folder-batch mode reusing pattern 2 (recursive folder ingest → `classify`/`nightKeyOf` night grouping, pre-noon → prior evening) + pattern 1 (a Blob-URL Web Worker with the `self.window=self` shim + `importScripts(kernel-constants,clock,ecgdex-dsp,ppgdex-dsp)` running the REAL Pan–Tompkins / 3-LED-consensus detectors off-thread for a per-file HR/coverage signal check) + a bulk "split all oversized" over the night set. All inline (worker minted from a Blob URL → no new files → no docs-ledger churn); verified on the committed real corpus (H10 ECG → 57 bpm/130 Hz, Verity PPG → 106 bpm/176 Hz). Standalone tool — not a bundle, no re-bundle/provenance; changeset `changes/2026-07-07-ecg-splitter-folder-batch.md` [minor]. Cohort runners already use a worker pool (`cohort-worker.js`) so the folder-ingest gap was ECG Splitter's; the wider improvement map below is the forward agenda and §Do 3's render-chip follow-up stays open for a fresh thread.) · **Created:** 2026-07-06

# Apply the trio-experiment learnings — reusable data, processes & patterns

> **One-line:** the real tri-device σ experiment (`sensor-trio-power-analysis.html` +
> `sigma-no-reference-analysis.html` + `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md`) produced
> reusable engineering patterns and capture facts. This brief records where to apply them so they don't stay
> siloed in two analysis tools.

## Reusable engineering patterns (proven working, in `sensor-trio-worker.js`)
1. **Production `*-dsp.js` in a Web Worker.** `self.window = self` shim BEFORE `importScripts('kernel-constants.js',
   'clock.js', 'ppgdex-dsp.js', 'ecgdex-dsp.js')` — the DSP IIFE wrappers reference `window` at load; a worker
   has none. This runs PPGDSP (3-LED consensus → Malik `correctRR`) and ECGDSP (Pan–Tompkins `parseECG →
   bandpass → detectPeaks`) fully headless, off the UI thread. **Apply:** any tool wanting real detectors off
   the main thread — ECG Splitter batch mode, cohort runners, future node analysis tools.
2. **Folder ingestion → contemporaneous night pairing.** `classify()` (regex device+kind+stamp) → `nightKeyOf()`
   (pre-noon folds to prior evening) → `resolveTriple()` (pick the session whose start is NEAREST the O2Ring
   anchor, not max-size-per-role — avoids pairing an evening strap with a 3am fragment). **Apply:** OverDex /
   Data Unifier real-folder ingest; any multi-device night matcher.
3. **Per-second HR from raw waveform + robustness.** SQI/clean-flag gate + Malik ectopy rejection + ±2 s
   rolling-median spike cleanup; best channel by band-passed SNR (not most beats — noise makes the most beats).
   **Apply:** any per-second HR derivation feeding a comparison.
4. **Honest quality gate.** Exclude a night whose derived σ is implausibly large AND decorrelates from the
   other corners (failed extraction / lost contact) — surfaced as a reason, never hidden. **Apply:** the
   Integrator's `_tchHat`/`fuseHRVConsensus` could drop a decorrelated node from the hat (real robustness win —
   this one edits `integrator-dsp.js`, so it rides an on-touch re-bundle, per `CLAUDE.md` §🔏).
5. **Byte-weighted parallel progress/ETA.** Cost ∝ waveform bytes, not night count → smooth ETA across a
   worker pool. **Apply:** any long parallel batch UI.

## Capture-provenance facts → `CLAUDE.md` §🎙️ / ingest docs
- Verity Sense onboard `_HR.txt` is **all-zero** and `_PPI.txt` often header-only — HR MUST be derived from
  raw `_PPG.txt` (PPGDSP). The H10 device `_HR.txt` is smoothed; the **raw-ECG Pan–Tompkins** HR is the honest
  H10 leg (device HR under-states σ via a quiet-order artifact).
- A real **tri-device corpus** exists (O2Ring + H10 `H10-01` + Verity `VERITY-01`, 2026-06-10 → 07-05, 20
  eligible nights, ~10 clean-Verity).

## Data findings (real, single subject) — for papers / validation
- Quiet-sensor-order regime confirmed (H10↔O2 r≈0.85–0.92 → the quieter σ goes negative on some nights).
- Motion drives cross-device HR divergence (accel co-variation r≈0.44; still 0.24 → motion 1.39 bpm).

## Do (in priority order)
1. **DONE 2026-07-07.** Documented the **worker-DSP shim + `importScripts` pattern** as a code snippet in
   `CONTRIBUTING.md` §5.5 (window→self shim before `importScripts`, co-load order, feature-detect, where to
   apply) + a forward-adopt note in `ARCHITECTURE-PRINCIPLES.md` §1 DSP tying it to the DSP-purity rule. Doc-only.
2. **DONE 2026-07-07.** Added the two **capture-provenance facts** to `CLAUDE.md` §🎙️ — the per-file honest-HR
   rule (Verity `_HR.txt` all-zero/`_PPI.txt` header-only → derive from raw `_PPG.txt`; H10 `_HR.txt` smoothed →
   raw-ECG Pan–Tompkins is the honest H10 leg) and the real tri-device corpus (devices `H10-01`/`VERITY-01`,
   2026-06-10→07-05, 20 nights). Doc-only.
3. **DONE 2026-07-07.** Decorrelation gate landed in the Integrator TCH consumer (see header). Its own
   re-bundle + provenance re-record are complete; `block.tchStatus` now surfaces `decorrelated node dropped — …`
   and `_tchHat` returns `{dropped, keptPair, corr}` instead of a poisoned 3-way σ. **Follow-up left for a fresh
   thread:** surface the dropped-node reason in `integrator-render.js` (a “node X dropped: lost contact” chip on
   the σ-bar card) — render-only, rides an on-touch re-bundle.
4. **DONE 2026-07-07.** Folder-batch mode landed in `ECG Splitter.html` (patterns 1–2): drop a capture
   folder → recursive `collectEntries` ingest → `classify`/`nightKeyOf` night grouping (pre-noon folds to the
   prior evening) → per-night file list with bulk "split all oversized" ECG/PPG waveforms, plus a per-file
   **signal check** that runs the production ECGDSP/PPGDSP detectors (Pan–Tompkins · 3-LED consensus) in a
   Blob-URL Web Worker via the `self.window=self` shim + `importScripts` — off the main thread, sampling the
   first ~6 MB so it's fast on multi-GB files. All inline (no new files). Verified on the committed real corpus.
   Cohort runners already use a worker pool (`cohort-worker.js`), so the folder-ingest gap this closed was ECG
   Splitter's; a `__batchIngest` test hook (house style) is exposed for headless drive.

## Full improvement map — paper/analysis techniques that belong in the Dexes (for the next coder)
> Captured 2026-07-07 so the mapping from findings → shipped detector features doesn't stay siloed. Some are
> already done (listed for context so they're not re-attempted); the rest are the forward agenda.

**Already productionized (finding → detector — do NOT redo):**
- **Three-cornered hat → Integrator** (`integrator-tch.js` + `_tchHat`/`fuseHRVConsensus`; TCH FU-I/II DONE,
  FU-III IN-PROGRESS). The **decorrelation gate** (§Do 3) is the newest addition.
- **p90 ceiling ODI-4 baseline** (`odi4-ahi-bias` paper) → OxyDex `oxydex-util.js` `computeCeilingBaselineArr` (v22.36).
- **Nocturnal-hypo Somogyi discriminator** (`cgm-hrv-coupling` paper) → GlucoDex `glucodex-dsp.js` `_looksLikeGenuineHypo()`.

**Open — candidate detector/fusion features (no brief yet unless noted):**
1. **Age-adjusted rMSSD residual as a screening metric** (`hrv-age-confound`: raw AUC 0.69 → age-adjusted 0.77).
   Not captured anywhere as a feature — would make a legitimate PulseDex/HRVDex output (report rMSSD *and* its
   age-expected residual). Needs a defensible age-norm table (cite), like the metric registry's other norms.
2. **Optical-HRV event-state / variance weighting in fusion** (`rmssd-equivalence` + `qrs-yield`: optical rMSSD is
   bias-inert but ~22× noisier, and yield-degraded in *both* clean & apnea on the v2.1 texture). The Integrator's
   inverse-variance TCH weights already down-weight a noisy optical arm; the missing piece is **event-state**
   weighting (trust optical HRV less inside scored apnea/low-perfusion windows) rather than by whole-window σ alone.
3. **Cross-signal plausibility as automated QC → OverDex intelligence layer** (`papers.html` backlog): encode
   coupling laws (apnea→desat→HR surge; exertion→HRV drop; glucose↔HRV shared-driver) as a forward model, run
   it backward to flag impossible combinations as artifacts / mis-routed files — QC no single-signal SQI can do.
4. **Reusable engineering patterns 1–2** (worker-DSP shim, folder-ingest night pairing) → **OverDex / Data Unifier**
   real-folder ingest + `ECG Splitter` batch mode (§Do 1/4 above).

**Real-validation front (stack-gated — tracked in `PAPERS-ROADMAP-2026-06-24-BRIEF.md`):** multi-vendor HRV
agreement (adapter Phase 1), EEG-anchored sleep-proxy validation + the **N-cornered hat** (EEGDex), longitudinal
reference-free σ drift (OverDex). `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III` §1 (real-night ρ-vs-classic A/B)
and §4 (N-cornered, EEGDex-blocked) are the open Integrator legs.


## Gate / lifecycle
Patterns 1–2, 4-doc are test/doc/tool only (no re-bundle). Pattern 4-Integrator + any DSP edit re-bundle per
`CLAUDE.md` §🔏. Flip items as landed; spawn follow-ups per house rule.
