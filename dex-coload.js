/*
 * dex-coload.js — Tepna co-load manifest (the single ordered source of truth)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE canonical list of the vendor ADAPTERS and namespaced-DSP modules that
 * every signal-orchestrate host realm must co-load so emitNodeExport() has a
 * registered adapter + a compute() host for each signalType. Until the PpgDex
 * leg this list was hand-synced across SIX sites — Data Unifier.html, OverDex.html,
 * Dex-Test-Suite.html, tests/run-tests.mjs, tsconfig.json (+ the adapters self-
 * register) — and "one miss silently drops a node from a surface" (-IV §5 /
 * PPGDEX-FOLLOWUPS §5). This module makes the set EXPLICIT + greppable, and the
 * `dex-coload manifest` gate in tests/dex-tests.js asserts (a) it stays in lock-
 * step with what SignalAdapters actually registers, and (b) every host realm
 * still co-loads every module — so a future add that misses a host is a RED,
 * not a silent drop. (The hosts still carry static <script> tags for robust
 * load ordering; this manifest is the source of truth they are gated against.
 * A later pass MAY have the hosts generate their tags from it — see
 * ECGDEX-FOLLOWUPS.)
 *
 * Adapter id convention (relied on by the gate): the registered adapter id ===
 * the file basename without `.js` (polar-rr.js → 'polar-rr', …). Keep it so.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var DEX_COLOAD = {
    // shared pre-DSP modules (load FIRST — delegating DSPs alias DexClock at load; A5 2026-07-03).
    shared: [
      'clock.js'
    ],
    // vendor adapters (self-register on load; order = registration order, drift-bait).
    // Load AFTER signal-adapters.js; the parser they wrap is resolved lazily in parse(),
    // so they may load before the DSP (mirrors the existing host ordering).
    adapters: [
      'adapters/polar-rr.js',
      'adapters/coospo-rr.js',
      'adapters/wahoo-rr.js',
      'adapters/oxydex-spo2.js',
      'adapters/welltory-summary.js',
      'adapters/libre-cgm.js',
      'adapters/polar-sense-ppg.js',
      'adapters/polar-h10-ecg.js',
      'adapters/resmed-edf.js'
    ],
    // namespaced node DSPs (each hangs its public surface off ONE global —
    // PulseDex/OxyDex/HRVDex/GlucoDex/PpgDex/ECGDex — and leaks nothing bare under
    // __DEX_NAMESPACED__). signal-orchestrate.js resolves these by name.
    dsps: [
      'pulsedex-dsp.js',
      'oxydex-dsp.js',
      'hrvdex-dsp.js',
      'glucodex-dsp.js',
      'ppgdex-dsp.js',
      'ecgdex-dsp.js'
    ],
    // ── per-node AUXILIARY modules every app bundle ships but that are NOT routable DSPs/adapters
    //    (CROSS-MODULE-RUNTIME-COVERAGE §1/§2). These fell OUTSIDE the adapters+dsps manifest, so
    //    nothing asserted they were even runtime-LOADED in the suite — exactly how cpapdex-cross.js
    //    shipped in CPAPDex.html yet ran in NEITHER runner (the -III discovery). Each entry pins the
    //    file → the global it MUST hang off `window`/`env` once co-loaded, so the conformance gate can
    //    assert runtime-presence in BOTH runners (closes the symmetry gap, §3) instead of inferring
    //    correctness from ECGCross + the P12 source-byte gate. (DOM-only `*-render.js`/`*-app.js`,
    //    `*-edf.js`, `*-fusion.js` are deliberately NOT here — they need a booted app / are covered
    //    by the render-coverage rigs + CpapEdf.selfTest + the equivalence goldens.)
    nodeModules: [
      { file: 'clock.js',           global: 'DexClock' },
      { file: 'ecgdex-cross.js',    global: 'ECGCross' },
      { file: 'oxydex-cross.js',    global: 'OXYCross' },
      { file: 'pulsedex-cross.js',  global: 'PulseCross' },
      { file: 'ppgdex-cross.js',    global: 'PPGCross' },
      { file: 'cpapdex-cross.js',   global: 'CPAPCross' },
      { file: 'cpapdex-coimport.js', global: 'CpapCoimport' }
    ]
  };

  // basename(path) === the registered adapter id, by convention (see header).
  DEX_COLOAD.adapterIds = DEX_COLOAD.adapters.map(function (p) { return p.replace(/^adapters\//, '').replace(/\.js$/, ''); });
  // every module a host realm must contain (set membership the conformance gate checks).
  DEX_COLOAD.all = DEX_COLOAD.shared.concat(DEX_COLOAD.adapters).concat(DEX_COLOAD.dsps);
  // the global each nodeModule must expose once runtime-co-loaded (CROSS-MODULE-RUNTIME-COVERAGE §1/§2).
  DEX_COLOAD.nodeModuleGlobals = DEX_COLOAD.nodeModules.map(function (m) { return m.global; });

  /** @type {any} */ (root).DexCoload = DEX_COLOAD;
  if (typeof module !== 'undefined' && module.exports) module.exports = DEX_COLOAD;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
