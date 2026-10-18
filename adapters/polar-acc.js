/*
 * adapters/polar-acc.js — Tepna vendor adapter: Polar ACC → SignalFrame(acc) → MotionDex
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Polar H10 chest strap + Verity Sense armband accelerometer streams, as Polar Sensor Logger
 * (com.j_ware.polarsensorlogger) or the capture host writes them: `…_ACC.txt` with a declared
 * `[mg]` unit, plus the optional `…_ACCRUNS.txt` validity sidecar and, for the Verity, `…_GYRO`
 * and `…_MAGN` streams. The ACC is MotionDex's own signal; before this adapter OverDex set it
 * aside and MotionDex was reachable only from a hand-exported node-export JSON.
 *
 * This adapter REFERENCES MotionDex's pure `parseSensorXYZ` (handed in via ctx.parseSensorXYZ,
 * or resolved off the namespaced `MotionDex` global) — it never copies the parser. The ACC stays
 * a companion of the ECG/PPG primaries as well: ECGDex's posture and motion gating read the SAME
 * file through pairCompanions, and routing it here takes nothing away from them.
 *
 * `site` is the body site, read from the device name (H10 = chest, Verity Sense = arm). It picks
 * the MotionDex compute slot (chestAcc vs acc), exactly as motiondex-app.js slotFor() does.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'Polar (Polar Sensor Logger)';

  function siteOf(name) {
    if (/(^|[_\s])H10([_\s]|$)|Polar_H10/i.test(name)) return 'chest';
    if (/Verity|Sense/i.test(name)) return 'arm';
    return null; // unknown device: no slot is guessed (MotionDex reads it as the wrist/arm ACC)
  }

  function parserOf(ctx) {
    if (ctx && typeof ctx.parseSensorXYZ === 'function') return ctx.parseSensorXYZ;
    var M = root.MotionDex;
    return M && typeof M.parseSensorXYZ === 'function' ? M.parseSensorXYZ : null;
  }

  // rows → measured rate over the device span (relNs), else the stamped span; null when neither spans
  // two rows. Never a nominal rate: the delivered ACC rate runs 20.9–202.7 Hz across the corpus.
  function measuredFs(rows) {
    var n = rows.length;
    if (n < 2) return null;
    var a = rows[0],
      b = rows[n - 1];
    if (a && b && isFinite(a.relNs) && isFinite(b.relNs) && b.relNs > a.relNs) return (n - 1) / ((b.relNs - a.relNs) / 1e9);
    if (a && b && a.tMs != null && b.tMs != null && b.tMs > a.tMs) return (n - 1) / ((b.tMs - a.tMs) / 1000);
    return null;
  }

  REG.registerAdapter({
    id: 'polar-acc',
    signalType: 'acc',
    vendor: VENDOR,
    device: 'H10 / Verity Sense',
    detect: function (file, headText) {
      var name = ((file && file.name) || '') + '';
      var head = headText || '';
      // the ACC stream only: the validity sidecar and the other IMU streams are companions, never primaries.
      if (!/_ACC\b|_ACC\./i.test(name) || /_ACCRUNS|_ACCRAW/i.test(name)) return 0;
      var polar = /polar|verity|h10/i.test(name);
      var mg = /\[\s*mg\s*\]|X\s*\[mg\]/i.test(head);
      if (polar && mg) return 0.97;
      if (polar) return 0.85;
      return mg ? 0.6 : 0;
    },
    parse: function (text, ctx) {
      ctx = ctx || {};
      var name = (ctx.files && ctx.files[0]) || '';
      var site = siteOf(name);
      var prov = {
        adapter: 'polar-acc',
        vendor: VENDOR,
        device: site === 'chest' ? 'H10' : site === 'arm' ? 'Verity Sense' : 'Polar',
        files: ctx.files || null,
        warnings: /** @type {string[]} */ ([])
      };
      var parse = parserOf(ctx);
      if (!parse) return root.SignalFrame.toSignalFrame('acc', { usable: false, reason: 'polar-acc: no parseSensorXYZ in scope (co-load motiondex-dsp.js)' }, prov);
      var comp = ctx.companions && typeof ctx.companions === 'object' ? ctx.companions : {};
      // SAMPLE-VALIDITY-ENVELOPE §3.2 — the sidecar rides in under its own kind; absent it, the one-argument call.
      var rows = comp.accruns ? parse(text, { runsText: comp.accruns }) : parse(text);
      rows = Array.isArray(rows) ? rows : [];
      var t0 = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].tMs != null) {
          t0 = rows[i].tMs;
          break;
        }
      }
      var fs = measuredFs(rows);
      var usable = rows.length > 10 && fs != null;
      var frame = root.SignalFrame.toSignalFrame(
        'acc',
        {
          samples: rows, // MotionDex's own row shape; MotionDex.compute() takes the array as parsed
          fs: fs,
          t0Ms: t0,
          usable: usable,
          reason: usable ? null : rows.length > 10 ? 'ACC rows carry no stamped span (rate unmeasurable)' : 'only ' + rows.length + ' ACC row' + (rows.length === 1 ? '' : 's')
        },
        prov
      );
      frame.site = site;
      // the Verity's other IMU streams: parsed by the same parser, attached beside the ACC. A bad one warns.
      ['gyro', 'magn'].forEach(function (k) {
        if (!comp[k]) return;
        try {
          var r = parse(comp[k]);
          if (Array.isArray(r) && r.length) frame[k === 'magn' ? 'mag' : 'gyro'] = r;
        } catch (e) {
          prov.warnings.push(k.toUpperCase() + ' companion parse failed: ' + ((e && e.message) || e));
        }
      });
      return frame;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
