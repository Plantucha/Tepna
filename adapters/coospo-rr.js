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
    /* THE VENDOR TOKEN MUST NAME THE FILE, NOT MERELY APPEAR INSIDE IT (DEEP-AUDIT-V §2.2 F11/F24).
       This used to be `/coospo|hw9|h808/i.test(name + ' ' + head)` — the token matched anywhere in the
       first 2 KB of CONTENT, with no requirement on the file's SHAPE. The capture host's own BLE link
       log (`Tepna_*_LINK.csv`) lists every paired peer by advertised name, so a row reading
       `COOSPO 808S 0022265` routed the host's telemetry to the RR lane at 0.95 with `ambiguous:false`.
       Measured on two real capture nights: 9 of 326 files, every `_LINK.csv` plus `QC-SUMMARY.json`.
       The frame correctly refused (`usable:false`), but `PulseDex.compute` still produced
       `durationMin 723.6, beats 2808` from a column of literal `24`s.

       Note the SIBLING ASYMMETRY this restores (bug class 14): the three Polar adapters
       (`polar-rr.js:45`, `polar-h10-ecg.js:67`, `polar-sense-ppg.js:57`) all gate on a filename SHAPE
       first — `_RR`/`_PPI`, `_ECG`, `_PPG` — and use the vendor token only to CORROBORATE, so content
       matching cannot mis-route them. Only the two aftermarket-strap adapters let the bare token
       decide. `wahoo-rr.js` carries the identical fix.

       Kept reachable for real Coospo exports two ways: the token in the NAME (0.95), or the token in
       the HEADER LINE together with an RR-shaped column (0.8). What is no longer sufficient is the
       token in a DATA row. `_hdrLine` is the first non-empty line — a header names the file's columns;
       a data row names whatever the device saw. */
    detect: function (file, headText) {
      var name = ((file && file.name) || '') + '';
      var head = (headText || '') + '';
      var hdrLine = '';
      var lines = head.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
          hdrLine = lines[i];
          break;
        }
      }
      if (/coospo|hw9|h808/i.test(name)) return 0.95; // explicit vendor mark IN THE NAME
      if (/\bRRI?\b|RR\(ms\)|RR_?Interval/i.test(head) && /coospo|hw9|h808/i.test(hdrLine)) return 0.8;
      return 0;
    },
    parse: function (text, ctx) {
      ctx = ctx || {};
      var parseRR = ctx.parseRRInput || (typeof root.parseRRInput === 'function' ? root.parseRRInput : null);
      if (!parseRR)
        return root.SignalFrame.toSignalFrame(
          'rr',
          { usable: false, reason: 'coospo-rr: no parseRRInput in scope (load PulseDex DSP in isolation)' },
          { adapter: 'coospo-rr', vendor: VENDOR, device: DEVICE }
        );
      // Coospo firmware tends to stamp MDY; let the shared parser resolve via preferDMY:false.
      var raw = parseRR(text, { preferDMY: false });
      return root.SignalFrame.toSignalFrame('rr', raw, {
        adapter: 'coospo-rr',
        vendor: VENDOR,
        device: DEVICE,
        files: ctx.files || null,
        warnings: []
      });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
