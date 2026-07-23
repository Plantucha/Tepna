// node-globals.d.ts — Tepna
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// Consolidated node ambient declarations (ESM-MIGRATION-FOLLOWUPS-II item 4). Replaces the seven
// per-node `<node>-globals.d.ts` files, which after the item-3 dependency-injection pass held only
// PERMANENT public-API surface — not the DSP→UI reach-in coupling they were originally created to
// document. That coupling is GONE (each DSP now calls injected `_ui.*` hooks), so the remaining
// declarations are exactly the two things that legitimately stay ambient `any`:
//
//   1. Each node's own DUAL-MODE namespace attach (`root.<Node> = <Node>` / `global.<NS> = …`) — the
//      external node API + every classic co-load consumer (the orchestrators, the workers, both test
//      runners, the dual-mode `export const <Node> = window.<Node>` tails). PERMANENT, not debt.
//   2. A handful of consumed co-loaded siblings (guarded reaches) + one node's own util module + two
//      window-state globals + the env globals the ES2017 checkJs lib omits.
//
// dex-globals.d.ts stays SHARED-SPINE-only (per tsconfig `//d2`); integrator-globals.d.ts stays
// (Integrator is not in the ESM fan-out). Grouped by node so a stray cross-node reach is still visible
// in review. NO runtime, NO emit, NO shipped artifact — a dev-time type artifact only. Typed `any`:
// the checkJs gate's value is each module's OWN logic, not re-typing these public namespace surfaces.

// ── HRVDex ────────────────────────────────────────────────────────────────────────────────────────
declare var HRVDex: any; // hrvdex-dsp.js — node namespace attach (`root.HRVDex`); dual-mode export tail

// ── OxyDex ────────────────────────────────────────────────────────────────────────────────────────
declare var OxyDex: any; // oxydex-dsp.js — node namespace attach (`root.OxyDex`)
declare var UP: any; // oxydex-render.js — render state/namespace
declare var safeStyle: any; // oxydex-util.js — DOM style-safety helper (node's own util dependency)
declare var safeSet: any; // oxydex-util.js — DOM text/attr-safety helper
declare var safeEl: any; // oxydex-util.js — element lookup helper
declare var escHTML: any; // oxydex-util.js — HTML escape
declare var computeCeilingBaselineArr: any; // oxydex-util.js — ceiling-baseline series helper
declare var _csvParseErrors: any; // window state — accumulated CSV parse diagnostics
declare var _oxyReview: any; // window state — self-ingest review-mode payload

// ── GlucoDex ──────────────────────────────────────────────────────────────────────────────────────
declare var GLUDSP: any; // glucodex-dsp.js — the DSP toolkit namespace (parseCSV, analyze, genSynthetic, …)
declare var GlucoDex: any; // glucodex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)

// ── CPAPDex ───────────────────────────────────────────────────────────────────────────────────────
declare var CpapDsp: any; // cpapdex-dsp.js — the DSP api namespace (compute, buildSession, …)
declare var CPAPDex: any; // cpapdex-dsp.js — the node's public compute surface (compute, buildNightFromSets, …)
declare var CpapEdf: any; // cpapdex-edf.js — optional co-loaded EDF reader (guarded reach)
declare var CPAPCross: any; // cpapdex-cross.js — optional co-loaded longitudinal cross-night block (guarded reach)
declare var CpapFusion: any; // cpapdex-fusion.js — the shared node-export builder (cpapBuildExport)

// ── ECGDex ────────────────────────────────────────────────────────────────────────────────────────
declare var ECGDSP: any; // ecgdex-dsp.js — the DSP toolkit namespace (analyze, bandpass, detectPeaks, …)
declare var ECGDex: any; // ecgdex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)
declare var ECGMorph: any; // ecgdex-morph.js — optional co-loaded morphology analyzer (guarded reach)

// ── PpgDex ────────────────────────────────────────────────────────────────────────────────────────
declare var PPGDSP: any; // ppgdex-dsp.js — the DSP toolkit namespace (parsePPG, analyze, validatePPI, …)
declare var PpgDex: any; // ppgdex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)
declare var PPGMorph: any; // ppgdex-morph.js — optional co-loaded morphology analyzer (guarded reach)

// ── PulseDex ──────────────────────────────────────────────────────────────────────────────────────
declare var PulseDex: any; // pulsedex-dsp.js — the node's public compute surface (compute, buildNodeExport, …)

// ── Env globals the ES2017 checkJs lib omits (cpapdex CLI · ppgdex ns-stamp parsing) ────────────────
declare var require: any; // cpapdex-dsp.js CLI --selftest — bare require kept for Node (call sites cast)
declare var process: any; // Node process — guarded (`typeof process !== 'undefined'`), CLI --selftest only
declare var BigInt: any; // ES2020 global — Polar ns-stamp parsing; the ES2017 gate lib omits it
