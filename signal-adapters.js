/*
 * signal-adapters.js — Tepna vendor-adapter registry (CORE, the fourth layer)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * One signal, one math, many vendors. An adapter normalizes ONE vendor format
 * → one SignalFrame; DSP only ever sees a SignalFrame of its declared type
 * (brief §2.4). A registered adapter is { id, signalType, vendor, device?,
 * detect, parse }:
 *   · detect(file, headText) → CONFIDENCE 0..1 (cheap, side-effect-free,
 *     filename + header signature). NOT a boolean — the unifier routes a file
 *     to the highest-confidence adapter and surfaces ties for the user instead
 *     of guessing silently.
 *   · parse(text, ctx) → SignalFrame — REFERENCES an existing pure node parser
 *     (never copies it) and wraps the result via SignalFrame.toSignalFrame.
 *
 * The registry is DOM-free + loadable in node:vm. Adapters self-register at
 * load by calling registerAdapter. NB the bare-global parsers (parseRRInput
 * etc.) collide if two such DSPs co-load on one page; the unifier loads each in
 * ISOLATION and passes the isolated parser into parse() via ctx.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  /** @type {AdapterSpec[]} */
  var _ADAPTERS = [];           // registration order
  /** @type {Object<string, AdapterSpec>} */
  var _BY_ID = {};

  /**
   * Register (or idempotently replace) a vendor adapter.
   * @param {AdapterSpec} spec
   * @returns {AdapterSpec}
   */
  function registerAdapter(spec) {
    if (!spec || !spec.id) throw new Error('registerAdapter: id required');
    if (!spec.signalType) throw new Error('registerAdapter: signalType required (' + spec.id + ')');
    if (typeof spec.detect !== 'function') throw new Error('registerAdapter: detect() required (' + spec.id + ')');
    if (typeof spec.parse !== 'function') throw new Error('registerAdapter: parse() required (' + spec.id + ')');
    if (_BY_ID[spec.id]) { // idempotent re-register (re-load of an adapter file) replaces in place
      var i = _ADAPTERS.indexOf(_BY_ID[spec.id]);
      if (i >= 0) _ADAPTERS.splice(i, 1, spec);
    } else {
      _ADAPTERS.push(spec);
    }
    _BY_ID[spec.id] = spec;
    return spec;
  }

  function list() { return _ADAPTERS.slice(); }
  function byId(id) { return _BY_ID[id] || null; }
  function bySignal(type) { return _ADAPTERS.filter(function (a) { return a.signalType === type; }); }

  // Run every registered detect() over (file, headText); return matches sorted
  // by confidence desc. file may be a real File or any { name } stub; headText is
  // a short prefix of the file's text (header signature). Never throws on a bad
  // detector — a thrown detect is treated as confidence 0.
  /**
   * Run every registered detect() over (file, headText); matches sorted by
   * confidence desc. Never throws on a bad detector (treated as confidence 0).
   * @param {{ name?: string }} file
   * @param {string} [headText]
   * @returns {DetectMatch[]}
   */
  function detectAdapters(file, headText) {
    var out = [];
    for (var i = 0; i < _ADAPTERS.length; i++) {
      var a = _ADAPTERS[i], c = 0;
      try { c = +a.detect(file || {}, headText || '') || 0; } catch (e) { c = 0; }
      if (c > 0) out.push({ id: a.id, adapter: a, signalType: a.signalType, vendor: a.vendor, confidence: Math.max(0, Math.min(1, c)) });
    }
    out.sort(function (x, y) { return y.confidence - x.confidence; });
    return out;
  }

  // The single best route for a file, with the runner-up so callers can flag
  // ambiguity (close confidences) instead of silently picking.
  /**
   * The single best route for a file, with the runner-up so callers can flag
   * ambiguity instead of silently picking.
   * @param {{ name?: string }} file
   * @param {string} [headText]
   * @returns {RouteResult}
   */
  function route(file, headText) {
    var d = detectAdapters(file, headText);
    if (!d.length) return { best: null, candidates: [], ambiguous: false, unknown: true };
    var best = d[0], runnerUp = d[1] || null;
    var ambiguous = !!(runnerUp && (best.confidence - runnerUp.confidence) < 0.15);
    return { best: best, candidates: d, runnerUp: runnerUp, ambiguous: ambiguous, unknown: false };
  }

  function runAdapter(adapter, text, ctx) {
    if (!adapter || typeof adapter.parse !== 'function') return null;
    return adapter.parse(text, ctx || {});
  }

  function reset() { _ADAPTERS.length = 0; _BY_ID = {}; }   // tests only

  var SignalAdapters = {
    registerAdapter: registerAdapter,
    detectAdapters: detectAdapters,
    route: route,
    runAdapter: runAdapter,
    list: list, byId: byId, bySignal: bySignal, reset: reset
  };
  root.SignalAdapters = SignalAdapters;
  if (typeof module !== 'undefined' && module.exports) module.exports = SignalAdapters;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : /** @type {any} */ (this)));
