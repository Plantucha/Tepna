/*
 * adapters/welltory-summary.js — Tepna vendor adapter: Welltory-style HRV summary CSV → SignalFrame(hrv)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Welltory (and any HRV app that exports the same per-measurement summary CSV:
 * Date,Time, Stress(HRV), Mean RR, SDNN, rMSSD, MxDMn, pNN50, AMo50, Mode, …).
 * Unlike the rr/spo2 adapters this is NOT a raw signal — each row is an already-
 * computed HRV measurement (a spot read), so the frame is an IRREGULARLY-sampled
 * `hrv` SignalFrame whose `samples` are the parsed measurement rows and whose
 * per-sample timestamps live in `tsMs` (no fixed fs — see SignalSpec.hrv / the
 * cgm-style frameFields). It wraps HRVDex's PURE summary parser (the same
 * _hrvParseSummaryRows the app uses), handed in via ctx.parseRows — HRVDex's DSP
 * is a bare global with a DOM/localStorage commit path, so it is co-loaded in an
 * ISOLATED iframe host (signal-orchestrate.js hrvHost). SIGNAL-ADAPTER-FOLLOWUPS §4.
 *
 * This adapter is also the home of the two summary-ingest correctness items the
 * brief folds into HRVDex's Phase-9 (a NODE-gated edit, not a drive-by):
 *   1. Baevsky SI/CSI ms-vs-s UNIT GUARD (DexUnits.guardBaevsky / baevskySI) applied
 *      at the ingest boundary: Mode/MxDMn arrive in ms OR s depending on the vendor;
 *      a ms value silently mis-scales the Stress Index by up to 10⁶× ("plausible but
 *      wrong"). We normalize to seconds + recompute a unit-safe SI per row, flagging
 *      any value outside the plausible RR range (surfaced, never silently scaled).
 *   2. Welltory's subjective scores (Stress(HRV)/Energy/Coherence/Focus/SNS/PSNS) are
 *      BLACK-BOX vendor composites → the frame is stamped provenance.derived:true and
 *      a lower-evidence note; the emitted stress_high event is tagged meta.derived /
 *      'heuristic' in the shared builder so the Integrator never treats a vendor
 *      composite as a measured fact.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return;

  var VENDOR = 'Welltory';
  var DEVICE = 'HRV summary CSV (Welltory / compatible HRV-app export)';

  // Apply the Baevsky ms-vs-s unit guard to every row IN PLACE at the ingest
  // boundary, and recompute a unit-safe Stress Index. Returns a small audit.
  function applyBaevskyGuard(rows) {
    var Q = root.DexUnits;
    var audit = { applied: !!(Q && Q.guardBaevsky), flagged: 0, msNormalized: 0, total: rows.length };
    if (!(Q && Q.guardBaevsky)) return audit;   // degrade gracefully if quantity.js isn't loaded
    rows.forEach(function (r) {
      var g = Q.guardBaevsky(r._mode, r._mxdmn);
      var si = Q.baevskySI(r._amo50, g.modeS, g.mxdmnS);
      r._baevsky = { modeS: g.modeS, mxdmnS: g.mxdmnS, si: si, assumedMs: g.assumedMs, flagged: g.flagged };
      if (g.assumedMs) audit.msNormalized++;
      if (g.flagged) audit.flagged++;
    });
    return audit;
  }

  REG.registerAdapter({
    id: 'welltory-summary',
    signalType: 'hrv',
    vendor: VENDOR,
    device: DEVICE,
    detect: function (file, headText) {
      var name = (file && file.name || '') + '';
      var head = (headText || '') + '';
      // node-export JSON (any node) is NOT a summary CSV — never claim it here; it
      // routes via OverDex's node-export passthrough. (A node export's body can
      // contain "rmssd"/"sdnn" tokens, so the JSON guard is load-bearing.)
      if (/^[\s\uFEFF]*[\[{]/.test(head)) return 0;
      if (/welltory/i.test(name)) return 0.95;                                  // explicit app/file mark
      // Welltory-specific subjective columns are an unambiguous signature.
      if (/stress\(hrv\)|ans\s*balance/i.test(head)) return 0.95;
      // Generic HRV-summary header shape: rMSSD + SDNN + a Mode/MxDMn/AMo column.
      if (/\brmssd\b/i.test(head) && /\bsdnn\b/i.test(head) && /mean\s*rr|mxdmn|amo50|pnn50/i.test(head)) return 0.85;
      if (/_hrv\b|hrv[_-]?summary/i.test(name)) return 0.6;
      return 0;
    },
    parse: function (text, ctx) {
      ctx = ctx || {};
      var parseFn = ctx.parseRows
        || (root.HRVDex && typeof root.HRVDex.parseRows === 'function' ? root.HRVDex.parseRows : null);
      var prov = { adapter: 'welltory-summary', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: /** @type {string[]} */ ([]) };
      if (!parseFn) return root.SignalFrame.toSignalFrame('hrv', { usable: false, reason: 'welltory-summary: no HRVDex.parseRows in scope (load HRVDex DSP in isolation)' }, prov);
      var rows = parseFn(text);
      if (!rows || !rows.length) return root.SignalFrame.toSignalFrame('hrv', { usable: false, reason: 'welltory-summary: no usable HRV measurements parsed (need Date/Time + rMSSD/SDNN columns)' }, prov);

      // ── Clock Contract §4/§5 ordering at the ingest boundary (SIGNAL-ADAPTER-FOLLOWUPS -IV §1) ──
      // A SignalFrame's samples/tsMs MUST be ascending in floating tMs — validateFrame REJECTS a
      // backwards tsMs step (the floating-tMs law, signal-frame.js IRREGULAR-tsMs contract §6).
      // Welltory exports newest-row-FIRST, so sort ascending by _tMs HERE, mirroring the app's
      // commitRows sort + hrvBuildNodeExport (VII §1). Without it a real newest-first Welltory CSV
      // yields a usable-but-INVALID frame and the Data Unifier / OverDex HRV emit path silently
      // dies (found via the live drop-through). Rows with a null/NaN stamp sort last (their own
      // gap); t0 below then resolves to the EARLIEST sample (Clock Contract §4).
      rows.sort(function (a, b) {
        var x = (a && typeof a._tMs === 'number' && isFinite(a._tMs)) ? a._tMs : Infinity;
        var y = (b && typeof b._tMs === 'number' && isFinite(b._tMs)) ? b._tMs : Infinity;
        return x - y;
      });

      // ── correctness item 1: Baevsky ms-vs-s unit guard at the ingest boundary ──
      var ba = applyBaevskyGuard(rows);
      if (ba.applied) {
        if (ba.msNormalized) prov.warnings.push('Baevsky guard: ' + ba.msNormalized + '/' + ba.total + ' row(s) had ms-scale Mode/MxDMn normalized to seconds before the Stress Index.');
        if (ba.flagged) prov.warnings.push('Baevsky guard: ' + ba.flagged + '/' + ba.total + ' row(s) had Mode/MxDMn outside the plausible RR range — Stress Index surfaced, not silently scaled.');
      }
      // ── correctness item 2: Welltory subjective scores are black-box composites ──
      var t0 = rows[0]._tMs != null ? rows[0]._tMs : null;
      var tsMs = rows.map(function (r) { return r._tMs; });
      var frame = root.SignalFrame.toSignalFrame('hrv', {
        samples: rows, fs: null, t0Ms: t0, tsMs: tsMs,
        usable: rows.length >= 1,
        reason: rows.length >= 1 ? null : 'no measurement rows'
      }, prov);
      // toSignalFrame only copies the known provenance fields, so stamp the
      // black-box-composite markers onto the built frame's provenance directly.
      frame.provenance.derived = true;
      frame.provenance.derivedNote = 'Welltory Stress(HRV)/Energy/Coherence/Focus/SNS/PSNS are vendor BLACK-BOX composites (heuristic tier); rMSSD/SDNN/Mean RR are measured time-domain HRV.';
      // NOTE (SIGNAL-ADAPTER-FOLLOWUPS-III §2): this `derived` flag rides into the export
      // and the shared builder tags the stress_high event meta.derived / 'heuristic' — but
      // the Integrator's fusion (effConf) does NOT yet read meta.derived; it is AUDIT-ONLY
      // today (a derived composite currently fuses at the same weight as a measured surge).
      // Down-weighting it is a deliberate future Integrator pass — do not treat the tag as
      // load-bearing in the posterior until that wire-up + its test land.
      return frame;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
