/*
 * adapters/coospo-rr.js — Tepna vendor adapter: Coospo RR → SignalFrame(rr)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Coospo HW9 / H808S chest strap — same RR-interval signal as the Polar H10.
 * THIS FILE IS THE PROOF of the adapter thesis (brief §0/§2.4, Phase 1): a new
 * vendor for a signal we already analyze is ONE new file that differs from
 * polar-rr.js ONLY in `detect`. It wraps the SAME pure `parseRRInput` — if
 * PulseDex fixes a parse bug, Coospo inherits it for free; no node was edited.
 *
 * Coospo's companion app exports RR intervals as CSV with an `RR(ms)` / `RRI`
 * column; some firmware stamps `MM/DD/YYYY HH:MM:SS` (MDY) — parseRRInput's
 * Clock-Contract timestamp resolution + preferDMY handling covers it. If a
 * future Coospo firmware uses a format parseRRInput doesn't know, normalize it
 * HERE (to ISO-8601, or compute tMs per the Clock Contract) BEFORE handing text
 * down — never add a regex to the node's parseTimestamp (that would edit a node
 * + re-fragment the format bank we are centralizing).
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return;

  var VENDOR = 'Coospo';
  var DEVICE = 'HW9 / H808S';

  REG.registerAdapter({
    id: 'coospo-rr',
    signalType: 'rr',
    vendor: VENDOR,
    device: DEVICE,
    detect: function (file, headText) {
      var name = (file && file.name || '') + '';
      var head = (headText || '') + '';
      if (/coospo|hw9|h808/i.test(name + ' ' + head)) return 0.95;          // explicit vendor mark
      if (/\bRRI?\b|RR\(ms\)|RR_?Interval/i.test(head) && /coospo|hw9|h808/i.test(head)) return 0.8;
      return 0;
    },
    parse: function (text, ctx) {
      ctx = ctx || {};
      var parseRR = ctx.parseRRInput || (typeof root.parseRRInput === 'function' ? root.parseRRInput : null);
      if (!parseRR) return root.SignalFrame.toSignalFrame('rr', { usable: false, reason: 'coospo-rr: no parseRRInput in scope (load PulseDex DSP in isolation)' }, { adapter: 'coospo-rr', vendor: VENDOR, device: DEVICE });
      // Coospo firmware tends to stamp MDY; let the shared parser resolve via preferDMY:false.
      var raw = parseRR(text);
      return root.SignalFrame.toSignalFrame('rr', raw, {
        adapter: 'coospo-rr', vendor: VENDOR, device: DEVICE,
        files: ctx.files || null, warnings: []
      });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
