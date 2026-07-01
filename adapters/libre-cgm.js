/*
 * adapters/libre-cgm.js — Tepna vendor adapter: CGM CSV → SignalFrame(cgm)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Abbott FreeStyle Libre / LibreLinkUp and Dexcom CGM CSV exports.
 * Wraps GlucoDex's PURE parseCSV (the same parser the app uses) and emits a
 * SignalFrame(cgm). GlucoDex is co-loaded as a namespaced global (window.GlucoDex)
 * in the Unifier/OverDex/Dex-Test-Suite realm; the adapter references parseCSV
 * by reference — never copies or reimplements it.
 *
 * Clock Contract: parseCSV internally calls parseTimestamp with preferDMY:false
 * (MDY — the Libre/Dexcom default). A DMY-format CGM vendor sets preferDMY:true
 * via a separate adapter or opts. DO NOT alter parseTimestamp; apply vendor quirks
 * at the ingest boundary in parse() only.
 *
 * frame.samples: array of { tMs, v } row objects (tMs = floating wall-clock ms,
 *   v = mg/dL normalised by parseCSV). frame.tsMs = parallel timestamp array.
 * GlucoDex.compute(frame) or GlucoDex.analyze(parsed) runs the real pipeline.
 *
 * How to collect (FreeStyle Libre):
 *   LibreLinkUp app → Menu → Export Data → "Glucose Readings" CSV (or use the
 *   reader's USB export). The file has a Date/Time column + a glucose column in
 *   either mg/dL or mmol/L — parseCSV auto-detects the unit.
 * How to collect (Dexcom):
 *   Dexcom Clarity → Export → CSV. The file has a "Timestamp (YYYY-MM-DDThh:mm:ss)"
 *   column and a "Glucose Value (mg/dL)" column.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return;

  var VENDOR = 'Abbott / Dexcom';
  var DEVICE = 'FreeStyle Libre / LibreLinkUp / Dexcom';

  REG.registerAdapter({
    id: 'libre-cgm',
    signalType: 'cgm',
    vendor: VENDOR,
    device: DEVICE,

    detect: function (file, headText) {
      var name = (file && file.name || '') + '';
      var head = (headText || '') + '';

      // Filename: explicit device/app marks
      if (/libre|librelink|freeStyle|dexcom|cgm/i.test(name)) return 0.95;
      // GlucoDex own exports carry the node name
      if (/glucodex/i.test(name)) return 0.90;

      // Header content: glucose + timestamp is a strong CGM signal
      var hasGlucose = /\b(glucose|cgm|sugar|mmol|mg.?dl)\b/i.test(head);
      var hasTime    = /\b(time|date|timestamp)\b/i.test(head);
      var hasPulse   = /\b(pulse|spo2|oxygen|ecg)\b/i.test(head);   // rule out other bio-CSVs

      if (hasGlucose && hasTime && !hasPulse) return 0.80;
      if (hasGlucose && !hasPulse)             return 0.45;
      return 0;
    },

    parse: function (text, ctx) {
      ctx = ctx || {};
      // Prefer the namespaced surface; fall back to the GLUDSP legacy name.
      var gluco = root.GlucoDex || root.GLUDSP;
      var parseFn = (gluco && typeof gluco.parseCSV === 'function') ? gluco.parseCSV
                  : (typeof root.GLUDSP !== 'undefined' && typeof root.GLUDSP.parseCSV === 'function') ? root.GLUDSP.parseCSV
                  : null;

      if (!parseFn) {
        return root.SignalFrame.toSignalFrame('cgm',
          { usable: false, reason: 'libre-cgm: GlucoDex/GLUDSP not in scope (load glucodex-dsp.js before this adapter)' },
          { adapter: 'libre-cgm', vendor: VENDOR, device: DEVICE, files: ctx.files || null });
      }

      var parsed;
      try {
        parsed = parseFn(text);   // { tMs:[], vMgdl:[], unit, t0Ms }
      } catch (e) {
        return root.SignalFrame.toSignalFrame('cgm',
          { usable: false, reason: 'libre-cgm: parse error — ' + e.message },
          { adapter: 'libre-cgm', vendor: VENDOR, device: DEVICE, files: ctx.files || null });
      }

      if (!parsed || !parsed.tMs || !parsed.tMs.length) {
        return root.SignalFrame.toSignalFrame('cgm',
          { usable: false, reason: 'libre-cgm: no usable glucose readings parsed (need timestamp + glucose columns)' },
          { adapter: 'libre-cgm', vendor: VENDOR, device: DEVICE, files: ctx.files || null });
      }

      // Build row objects from parallel arrays (frameFields needs samples[])
      var samples = parsed.tMs.map(function (t, i) {
        return { tMs: t, v: parsed.vMgdl[i] };
      });

      return root.SignalFrame.toSignalFrame('cgm', {
        samples: samples,
        tsMs:    parsed.tMs,          // frameFields: tsMs required
        t0Ms:    parsed.t0Ms,
        unit:    parsed.unit,         // 'mg/dL' (always normalised internally) or 'mmol/L' source
        usable:  samples.length >= 10,
        reason:  samples.length >= 10 ? null
               : ('only ' + samples.length + ' usable glucose reading' +
                  (samples.length === 1 ? '' : 's') + ' (need ≥10)')
      }, {
        adapter: 'libre-cgm',
        vendor:  VENDOR,
        device:  DEVICE,
        files:   ctx.files || null,
        warnings: []
      });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
