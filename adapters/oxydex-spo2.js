/*
 * adapters/oxydex-spo2.js — Tepna vendor adapter: O2Ring SpO₂ CSV → SignalFrame(spo2)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Wellue / Viatom O2Ring (and O2Ring S, Checkme O2) overnight pulse-oximetry
 * CSV — 1 Hz [time, SpO₂, pulse, motion]. The spo2 sibling of polar-rr.js: it
 * wraps OxyDex's PURE parseCSV (the same parser the app uses) and emits a
 * SignalFrame(spo2). parseCSV is a BARE GLOBAL with DOM side-effects at module
 * load, so OxyDex's DSP is co-loaded in an ISOLATED iframe host (the unifier /
 * OverDex pass its parseCSV in via ctx.parseCSV — exactly like ctx.parseRRInput
 * for the RR adapters). SIGNAL-ADAPTER-FOLLOWUPS §4.
 *
 * frame.samples carries the parsed ROW objects {tMs, spo2, hr, motion} (a
 * multi-channel sample — OxyDex needs SpO₂ + HR + motion together), fs = 1 Hz.
 * OxyDex.compute(frame) then runs the real processNight pipeline on them.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return;

  var VENDOR = 'Wellue / Viatom';
  var DEVICE = 'O2Ring / O2Ring S / Checkme O2';

  REG.registerAdapter({
    id: 'oxydex-spo2',
    signalType: 'spo2',
    vendor: VENDOR,
    device: DEVICE,
    detect: function (file, headText) {
      var name = (file && file.name || '') + '';
      var head = (headText || '') + '';
      if (/o2ring|oxydex|wellue|viatom|checkme/i.test(name)) return 0.95;     // explicit device/app mark
      var hasOx = /\b(spo2|sao2|oxygen|o2)\b|oxygen\s*level/i.test(head);
      var hasPulse = /\b(pulse|pr|hr|bpm|heart\s*rate)\b/i.test(head);
      var hasTime = /\b(time|date)\b/i.test(head);
      if (hasOx && hasPulse && hasTime) return 0.8;                           // O2Ring CSV header shape
      if (hasOx && hasTime) return 0.5;                                       // weaker: oximetry-ish
      return 0;
    },
    parse: function (text, ctx) {
      ctx = ctx || {};
      var parseFn = ctx.parseCSV || (typeof root.parseCSV === 'function' ? root.parseCSV : null);
      if (!parseFn) return root.SignalFrame.toSignalFrame('spo2', { usable: false, reason: 'oxydex-spo2: no parseCSV in scope (load OxyDex DSP in isolation)' }, { adapter: 'oxydex-spo2', vendor: VENDOR, device: DEVICE, files: ctx.files || null });
      var rows = parseFn(text, { fname: (ctx.files && ctx.files[0]) || null, file: null });
      if (!rows || !rows.length) return root.SignalFrame.toSignalFrame('spo2', { usable: false, reason: 'oxydex-spo2: no usable SpO₂ rows parsed (need time + SpO₂ + pulse columns)' }, { adapter: 'oxydex-spo2', vendor: VENDOR, device: DEVICE, files: ctx.files || null });
      var t0 = (rows[0] && rows[0].tMs != null) ? rows[0].tMs : null;
      var tsMs = rows.map(function (r) { return r.tMs; });
      return root.SignalFrame.toSignalFrame('spo2', {
        samples: rows, fs: 1, t0Ms: t0, tsMs: tsMs,
        usable: rows.length >= 10,
        reason: rows.length >= 10 ? null : ('only ' + rows.length + ' usable SpO₂ sample' + (rows.length === 1 ? '' : 's') + ' (need ≥10)')
      }, { adapter: 'oxydex-spo2', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: [] });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
