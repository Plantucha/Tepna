/*
 * adapters/wahoo-rr.js — Tepna vendor adapter: Wahoo TICKR RR → SignalFrame(rr)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Wahoo TICKR / TICKR X chest strap — same RR-interval signal as the Polar H10
 * and the Coospo HW9. Built by following ADD-AN-ADAPTER.md: a new vendor for a
 * signal we already analyze is ONE new file that differs from coospo-rr.js ONLY
 * in `detect`. It wraps the SAME pure `parseRRInput` (handed in via ctx by the
 * isolated PulseDex host) — if PulseDex fixes a parse bug, Wahoo inherits it for
 * free; no node was edited.
 *
 * The TICKR has no first-party RR file export; RR is captured through a logger
 * app (e.g. HRV Logger / EliteHRV paired to the TICKR over BLE) as a CSV/TXT
 * with a timestamp column + an `RR-interval [ms]` / `RR(ms)` / `RRI` column —
 * parseRRInput's delimited-timestamp path + Clock-Contract resolution covers it
 * (see how-to-collect/wahoo-tickr-rr.md). If a future logger uses a timestamp
 * format parseRRInput doesn't know, normalize it HERE (to ISO-8601, or compute
 * tMs per the Clock Contract) BEFORE handing text down — never add a regex to
 * the node's parseTimestamp.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'Wahoo (TICKR, via HRV logger)';
  var DEVICE = 'TICKR / TICKR X';

  REG.registerAdapter({
    id: 'wahoo-rr',
    signalType: 'rr',
    vendor: VENDOR,
    device: DEVICE,
    // cheap, side-effect-free: filename signature first, header signature as fallback.
    detect: function (file, headText) {
      var name = ((file && file.name) || '') + '';
      var head = (headText || '') + '';
      if (/wahoo|tickr/i.test(name + ' ' + head)) return 0.95; // explicit vendor mark
      if (/RR-?interval|RR\(ms\)|\bRRI?\b/i.test(head) && /wahoo|tickr/i.test(head)) return 0.8;
      return 0;
    },
    // REFERENCE the existing pure parser — never copy it.
    parse: function (text, ctx) {
      ctx = ctx || {};
      var parseRR = ctx.parseRRInput || (typeof root.parseRRInput === 'function' ? root.parseRRInput : null);
      if (!parseRR)
        return root.SignalFrame.toSignalFrame(
          'rr',
          { usable: false, reason: 'wahoo-rr: no parseRRInput in scope (load PulseDex DSP in isolation)' },
          { adapter: 'wahoo-rr', vendor: VENDOR, device: DEVICE }
        );
      var raw = parseRR(text);
      return root.SignalFrame.toSignalFrame('rr', raw, {
        adapter: 'wahoo-rr',
        vendor: VENDOR,
        device: DEVICE,
        files: ctx.files || null,
        warnings: []
      });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
