/*
 * signal-spec.js — Tepna signal-type registry (CORE, the fourth layer)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * SignalSpec keys a canonical fact-set by SIGNAL TYPE (not device): the
 * `kind` (intervals|samples), the canonical SI/clinical-metric `unit`, the
 * SignalFrame field set a frame of that type must populate, and a lazy `dsp`
 * resolver to the node's compute entry point. Adapters emit frames conforming
 * to the spec; nodes + the unifier read field names + units FROM the spec, not
 * from memory. Plain global, DOM-free, loadable in node:vm.
 *
 * The `dsp` resolvers reference page-scope globals and are LAZY (only invoked
 * when a consumer actually computes) — namespaced nodes return their object;
 * the bare-global nodes (PulseDex/OxyDex/HRVDex) return the function(s) they
 * expose, which is exactly why those must be co-loaded in isolation (a bare
 * global collides if two such DSPs share one page — see signal-adapters.js).
 * Per CLAUDE.md §Units, every unit here is metric/SI-canonical.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  function g(name) { try { return root[name]; } catch (e) { return undefined; } }

  var SignalSpec = {
    // ── intervals (RR / PPI) ────────────────────────────────────────────────
    rr:   { kind: 'intervals', unit: 'ms',
            frameFields: ['intervals', 'tsMs', 't0Ms', 'offsetMin'],
            dsp: function () { return { parse: g('parseRRInput'), stats: g('_pdSeriesStats') }; } }, // PulseDex: bare global
    // ── sampled waveforms / traces ──────────────────────────────────────────
    ecg:  { kind: 'samples', unit: 'uV',
            frameFields: ['samples', 'fs', 't0Ms', 'offsetMin'],
            dsp: function () { return g('ECGDex') || g('ECGDSP'); } },  // ECGDex namespace (ECGDSP legacy)
    // raw optical PPG waveform (Polar Verity Sense ~176 Hz). `au` = arbitrary units
    // (uncalibrated ADC counts — no SI unit at the raw-waveform level, like ECG µV but
    // PPG carries no calibrated quantity). samples PACKS the multi-channel waveform
    // (ch[3]+amb+relSec, typed arrays — 100+ Hz, so NOT per-sample objects); fs carries
    // the rate. PpgDex.compute reconstructs the rec → beat detection → self-PPI → HRV.
    ppg:  { kind: 'samples', unit: 'au',
            frameFields: ['samples', 'fs', 't0Ms', 'offsetMin'],
            dsp: function () { return g('PpgDex') || g('PPGDSP'); } },  // PpgDex namespace (PPGDSP legacy)
    cgm:  { kind: 'samples', unit: 'mmol/L',
            frameFields: ['samples', 'tsMs', 't0Ms'],
            dsp: function () { return g('GLUDSP'); } },            // GlucoDex namespace = GLUDSP
    spo2: { kind: 'samples', unit: '%',
            frameFields: ['samples', 't0Ms'],
            dsp: function () { return { parse: g('parseCSV') }; } }, // OxyDex: bare global + DOM side-effects
    // ── pre-computed HRV SUMMARY (Welltory-style spot reads) — NOT a raw signal:
    //    each "sample" is an already-computed HRV measurement at an irregular time,
    //    so there is no fs; per-sample tsMs carries the timing (cgm-like). ──
    hrv:  { kind: 'samples', unit: 'ms',
            frameFields: ['samples', 'tsMs', 't0Ms'],
            dsp: function () { var H = g('HRVDex'); return { parse: g('parseCSV'), rows: H && H.parseRows, compute: H && H.compute }; } }, // HRVDex: bare global + DOM/localStorage commit path
    // ── NEW signal types: EEGDex / SpiroDex still need real new DSP; the
    //    adapter layer standardizes their INGEST, not the per-signal math. ──
    eeg:  { kind: 'samples', unit: 'uV',
            frameFields: ['samples', 'fs', 't0Ms', 'offsetMin'],
            dsp: function () { return g('EEGDSP'); } },
    flow: { kind: 'samples', unit: 'L/s',
            frameFields: ['samples', 'fs', 't0Ms'],
            dsp: function () { return g('SPIRODSP'); } },
    // ── CPAP / PAP therapy (ResMed AirSense EDF set) — SIGNAL-ADAPTER-PHASE9 node 4/4.
    //    The canonical sample payload is the 25 Hz BRP FLOW waveform (`au`/L/s); the
    //    device-scored EVE/CSL events (the node's headline `measured` value) + the rest
    //    of the decoded multi-signal set ride as a `edfSets` SIDECAR on the frame (no
    //    event carrier exists on a SignalFrame — GENERIC-EMIT-GATE-FOLLOWUPS-I §1).
    //    CPAPDex.compute reconstructs the night → CpapFusion.cpapBuildExport. EDF is
    //    BINARY + multi-file, so there is no TEXT-stream adapter — but cpap is no longer
    //    adapter-less: `adapters/resmed-edf.js` (CPAP-REAL-CORPUS §P3) registers for it and
    //    takes its bytes off the ctx escape hatch (`ctx.buffers` / `ctx.edfSets`), ignoring
    //    the `text` arg — the same hatch oxydex-spo2 uses for ctx.parseCSV. It carries the
    //    SD-card session-grouping rule (§F4). The CPAPDex app still owns its own binary
    //    ingest; cpap remains emittable via SignalOrchestrate.canEmit + the generic-gate
    //    provider, and is now ALSO reachable through the DRIVER-1 adapter registry. ──
    cpap: { kind: 'samples', unit: 'L/s',
            frameFields: ['samples', 'fs', 't0Ms'],
            dsp: function () { return g('CPAPDex'); } },  // CPAPDex namespace (CpapDsp legacy)
    // ── auxiliary channels ──────────────────────────────────────────────────
    hr:   { kind: 'samples', unit: 'bpm',
            frameFields: ['samples', 'tsMs', 't0Ms'],
            dsp: function () { return undefined; } },
    acc:  { kind: 'samples', unit: 'g',
            frameFields: ['samples', 'fs', 't0Ms'],
            dsp: function () { return undefined; } }
  };

  // Convenience: the set of known signal types + a unit lookup the unifier reads.
  SignalSpec.types = function () { return Object.keys(SignalSpec).filter(function (k) { return typeof SignalSpec[k] === 'object'; }); };
  SignalSpec.unitOf = function (type) { var s = SignalSpec[type]; return s && typeof s === 'object' ? s.unit : null; };
  SignalSpec.kindOf = function (type) { var s = SignalSpec[type]; return s && typeof s === 'object' ? s.kind : null; };

  root.SignalSpec = SignalSpec;
  if (typeof module !== 'undefined' && module.exports) module.exports = SignalSpec;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : /** @type {any} */ (this)));
