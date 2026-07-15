/*
 * dex-contracts.js — Tepna machine-checked contracts (CORE, types-only)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * SIGNAL-ADAPTER-AND-FRONTIER brief · Phase 4a — "types without a build."
 *
 * The cross-layer data shapes declared ONCE, as JSDoc @typedefs, so a coder
 * (human or AI) has a precise, machine-checkable target. Checked CI-only by
 * `tsc --noEmit --checkJs -p tsconfig.json` (see .github/workflows/types.yml) —
 * NO emit, NO shipped build, NO CDN, NO runtime dep. The single-file / offline /
 * system-font invariant (CLAUDE.md, brief §5.3) is untouched: TypeScript is a
 * dev-time CI tool only and ships nothing into any bundle.
 *
 * This file is a plain global SCRIPT (no top-level import/export) so its
 * @typedefs are visible to the other DOM-free CORE scripts under one program.
 * The `SignalFrame` / `SignalFrameProvenance` typedefs live with their code in
 * signal-frame.js (the schema authority `validateFrame` enforces at runtime);
 * this file declares the contracts that have no single owning module:
 *   · GangliorEvent / GangliorNodeExport — the frozen cross-node currency
 *     (CLAUDE.md §Export contract; schema.name "ganglior.node-export").
 *   · AdapterSpec / DetectMatch / RouteResult — the vendor-adapter registry
 *     entry + routing results (signal-adapters.js).
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * One impulse on the Ganglior bus. `t` is a wall-clock string with NO date
 * (consumers reconstruct absolute tMs from recording.startEpochMs's date + t,
 * rolling past midnight); new emitters SHOULD additionally write absolute
 * floating `tMs`. See CLAUDE.md §6 (Export contract).
 * @typedef {Object} GangliorEvent
 * @property {string}            t        wall-clock "HH:MM:SS" (no date)
 * @property {number} [tMs]               absolute floating wall-clock ms (Clock Contract; new emitters)
 * @property {string}            impulse  event kind (e.g. "hrv_drop", "autonomic_surge")
 * @property {string}            node     producing node name (e.g. "PulseDex")
 * @property {number}            conf     0..1 confidence (a SEPARATE axis from sqi)
 * @property {Object} [meta]              node-specific detail bag
 */

/**
 * A node's analysis result on the frozen cross-node seam. The Integrator (and
 * the `fascia` back-compat alias) consume exactly this; nodes never import each
 * other. Sub-objects are intentionally loose ([key:string] bags) — each node
 * fills the blocks it owns and a missing value is `null`, never fabricated.
 * @typedef {Object} GangliorNodeExport
 * @property {{ version:string, hash:string }|null} kernel  DexKernel stamp at export time
 * @property {GangliorExportSchema}     schema       schema descriptor (name is FROZEN)
 * @property {GangliorRecording}        recording    recording-level anchors (floating ms)
 * @property {Object} [hrv]                          time/frequency HRV block, when the node computes it
 * @property {Object} [apnea]                        apnea/CVHR block, when applicable
 * @property {Object} [cardiorespiratory]
 * @property {Object} [personalization]
 * @property {GangliorEvent[]}          ganglior_events  impulses, sorted by tMs
 * @property {Object} [reserved]                     forward-compat placeholders (null until available)
 */

/**
 * @typedef {Object} GangliorExportSchema
 * @property {"ganglior.node-export"} name   FROZEN schema name (CLAUDE.md)
 * @property {string}  version                schema version (e.g. "2.0")
 * @property {string}  node                   node name
 * @property {string} [nodeVersion]
 * @property {string} [bus]                   "ganglior"
 * @property {string} [generated]             ISO timestamp of export
 * @property {Object} [ingest]                adapter/vendor/device provenance, when ingested via an adapter
 * @property {string} [doc]
 */

/**
 * @typedef {Object} GangliorRecording
 * @property {number|null}  startEpochMs   floating wall-clock ms of first valid sample (t0Ms); null = unknown
 * @property {number|null} [offsetMin]     minutes east of UTC, or null (no zone in source)
 * @property {number|null} [durationMin]
 * @property {number}      [beats]
 * @property {string}      [source]
 * @property {number|null} [coveragePct]
 */

/**
 * A registered vendor adapter (brief §2.4). detect() is cheap + side-effect-free
 * and returns a CONFIDENCE 0..1 (NOT a boolean) so the unifier routes to the
 * highest-confidence adapter and surfaces ties. parse() REFERENCES an existing
 * pure node parser (never copies it) and wraps the result via
 * SignalFrame.toSignalFrame → a SignalFrame.
 * @typedef {Object} AdapterSpec
 * @property {string}  id                       unique adapter id (e.g. "polar-rr")
 * @property {string}  signalType               a SignalSpec key ("rr"|"ecg"|"spo2"|"cgm"|"eeg"|"flow"|"hr"|"acc")
 * @property {string} [vendor]                  human vendor/app name
 * @property {string} [device]                  device model
 * @property {(file: { name?: string }, headText: string) => number} detect  confidence 0..1
 * @property {(text: string, ctx?: Object) => SignalFrame}           parse   text → normalized frame
 */

/**
 * One adapter match from detectAdapters(), confidence-clamped to 0..1.
 * @typedef {Object} DetectMatch
 * @property {string}      id
 * @property {AdapterSpec} adapter
 * @property {string}      signalType
 * @property {string} [vendor]
 * @property {number}      confidence   0..1
 */

/**
 * The single best route for a file, with the runner-up so callers can flag
 * ambiguity (close confidences) instead of silently picking, and `unknown`
 * when nothing detected (set aside, never guessed).
 * @typedef {Object} RouteResult
 * @property {DetectMatch|null}  best
 * @property {DetectMatch[]}     candidates
 * @property {DetectMatch|null} [runnerUp]
 * @property {boolean}           ambiguous
 * @property {boolean}           unknown
 */

(function (root) {
  'use strict';
  // Inert runtime marker — the contracts above are the payload. No module.exports
  // (keeps this a global SCRIPT so the @typedefs are program-global for checkJs).
  root.DexContracts = { version: '1.0', doc: 'JSDoc contract typedefs; checked CI-only via tsc --checkJs.' };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
