<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-06

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
1. Document the **worker-DSP shim + importScripts pattern** as a shared snippet + a note in `CONTRIBUTING.md` /
   `ARCHITECTURE-PRINCIPLES.md` (§7 forward-adopt).
2. Add the two **capture-provenance facts** to `CLAUDE.md` §🎙️.
3. Evaluate the **decorrelation gate** for the Integrator TCH consumer (own brief — it re-bundles).
4. Offer folder-batch mode in `ECG Splitter.html` / cohort tools using patterns 1–2.

## Gate / lifecycle
Patterns 1–2, 4-doc are test/doc/tool only (no re-bundle). Pattern 4-Integrator + any DSP edit re-bundle per
`CLAUDE.md` §🔏. Flip items as landed; spawn follow-ups per house rule.
