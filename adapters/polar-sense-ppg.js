/*
 * adapters/polar-sense-ppg.js — Tepna vendor adapter: raw wrist-PPG → SignalFrame(ppg)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * Polar Verity Sense / OH1 optical armband, captured with the Polar Sensor
 * Logger Android app (com.j_ware.polarsensorlogger) → per-stream `*_PPG.txt`
 * (Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient,
 * ~176 Hz). Wraps PpgDex's PURE parsePPG (the same parser the app uses) and
 * emits a SignalFrame(ppg). PpgDex is co-loaded as a namespaced global
 * (window.PpgDex) in the Unifier/OverDex/Dex-Test-Suite realm; the adapter
 * references parsePPG BY REFERENCE — never copies or reimplements it.
 *
 * frame.samples PACKS the multi-channel optical waveform — { ch:[F32×3], amb,
 *   relSec, n, durSec, length:n } — because PPG runs at 100+ Hz: per-sample row
 *   objects (the cgm/spo2 shape) would be millions, so the typed-array channels
 *   ride through `samples` while fs/t0Ms/offsetMin sit on the frame (ECG-like).
 *   PpgDex.compute(frame) reconstructs the rec and runs the real beat-detection
 *   → self-PPI → HRV pipeline. The motion gate (ACC/GYRO/MAG) and device-PPI
 *   validation are multi-file companions the single-text adapter boundary cannot
 *   carry; they degrade gracefully to absent (analyzeMotion → hasData:false) —
 *   raw optical → events is the orchestrate payoff (+PPG OverDex coverage).
 *
 * Clock Contract: parsePPG internally calls the node's LOCAL parseTimestamp
 * (ISO / numeric-epoch). DO NOT alter it; apply any vendor quirk at the ingest
 * boundary in parse() only. Device `*_PPI.txt` (pulse-pulse intervals) is an
 * rr-family stream and is intentionally routed to PulseDex via polar-rr.js — this
 * adapter owns the RAW optical waveform, PpgDex's unique self-PPI lane.
 *
 * How to collect: Polar Sensor Logger → enable PPG (+ ACC/GYRO/MAGN for the motion
 *   gate) → record → Share/export. Drop the `*_PPG.txt` (companions optional).
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  var REG = root.SignalAdapters;
  if (!REG || typeof REG.registerAdapter !== 'function') return; // registry must load first

  var VENDOR = 'Polar (Polar Sensor Logger)';
  var DEVICE = 'Verity Sense / OH1';

  REG.registerAdapter({
    id: 'polar-sense-ppg',
    signalType: 'ppg',
    vendor: VENDOR,
    device: DEVICE,

    // cheap, side-effect-free. Filename signature first (must beat polar-rr's 0.6
    // "Phone timestamp" header match, since a *_PPG.txt header also carries that
    // column), then the distinctive 6-column `channel 0/1/2` waveform header.
    detect: function (file, headText) {
      var name = (file && file.name || '') + '';
      var head = (headText || '') + '';
      if (/_PPG\b|_PPG\./i.test(name) && /verity|sense|polar|oh1|psl/i.test(name + ' ' + head)) return 0.97;
      if (/_PPG\b|_PPG\./i.test(name)) return 0.85;                       // PSL default per-stream PPG naming
      // raw 6-column optical waveform header (channel 0;channel 1;channel 2)
      if (/channel\s*0/i.test(head) && /channel\s*1/i.test(head) && /(sensor\s*timestamp|ambient|Phone\s*timestamp)/i.test(head)) return 0.8;
      return 0;
    },

    // REFERENCE the existing pure parser — never copy it.
    parse: function (text, ctx) {
      ctx = ctx || {};
      var prov = { adapter: 'polar-sense-ppg', vendor: VENDOR, device: DEVICE, files: ctx.files || null, warnings: [] };
      // Prefer the namespaced surface; fall back to the PPGDSP legacy name.
      var ppg = root.PpgDex || root.PPGDSP;
      var parseFn = (ppg && typeof ppg.parsePPG === 'function') ? ppg.parsePPG
                  : (typeof root.PPGDSP !== 'undefined' && typeof root.PPGDSP.parsePPG === 'function') ? root.PPGDSP.parsePPG
                  : null;
      if (!parseFn) return root.SignalFrame.toSignalFrame('ppg',
        { usable: false, reason: 'polar-sense-ppg: PpgDex/PPGDSP not in scope (load ppgdex-dsp.js before this adapter)' }, prov);

      var rec;
      try { rec = parseFn(text); }
      catch (e) { return root.SignalFrame.toSignalFrame('ppg',
        { usable: false, reason: 'polar-sense-ppg: parse error — ' + (e && e.message || e) }, prov); }

      if (!rec || !rec.ch || !rec.ch.length || !rec.n || rec.n < 10) return root.SignalFrame.toSignalFrame('ppg',
        { usable: false, reason: 'polar-sense-ppg: no usable PPG samples parsed (expected Polar Sense `*_PPG.txt`: Phone timestamp;sensor ns;ch0;ch1;ch2;ambient)' }, prov);

      // PACK the parsed waveform — typed-array channels + timing — under samples (with .length so
      // validateFrame's samples-payload check passes); fs/t0Ms/offsetMin are canonical frame fields.
      var samples = { ch: rec.ch, amb: rec.amb, relSec: rec.relSec, n: rec.n, durSec: rec.durSec, length: rec.n };
      var frame = root.SignalFrame.toSignalFrame('ppg', {
        samples: samples,
        fs: rec.fs,
        t0Ms: rec.t0Ms,
        offsetMin: rec.offsetMin,
        usable: rec.n >= 200,
        reason: rec.n >= 200 ? null : ('only ' + rec.n + ' PPG sample' + (rec.n === 1 ? '' : 's') + ' (need ≥200 for beat detection)')
      }, prov);

      // COMPANION-BUNDLE INGEST (ECG-PPG-FOLLOWUPS-HANDOFF §2(b)). The host pairs the matched motion +
      // device-PPI sidecars by stamp and hands their TEXT via ctx.companions = { acc, gyro, magn, ppi };
      // parse them with the DSP-resident parsers (PPGDSP.parseSensorXYZ / parseDevicePPI, by reference) and
      // attach to the frame so PpgDex.compute(frame) carries rec.acc/gyro/magn/devicePPI → analyze() runs the
      // motion gate (analyzeMotion → hasData) + limb posture (epochs[].position) + the device-PPI lane. No
      // companions → fields stay absent (single-text path byte-identical). PpgDex (the namespace) exposes only
      // parsePPG/compute — the sensor parsers live on PPGDSP, so resolve them there (no ppgdex-dsp.js change).
      var dsp = (ppg && typeof ppg.parseSensorXYZ === 'function') ? ppg : (root.PPGDSP || ppg);
      var comp = ctx.companions;
      if (comp && typeof comp === 'object' && dsp) {
        try { if (comp.acc && typeof dsp.parseSensorXYZ === 'function') { var a = dsp.parseSensorXYZ(comp.acc); if (a && a.length) frame.acc = a; } } catch (e0) { prov.warnings.push('ACC companion parse failed: ' + (e0 && e0.message || e0)); }
        try { if (comp.gyro && typeof dsp.parseSensorXYZ === 'function') { var g = dsp.parseSensorXYZ(comp.gyro); if (g && g.length) frame.gyro = g; } } catch (e1) { prov.warnings.push('GYRO companion parse failed: ' + (e1 && e1.message || e1)); }
        try { if (comp.magn && typeof dsp.parseSensorXYZ === 'function') { var mg = dsp.parseSensorXYZ(comp.magn); if (mg && mg.length) frame.magn = mg; } } catch (e2) { prov.warnings.push('MAGN companion parse failed: ' + (e2 && e2.message || e2)); }
        try { if (comp.ppi && typeof dsp.parseDevicePPI === 'function') { var pp = dsp.parseDevicePPI(comp.ppi); if (pp && pp.length) frame.devicePPI = pp; } } catch (e3) { prov.warnings.push('PPI companion parse failed: ' + (e3 && e3.message || e3)); }
      }
      return frame;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
