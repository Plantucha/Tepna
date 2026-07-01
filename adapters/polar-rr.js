/*
 * adapters/polar-rr.js — Tepna vendor adapter: Polar RR/PPI → SignalFrame(rr)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Polar H10 chest strap + Verity Sense armband, captured with the Polar Sensor
 * Logger Android app (com.j_ware.polarsensorlogger): per-stream CSV/TXT with an
 * `RR-interval [ms]` (or `PP-interval`) column and an ISO/clock timestamp column
 * (see CLAUDE.md §Capture provenance + how-to-collect/). This adapter REFERENCES
 * PulseDex's pure bare-global `parseRRInput` (loaded in isolation by the caller
 * and handed in via ctx.parseRRInput) — it never copies the parser. Same signal,
 * many vendors: coospo-rr.js wraps the SAME parseRRInput with a different detect.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'Polar (Polar Sensor Logger)';
  var DEVICE = 'H10 / Verity Sense';

  REG.registerAdapter({
    id: 'polar-rr',
    signalType: 'rr',
    vendor: VENDOR,
    device: DEVICE,
    // cheap, side-effect-free: filename signature first, header signature as fallback.
    detect: function (file, headText) {
      var name = (file && file.name || '') + '';
      if (/_RR\b|_PPI\b|RR\.txt$|PPI\.txt$/i.test(name) && /polar|psl|verity|h10/i.test(name + ' ' + (headText || '')))
        return 0.97;
      if (/_RR\b|_PPI\b/i.test(name)) return 0.8;                          // PSL default per-stream naming
      if (/RR-?interval|PP-?interval|Phone timestamp|sensor timestamp/i.test(headText || '')) return 0.6;
      return 0;
    },
    // REFERENCE the existing pure parser — never copy it.
    parse: function (text, ctx) {
      ctx = ctx || {};
      var parseRR = ctx.parseRRInput || (typeof root.parseRRInput === 'function' ? root.parseRRInput : null);
      if (!parseRR) return root.SignalFrame.toSignalFrame('rr', { usable: false, reason: 'polar-rr: no parseRRInput in scope (load PulseDex DSP in isolation)' }, { adapter: 'polar-rr', vendor: VENDOR, device: DEVICE });
      var raw = parseRR(text);
      return root.SignalFrame.toSignalFrame('rr', raw, {
        adapter: 'polar-rr', vendor: VENDOR, device: DEVICE,
        files: ctx.files || null, warnings: []
      });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
