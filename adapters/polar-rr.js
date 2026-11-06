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
      var name = ((file && file.name) || '') + '';
      var head = headText || '';
      /* FOREIGN-STREAM VETO (DEEP-AUDIT-2026-07-11 §2). A Polar Sensor Logger session folder carries
         EVERY stream side by side (_ACC / _MAGN / _GYRO / _PPG / _ECG / _RR / _PPI), and they ALL share
         the same `Phone timestamp;sensor timestamp` envelope — so that envelope is evidence of PSL, NOT
         evidence of an RR stream. Without this veto a real H10 *_ACC.txt scored 0.6 here, won by default
         (nothing outranks it — unlike *_ECG.txt, which polar-h10-ecg outranks), and its Z-axis gravity
         rail (~973 mg) landed inside PulseDex's 300–2000 ms interval window: a gravity vector was
         analyzed as a heart recording (HR 61.9 bpm, "overnight", stress 100, 36 stress_peak events).
         Veto by stream name AND by declared unit, so a renamed file is still refused. */
      if (/_(ACC|MAGN?|GYRO?|PPG|ECG)\b/i.test(name)) return 0;
      if (/\[\s*(mg|g|dps|uv|µv|nt|gauss)\s*\]/i.test(head)) return 0; // a declared NON-interval unit
      if (/_RR\b|_PPI\b|RR\.txt$|PPI\.txt$/i.test(name) && /polar|psl|verity|h10/i.test(name + ' ' + head)) return 0.97;
      if (/_RR\b|_PPI\b/i.test(name)) return 0.8; // PSL default per-stream naming
      // An RR/PP COLUMN is real evidence; the bare PSL timestamp envelope is not, and no longer votes
      // on its own (every PSL stream has it).
      if (/RR-?interval|PP-?interval/i.test(head)) return 0.6;
      return 0;
    },
    // REFERENCE the existing pure parser — never copy it.
    parse: function (text, ctx) {
      ctx = ctx || {};
      var parseRR = ctx.parseRRInput || (typeof root.parseRRInput === 'function' ? root.parseRRInput : null);
      if (!parseRR)
        return root.SignalFrame.toSignalFrame(
          'rr',
          { usable: false, reason: 'polar-rr: no parseRRInput in scope (load PulseDex DSP in isolation)' },
          { adapter: 'polar-rr', vendor: VENDOR, device: DEVICE }
        );
      /* SEAM-SIDECAR-CONSUMPTION §4 — the box's clock-seam sidecar beside this interval stream, under
         the kind the pairing gave it. TWO spellings reach an `rr` primary and they are ONE channel
         here: a Verity PPI stream is paired with `_PPISEAMS` and an H10 RR stream with `_HRSEAMS`
         (the HR writer owns the `_RR.txt` sibling, so the sidecar carries the HR spelling). Each
         declares its own `stream=` and `parsePdSeams` refuses a foreign one, so taking whichever
         arrived cannot cross the streams. The owner ruled on 2026-11-05 that a night with no sidecar
         reads seams UNKNOWN, so this is the difference between an annotated unknown and a fabricated
         zero on the orchestrated road. */
      var comp = ctx.companions || {};
      var seamsText = typeof comp.ppiseams === 'string' ? comp.ppiseams : typeof comp.hrseams === 'string' ? comp.hrseams : null;
      var raw = seamsText ? parseRR(text, { seamsText: seamsText }) : parseRR(text);
      var frame = root.SignalFrame.toSignalFrame('rr', raw, {
        adapter: 'polar-rr',
        vendor: VENDOR,
        device: DEVICE,
        files: ctx.files || null,
        warnings: []
      });
      /* THE PARSED SIDECAR, CARRIED ACROSS THE FRAME BOUNDARY (§4). `emitRRNodeExport` rebuilds the
         compute input from this frame, so a key hung only on the parse result would be a sidecar read
         and then discarded on the orchestrated road — the gap #4441 closed on two nodes. */
      if (raw && raw._seamsSidecar) {
        frame.seamsSidecar = raw._seamsSidecar;
        frame.recordedSeams = raw._recordedSeams;
        if (raw._recordedSeamsReason) frame.recordedSeamsReason = raw._recordedSeamsReason;
      }
      return frame;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
