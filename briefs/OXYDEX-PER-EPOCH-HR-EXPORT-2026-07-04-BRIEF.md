<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-04 · **Created:** 2026-07-04 · **Parent:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-2026-07-03-BRIEF.md` §2 (the named upstream prerequisite) · **Unblocks:** Integrator HR-hat (§2) + external-ρ (§1)

# OxyDex per-epoch HR + motion export (the TCH HR-hat's 3rd corner)

> **One-line:** OxyDex now emits a TOP-LEVEL `timeseries.epochs[]` of `{tMin, hr, motionIndex}` on a
> 5-min grid, giving the Integrator's HR three-cornered-hat (ECG+PPG+**Oxy**) its 3rd series-bearing
> node AND a 2nd per-epoch motion series for the correlated-TCH ρ. Spun out of — and executed alongside
> — the Integrator TCH follow-ups §2, per that brief's scope guard ("do it as an OxyDex brief").

## What shipped
- **`oxydex-dsp.js`** — `oxyBuildEpochSeries(rows, t0Ms)` bins the cleaned 1 Hz rows into 5-min epochs
  (`hr` = MEDIAN pulse-HR, `motionIndex` = MEAN O2Ring motion count; epochs with <60 s HR coverage are
  dropped), stashed on `night.tchEpochs` in `processNight`. `oxyBuildTimeseriesBlock(nights)` wraps it as
  the top-level `timeseries` block (single-recording only — multi-night uses the crossNight longitudinal
  path). `tMin` is node-relative (from `t0Ms`), matching the ECG/PpgDex `epochs[]` grid so the
  Integrator's `alignTriplet` lines them up. Exposed as `OxyDex.buildTimeseriesBlock` / `.buildEpochSeries`.
- **Emit (both paths, no drift)** — `OxyDex.compute` (headless `oxyComputeNight`) and the app `exportJSON`
  envelope each add `timeseries` as a sibling to `nights[]` / `ganglior_events[]`, exactly where
  `adaptEnvelopeNode` reads `json.timeseries.epochs[].{hr,motionIndex}`.

## Why it is EXPORT-INERT for the committed OxyDex fixtures
The two code-gated OxyDex fixtures (`OxyDex_2026-06-13_1056_summary.json`, `…_0439`) ARE the `nights[]`
array, and `env.equiv.oxydex` diffs `nights[0]`. `timeseries` is a TOP-LEVEL envelope sibling (outside
`nights[0]`), so `nights[0]` stays byte-identical — the same pattern as the top-level `ganglior_events`
add (OXYDEX-NODE-EXPORT-ENVELOPE). ⇒ **manifestHash re-record only, no fixture regeneration.**

## Gates — DONE 2026-07-04
- OxyDex re-bundled `7fbedea9a12f → 4d3b2194d942` (owned plain-inline build via `tools/build-core.js`).
- `BUILD-MANIFEST.json` GATE A updated; both `FIXTURE-PROVENANCE.json` OxyDex fixtures' `manifestHash`
  re-recorded (`outputHash` + `inputHashes` UNCHANGED — export-inert).
- `Dex-Test-Suite.html` headless floor green (`env.equiv.oxydex` byte-identical confirms the inertness);
  `verify-provenance.html` GATE A/B clean (8/8 bundles).

## Consumer (lands in the parent brief, not here)
The Integrator HR-hat + ρ-from-motion consumer (`integrator-dsp.js` `_tchHat` / `_tchRhoFromMotion` /
`fuseHRVConsensus`) + its known-answer test group are tracked in
`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-2026-07-03-BRIEF.md` §1/§2.
