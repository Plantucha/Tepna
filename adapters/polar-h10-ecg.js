/*
 * adapters/polar-h10-ecg.js — Tepna vendor adapter: raw chest-strap ECG → SignalFrame(ecg)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Polar H10 chest strap, captured with the Polar Sensor Logger Android app
 * (com.j_ware.polarsensorlogger) → per-stream `*_ECG.txt`
 *   Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]   (~130 Hz)
 * Wraps ECGDex's PURE parseECG (the headless mirror of the app's streaming
 * worker — see ecgdex-dsp.js) and emits a SignalFrame(ecg). ECGDex is co-loaded
 * as a namespaced global (window.ECGDex) in the Unifier/OverDex/Dex-Test-Suite
 * realm; the adapter references parseECG BY REFERENCE — never copies it.
 *
 * ECG is SINGLE-CHANNEL, so the frame uses the STANDARD signal-spec.ecg shape —
 *   { samples:Int16Array (µV), fs, t0Ms, offsetMin } — NOT PpgDex's packed
 *   multi-channel `samples` object (that was for PPG's 3 optical channels @176 Hz;
 *   PPGDEX-FOLLOWUPS §8). ECGDex.compute(frame) reads samples+fs straight off the
 *   frame and runs the real band-pass → Pan-Tompkins R-peak → SQI → HRV → CVHR →
 *   Ganglior-event pipeline. R-peak detection runs WITHOUT the Web Worker (the
 *   co-load realm can't drive a Worker — parent brief §2b): compute() calls the
 *   pure detector inside analyze() directly.
 *
 * Clock Contract: parseECG internally calls the node's LOCAL parseTimestamp
 * (Phone-timestamp ISO; the `timestamp [ms]` column sets fs). DO NOT alter it;
 * apply any vendor quirk at the ingest boundary in parse() only. A stampless file
 * keeps t0Ms:null (never now()). The device's own `*_RR.txt` / `*_PPI.txt` is an
 * rr-family stream routed to PulseDex via polar-rr.js — this adapter owns the RAW
 * ECG waveform, ECGDex's unique beat-detection + apnea/CVHR lane.
 *
 * Detect note: an H10 `*_ECG.txt` header ALSO carries the `Phone timestamp` /
 * `sensor timestamp` columns polar-rr matches at 0.6 — so the distinctive
 * `ecg [uV]` waveform column (and/or the `_ECG` filename) must outrank it, or
 * route() would mis-send the waveform to PulseDex. ppg/rr precedence is locked
 * by the property-metamorphic route-precedence case.
 *
 * How to collect: Polar Sensor Logger → enable ECG (H10) → record → Share/export.
 *   Drop the `*_ECG.txt` (RR/HR/ACC companions optional, loaded as cross-checks).
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'Polar (Polar Sensor Logger)';
  var DEVICE = 'H10';

  REG.registerAdapter({
    id: 'polar-h10-ecg',
    signalType: 'ecg',
    vendor: VENDOR,
    device: DEVICE,

    // cheap, side-effect-free. The raw `…;ecg [uV]` waveform header (and/or `_ECG`
    // filename) must BEAT polar-rr's 0.6 "Phone timestamp" match, since a *_ECG.txt
    // header also carries that column.
    detect: function (file, headText) {
      var name = (file && file.name || '') + '';
      var head = (headText || '') + '';
      var isEcgName = /_ECG([._]|$)/i.test(name);
      // raw waveform header: an `ecg [uV]` / `ecg` column alongside a Polar Sensor Logger
      // timestamp column. The strongest single discriminator for the optical-vs-ECG split.
      var ecgHeader = /\becg\b/i.test(head) && /(sensor\s*timestamp|timestamp\s*\[ms\]|phone\s*timestamp|\[\s*uv\s*\])/i.test(head);
      if (isEcgName && /h10|polar|psl|sensor\s*logger/i.test(name + ' ' + head)) return 0.97;
      if (ecgHeader) return 0.9;                                          // beats polar-rr's 0.6 on the shared Phone-timestamp column
      if (isEcgName) return 0.85;                                         // PSL default per-stream ECG naming
      return 0;
    },

    // REFERENCE the existing pure parser — never copy it.
    parse: function (text, ctx) {
      ctx = ctx || {};
      var prov = { adapter: 'polar-h10-ecg', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: [] };
      // Prefer the namespaced surface; fall back to the ECGDSP legacy name.
      var ecg = root.ECGDex || root.ECGDSP;
      var parseFn = (ecg && typeof ecg.parseECG === 'function') ? ecg.parseECG
                  : (typeof root.ECGDSP !== 'undefined' && typeof root.ECGDSP.parseECG === 'function') ? root.ECGDSP.parseECG
                  : null;
      if (!parseFn) return root.SignalFrame.toSignalFrame('ecg',
        { usable: false, reason: 'polar-h10-ecg: ECGDex/ECGDSP not in scope (load ecgdex-dsp.js before this adapter)' }, prov);

      var rec;
      try { rec = parseFn(text); }
      catch (e) { return root.SignalFrame.toSignalFrame('ecg',
        { usable: false, reason: 'polar-h10-ecg: parse error — ' + (e && e.message || e) }, prov); }

      if (!rec || !rec.int16 || !rec.int16.length) return root.SignalFrame.toSignalFrame('ecg',
        { usable: false, reason: 'polar-h10-ecg: no usable ECG samples parsed (expected Polar Sensor Logger `*_ECG.txt`: Phone timestamp;sensor ns;timestamp [ms];ecg [uV])' }, prov);

      // ECGDex's Pan-Tompkins seeds thresholds from the first ~2 s and needs ≥12 R-peaks
      // (analyze throws otherwise), so require ~8 s of signal before declaring usable.
      var minN = (rec.fs || 130) * 8;
      // Single-channel samples ride through `samples` directly (Int16Array, has .length so
      // validateFrame's samples-payload check passes); fs/t0Ms/offsetMin are canonical frame fields.
      var frame = root.SignalFrame.toSignalFrame('ecg', {
        samples: rec.int16,
        fs: rec.fs,
        t0Ms: rec.t0Ms,
        offsetMin: rec.offsetMin,
        usable: rec.int16.length >= minN,
        reason: rec.int16.length >= minN ? null
          : ('only ' + rec.int16.length + ' ECG sample' + (rec.int16.length === 1 ? '' : 's') + ' (need ≥' + minN + ' ≈ 8 s for R-peak detection)')
      }, prov);

      // COMPANION-BUNDLE INGEST (ECG-PPG-FOLLOWUPS-HANDOFF §2(b)). The host pairs the matched device
      // `*_RR/_HR/_ACC` sidecars by stamp and hands their TEXT via ctx.companions = { rr, hr, acc };
      // parse them with the DSP-resident parsers (by reference, never copied) and attach to the frame so
      // ECGDex.compute(frame) carries rec.deviceRR/deviceHR/deviceACC → analyze() stamps epochs[].position
      // (posture) + accExtras + the device cross-checks. No companions → fields stay absent (single-text
      // path byte-identical). A bad companion is a non-fatal warning, never a thrown route.
      var comp = ctx.companions;
      if (comp && typeof comp === 'object') {
        try { if (comp.rr && typeof ecg.parseDeviceRR === 'function') { var dr = ecg.parseDeviceRR(comp.rr); if (dr && dr.length) frame.deviceRR = dr; } } catch (e0) { prov.warnings.push('RR companion parse failed: ' + (e0 && e0.message || e0)); }
        try { if (comp.hr && typeof ecg.parseDeviceHR === 'function') { var dh = ecg.parseDeviceHR(comp.hr); if (dh && dh.length) frame.deviceHR = dh; } } catch (e1) { prov.warnings.push('HR companion parse failed: ' + (e1 && e1.message || e1)); }
        try {
          if (comp.acc && typeof ecg.parseDeviceACC === 'function') {
            var da = ecg.parseDeviceACC(comp.acc);
            if (da && da.acc && da.acc.length) {
              // a stampless ACC is relative-from-0 → re-base onto the ECG anchor (Clock Contract — never now()).
              if (da.acc._relBase && frame.t0Ms != null) { for (var ai = 0; ai < da.acc.length; ai++) da.acc[ai].tsMs += frame.t0Ms; da.acc._relBase = false; }
              frame.deviceACC = da.acc; frame.accFs = da.accFs;
            }
          }
        } catch (e2) { prov.warnings.push('ACC companion parse failed: ' + (e2 && e2.message || e2)); }
      }
      return frame;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
