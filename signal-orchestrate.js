/*
 * signal-orchestrate.js — Tepna shared node orchestration (RR · SpO₂ · HRV · …), UI-free, reusable
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * The ROUTER is SignalAdapters.route(); the FUSER is IntegratorDSP. This module
 * is the missing middle the Data Unifier (Phase 1) and OverDex (Phase 10) BOTH
 * need and must NOT each re-implement (SIGNAL-ADAPTER-FOLLOWUPS §1): take a
 * normalized SignalFrame and produce a schema-valid `ganglior.node-export` by
 * running the owning node's REAL public headless compute() — PulseDex.compute
 * (RR), OxyDex.compute (SpO₂), HRVDex.compute (HRV summary).
 *
 * ✅ §3 DONE — NAMESPACED-BUILD CO-LOAD (the iframe-removal pass, 2026-06-25):
 * the migrated DSPs (pulsedex/oxydex/hrvdex-dsp.js) now ship a NAMESPACED build —
 * each hangs its public surface off ONE global (PulseDex / OxyDex / HRVDex) and,
 * when root.__DEX_NAMESPACED__ is set, leaks NO bare names. So the host page (the
 * Data Unifier / OverDex / the test suite) sets that flag and co-loads all three
 * DSPs as ordinary <script> tags in ONE realm — there is NO per-node isolation
 * iframe any more. Only integrator-dsp.js still declares bare parseTimestamp/mean,
 * and it is the LONE bare-global module on the page, so nothing collides. This
 * removed the linear iframe-per-node growth flagged in -II §2, unblocks bundling a
 * single-file Data Unifier (parent §3) and the Node-side compute() CI floor (-II §3).
 *
 * pulseHost()/oxyHost()/hrvHost() are KEPT (same call sites) but now just resolve
 * once the namespace is present on the host, handing back a tiny host shim shaped
 * like the old isolation contentWindow (pw.parseRRInput · pw.PulseDex.compute ·
 * pw.DexKernel) so the Unifier/OverDex call sites are unchanged.
 *
 * ✅ PHASE-9 (§1/§2/§9a, 2026-06-24): the per-signal emit*NodeExport call PulseDex/
 * OxyDex/HRVDex .compute() — NO reach-in into private underscore globals; the emitted
 * event set is byte-identical to each app's own exportGanglior. -II §4: those three are
 * now thin wrappers under ONE signalType-dispatched emitNodeExport(frame) so consumers
 * stop branching a switch at every call site.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // ── co-load readiness: poll for the namespaced DSP on the host realm ──────
  // Scripts load synchronously before app code, so root.<NS>.compute is normally
  // present immediately; the poll only covers an out-of-order load and fails LOUD
  // (never silently) if the host forgot to co-load the namespaced DSP.
  function _await(ns) {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function poll() {
        if (root[ns] && typeof root[ns].compute === 'function') return resolve(undefined);
        if (Date.now() - t0 > 8000)
          return reject(
            new Error(
              'signal-orchestrate: ' +
                ns +
                ' namespaced DSP not found on host — set window.__DEX_NAMESPACED__=true and load ' +
                ns.toLowerCase() +
                '-dsp.js (with kernel-constants.js) before using this module'
            )
          );
        setTimeout(poll, 25);
      })();
    });
  }

  // ── host shims (replace the old isolation iframe windows) ─────────────────
  // Each shim exposes exactly what the call sites read; nothing bare lands on the
  // page (the parsers come off the node namespace — PulseDex.parseRRInput / OxyDex.parseCSV).
  var _win = null,
    _oxyWin = null,
    _hrvWin = null,
    _glucoWin = null,
    _ppgWin = null,
    _ecgWin = null,
    _cpapWin = null;
  var _pulseReady = null,
    _oxyReady = null,
    _hrvReady = null,
    _glucoReady = null,
    _ppgReady = null,
    _ecgReady = null,
    _cpapReady = null;

  function pulseHost() {
    if (_pulseReady) return _pulseReady;
    _pulseReady = _await('PulseDex').then(function () {
      _win = { PulseDex: root.PulseDex, parseRRInput: root.PulseDex.parseRRInput, DexKernel: root.DexKernel };
      return _win;
    });
    return _pulseReady;
  }
  function pulseWin() {
    return _win;
  }

  // oxyHost(): the SpO₂ host shim (name kept — source-mirror gate + call sites).
  function oxyHost() {
    if (_oxyReady) return _oxyReady;
    _oxyReady = _await('OxyDex').then(function () {
      _oxyWin = { OxyDex: root.OxyDex, parseCSV: root.OxyDex.parseCSV, DexKernel: root.DexKernel };
      return _oxyWin;
    });
    return _oxyReady;
  }
  function oxyWin() {
    return _oxyWin;
  }

  // hrvHost(): the HRV-summary host shim (name kept — source-mirror gate + call sites).
  function hrvHost() {
    if (_hrvReady) return _hrvReady;
    _hrvReady = _await('HRVDex').then(function () {
      _hrvWin = { HRVDex: root.HRVDex, DexKernel: root.DexKernel };
      return _hrvWin;
    });
    return _hrvReady;
  }
  function hrvWin() {
    return _hrvWin;
  }

  // ── RR SignalFrame → ganglior.node-export via PulseDex's PUBLIC headless compute ──
  // Hand the normalized frame to PulseDex.compute() on the co-loaded host, which runs
  // PulseDex's real artifact-clean + windowed HRV + the full event windowing (hrv_drop
  // + stress_peak + short branch) — the SAME path PulseDex.html's exportGanglior uses.
  function emitRRNodeExport(frame, pw) {
    pw = pw || _win;
    if (!(pw && pw.PulseDex && typeof pw.PulseDex.compute === 'function')) throw new Error('signal-orchestrate: PulseDex.compute unavailable (co-load the namespaced pulsedex-dsp.js)');
    var ingest = { adapter: frame.provenance.adapter, vendor: frame.provenance.vendor, device: frame.provenance.device, via: frame.provenance.via || 'signal-orchestrate' };
    return pw.PulseDex.compute(
      { intervals: (frame && frame.intervals) || [], tsMs: frame.tsMs, t0Ms: frame.t0Ms != null ? frame.t0Ms : null, offsetMin: frame.offsetMin != null ? frame.offsetMin : null },
      { kernel: pw.DexKernel || root.DexKernel || null, ingest: ingest }
    );
  }

  // ── SpO₂ SignalFrame → ganglior.node-export via OxyDex's PUBLIC headless compute ──
  // OxyDex.compute() runs the real parseCSV→processNight pipeline and emits a single-
  // night summary node-export (same shape OxyDex.html exportJSON emits; the Integrator's
  // adaptOxyDex synthesizes spo2_desaturation + autonomic_arousal from desatProfile/hr_spikes).
  function emitSpO2NodeExport(frame, ow) {
    ow = ow || _oxyWin;
    if (!(ow && ow.OxyDex && typeof ow.OxyDex.compute === 'function')) throw new Error('signal-orchestrate: OxyDex.compute unavailable (co-load the namespaced oxydex-dsp.js)');
    var ingest = { adapter: frame.provenance.adapter, vendor: frame.provenance.vendor, device: frame.provenance.device, via: frame.provenance.via || 'signal-orchestrate' };
    return ow.OxyDex.compute(frame, {
      kernel: ow.DexKernel || root.DexKernel || null,
      ingest: ingest,
      fname: (frame.provenance.files && frame.provenance.files[0]) || null,
      offsetMin: frame.offsetMin != null ? frame.offsetMin : null
    });
  }

  // ── HRV-summary SignalFrame → ganglior.node-export via HRVDex's PUBLIC headless compute ──
  // HRVDex.compute() builds the SAME ganglior.node-export HRVDex.html exportGanglior emits
  // (hrv_low measured + stress_high heuristic/derived). The welltory-summary adapter already
  // applied the Baevsky unit guard + stamped provenance.derived at ingest; that flag rides in.
  function emitSummaryNodeExport(frame, hw) {
    hw = hw || _hrvWin;
    if (!(hw && hw.HRVDex && typeof hw.HRVDex.compute === 'function')) throw new Error('signal-orchestrate: HRVDex.compute unavailable (co-load the namespaced hrvdex-dsp.js)');
    var ingest = {
      adapter: frame.provenance.adapter,
      vendor: frame.provenance.vendor,
      device: frame.provenance.device,
      via: frame.provenance.via || 'signal-orchestrate',
      derived: frame.provenance.derived || false
    };
    return hw.HRVDex.compute(frame, {
      kernel: hw.DexKernel || root.DexKernel || null,
      ingest: ingest
    });
  }

  // glucoHost(): GlucoDex CGM host shim. GlucoDex is a co-load global (same realm,
  // not an iframe), so this resolves immediately once window.GlucoDex is present —
  // no _await iframe boot needed. Mirror shape of oxyHost for call-site uniformity.
  function glucoHost() {
    if (_glucoReady) return _glucoReady;
    _glucoReady = _await('GlucoDex').then(function () {
      _glucoWin = { GlucoDex: root.GlucoDex, DexKernel: root.DexKernel };
      return _glucoWin;
    });
    return _glucoReady;
  }
  function glucoWin() {
    return _glucoWin;
  }

  // ppgHost(): PpgDex raw-PPG host shim. PpgDex is a co-load global (same realm, not an
  // iframe), so this resolves immediately once window.PpgDex is present. Mirrors glucoHost.
  function ppgHost() {
    if (_ppgReady) return _ppgReady;
    _ppgReady = _await('PpgDex').then(function () {
      _ppgWin = { PpgDex: root.PpgDex, DexKernel: root.DexKernel };
      return _ppgWin;
    });
    return _ppgReady;
  }
  function ppgWin() {
    return _ppgWin;
  }

  // ── PPG SignalFrame → ganglior.node-export via PpgDex's PUBLIC headless compute ──
  // PpgDex.compute() runs the real optical beat-detection → self-PPI → HRV pipeline and emits the
  // node-export via the shared ppgBuildNodeExport builder (brief §1B parity). The app's exportGanglior
  // emits the LIGHT export (recording + ganglior_events); the orchestrate path opts into the RICH superset
  // (rich:true below — adds hrv/quality/timeseries) without changing the app's byte-identical light stream. The
  // frame's `samples` PACKS the multi-channel waveform (ch[3]+amb+relSec); compute() reads it
  // straight (the §1 compute()-shape contract — accept the canonical frame, not only {text}).
  function emitPpgNodeExport(frame, pw) {
    pw = pw || _ppgWin;
    if (!(pw && pw.PpgDex && typeof pw.PpgDex.compute === 'function')) throw new Error('signal-orchestrate: PpgDex.compute unavailable (co-load the namespaced ppgdex-dsp.js)');
    var ingest = { adapter: frame.provenance.adapter, vendor: frame.provenance.vendor, device: frame.provenance.device, via: frame.provenance.via || 'signal-orchestrate' };
    return pw.PpgDex.compute(frame, {
      kernel: pw.DexKernel || root.DexKernel || null,
      ingest: ingest,
      source: frame.provenance.adapter || 'signal-orchestrate',
      fname: (frame.provenance.files && frame.provenance.files[0]) || null,
      // rich: carry hrv.time/frequency + quality + timeseries.epochs[].position so a Unifier/OverDex-routed
      // PPG file feeds HRV consensus + (companions §1b) posture (ECG-PPG-FOLLOWUPS-HANDOFF §1 / PPGDEX-FOLLOWUPS §1).
      // The app's exportGanglior() does NOT pass this → its light stream stays byte-identical.
      rich: true,
      offsetMin: frame.offsetMin != null ? frame.offsetMin : null
    });
  }

  // ecgHost(): ECGDex raw-ECG host shim. ECGDex is a co-load global (same realm, not an
  // iframe), so this resolves immediately once window.ECGDex is present. Mirrors ppgHost.
  function ecgHost() {
    if (_ecgReady) return _ecgReady;
    _ecgReady = _await('ECGDex').then(function () {
      _ecgWin = { ECGDex: root.ECGDex, DexKernel: root.DexKernel };
      return _ecgWin;
    });
    return _ecgReady;
  }
  function ecgWin() {
    return _ecgWin;
  }

  // ── ECG SignalFrame → ganglior.node-export via ECGDex's PUBLIC headless compute ──
  // ECGDex.compute() runs the real band-pass → Pan-Tompkins R-peak (NO Worker — the pure
  // detector inside analyze()) → per-beat SQI → HRV → CVHR/apnea pipeline and emits the node-export
  // via the shared ecgBuildNodeExport builder (brief §1B parity). The app's exportGanglior emits the
  // LIGHT export (recording + ganglior_events); the orchestrate path opts into the RICH superset
  // (rich:true below — adds hrv/quality/timeseries/sleep) without changing the byte-identical light stream. ECG is SINGLE-channel,
  // so the frame's `samples` is a plain Int16Array + fs/t0Ms on the frame (NOT PpgDex's packed
  // multi-channel object — PPGDEX-FOLLOWUPS §8); compute() reads it straight (the §1 compute()-
  // shape contract — accept the canonical frame, not only {text}).
  function emitEcgNodeExport(frame, ew) {
    ew = ew || _ecgWin;
    if (!(ew && ew.ECGDex && typeof ew.ECGDex.compute === 'function')) throw new Error('signal-orchestrate: ECGDex.compute unavailable (co-load the namespaced ecgdex-dsp.js)');
    var ingest = { adapter: frame.provenance.adapter, vendor: frame.provenance.vendor, device: frame.provenance.device, via: frame.provenance.via || 'signal-orchestrate' };
    return ew.ECGDex.compute(frame, {
      kernel: ew.DexKernel || root.DexKernel || null,
      ingest: ingest,
      source: frame.provenance.adapter || 'signal-orchestrate',
      fname: (frame.provenance.files && frame.provenance.files[0]) || null,
      // rich: carry the whole-record HRV axis + quality + timeseries.epochs[].position + sleep so a
      // Unifier/OverDex-routed ECG file feeds HRV consensus + (companions §2b) posture (ECG-PPG-FOLLOWUPS-HANDOFF
      // §1 / ECGDEX-FOLLOWUPS-II §2). The app's exportGanglior() does NOT pass this → light stream byte-identical.
      rich: true,
      offsetMin: frame.offsetMin != null ? frame.offsetMin : null
    });
  }

  // ── CGM SignalFrame → ganglior.node-export via GlucoDex's PUBLIC headless compute ──
  // GlucoDex.compute() runs the real parseCSV→analyze pipeline and emits the light
  // node-export (recording + ganglior_events) — the SAME shape glucodex-app.js
  // exportGanglior emits, via the shared glucoBuildNodeExport builder (brief §1B parity).
  function emitCgmNodeExport(frame, gw) {
    gw = gw || _glucoWin;
    if (!(gw && gw.GlucoDex && typeof gw.GlucoDex.compute === 'function')) throw new Error('signal-orchestrate: GlucoDex.compute unavailable (co-load the namespaced glucodex-dsp.js)');
    var ingest = { adapter: frame.provenance.adapter, vendor: frame.provenance.vendor, device: frame.provenance.device, via: frame.provenance.via || 'signal-orchestrate' };
    return gw.GlucoDex.compute(frame, {
      kernel: gw.DexKernel || root.DexKernel || null,
      ingest: ingest,
      source: frame.provenance.adapter || 'signal-orchestrate'
    });
  }

  // cpapHost(): CPAPDex PAP-therapy host shim. CPAPDex is a co-load global (same realm,
  // not an iframe), so this resolves once window.CPAPDex is present. Mirrors ecgHost.
  function cpapHost() {
    if (_cpapReady) return _cpapReady;
    _cpapReady = _await('CPAPDex').then(function () {
      _cpapWin = { CPAPDex: root.CPAPDex, DexKernel: root.DexKernel };
      return _cpapWin;
    });
    return _cpapReady;
  }
  function cpapWin() {
    return _cpapWin;
  }

  // ── CPAP SignalFrame → ganglior.node-export via CPAPDex's PUBLIC headless compute ──
  // GENERIC-EMIT-GATE-FOLLOWUPS-I §1 frame-shape decision: a SignalFrame has NO event carrier,
  // but CPAPDex's headline value is the device-scored EVE/CSL events from the EDF annotations.
  // So the canonical `cpap` frame carries the 25 Hz BRP FLOW waveform in `samples` (so it
  // validates) PLUS the decoded multi-signal set(s) as a `frame.edfSets` SIDECAR (the
  // ECG-companion pattern). CPAPDex.compute reads the sidecar straight — buildSessionFromEdf
  // → buildNight → CpapFusion.cpapBuildExport (the SAME shared builder the app's exportNight
  // uses, so the Unifier/OverDex export is byte-identical). EDF binary ingest itself stays the
  // CPAPDex APP's job (the readAsText host boundary can't carry binary), so there is no
  // text-stream adapter; canEmit('cpap') + this emitter are the gated emit path (DRIVER 2).
  function emitCpapNodeExport(frame, cw) {
    cw = cw || _cpapWin;
    if (!(cw && cw.CPAPDex && typeof cw.CPAPDex.compute === 'function')) throw new Error('signal-orchestrate: CPAPDex.compute unavailable (co-load the namespaced cpapdex-dsp.js + cpapdex-fusion.js)');
    var ingest = { adapter: frame.provenance.adapter, vendor: frame.provenance.vendor, device: frame.provenance.device, via: frame.provenance.via || 'signal-orchestrate' };
    return cw.CPAPDex.compute(frame, {
      kernel: cw.DexKernel || root.DexKernel || null,
      ingest: ingest,
      fname: (frame.provenance.files && frame.provenance.files[0]) || null,
      offsetMin: frame.offsetMin != null ? frame.offsetMin : null
    });
  }

  // ── node-export one-line summary (SIGNAL-ADAPTER-FOLLOWUPS-II §5 / -III §3) ──
  // ONE node-agnostic summarizer keyed on exp.schema.node, shared by BOTH surfaces
  // (OverDex _computedDetail · the Unifier _emitNote) so the per-node one-liner lives
  // in ONE place instead of being copy-branched in two files (and drifting). Each new
  // migrated node adds ONE case here, nowhere else. Falls back to payload-shape sniffing
  // for a pre-schema export, then to 'computed'.
  function nodeExportSummary(exp) {
    if (!exp) return 'computed';
    var node = exp.schema && exp.schema.node;
    var nEv = Array.isArray(exp.ganglior_events) ? exp.ganglior_events.length : 0;
    if (node === 'PulseDex' || (exp.hrv && exp.hrv.time)) {
      var rm = exp.hrv && exp.hrv.time && exp.hrv.time.rmssd != null ? exp.hrv.time.rmssd : '—';
      return nEv + ' events · rmssd ' + rm;
    }
    if (node === 'OxyDex' || (Array.isArray(exp.nights) && exp.nights[0])) {
      var nn = (exp.nights && exp.nights[0]) || {};
      var odi = nn.odi4 && nn.odi4.rate != null ? nn.odi4.rate : '—';
      var mn = nn.stats && nn.stats.minSpo2 != null ? nn.stats.minSpo2 : '—';
      return 'ODI ' + odi + ' · minSpO₂ ' + mn + '%';
    }
    if (node === 'HRVDex' || (exp.recording && exp.recording.source === 'welltory')) {
      return nEv + ' events · ' + ((exp.recording && exp.recording.measurements) || 0) + ' measurements';
    }
    if (node === 'GlucoDex') {
      return nEv + ' glycemic events · ' + (exp.recording && exp.recording.events != null ? exp.recording.events : nEv) + ' readings';
    }
    if (node === 'PpgDex') {
      return nEv + ' events · raw wrist-PPG';
    }
    if (node === 'ECGDex') {
      return nEv + ' events · raw ECG';
    }
    if (node === 'CPAPDex') {
      var nS = exp.recording && exp.recording.sessionCount != null ? exp.recording.sessionCount : exp.recording && Array.isArray(exp.recording.sessions) ? exp.recording.sessions.length : '?';
      var ahi = exp.metrics && exp.metrics.residualAHI != null ? exp.metrics.residualAHI : '—';
      return nEv + ' events · AHI ' + ahi + ' · ' + nS + ' session' + (nS === 1 ? '' : 's');
    }
    return 'computed';
  }

  // ── unified dispatch (SIGNAL-ADAPTER-FOLLOWUPS-II §4) ─────────────────────
  // ONE entry routing on frame.signalType, so OverDex / the Unifier stop branching a
  // per-signal switch at every call site. The three emit*NodeExport above stay as named
  // wrappers (call sites + the source-mirror gate reference them by name). Resolves the
  // cached host shim itself; the caller still boots the relevant host first.
  function emitNodeExport(frame, host) {
    var st = frame && frame.signalType;
    if (st === 'rr') return emitRRNodeExport(frame, host || _win);
    if (st === 'spo2') return emitSpO2NodeExport(frame, host || _oxyWin);
    if (st === 'hrv') return emitSummaryNodeExport(frame, host || _hrvWin);
    if (st === 'cgm') return emitCgmNodeExport(frame, host || _glucoWin);
    if (st === 'ppg') return emitPpgNodeExport(frame, host || _ppgWin);
    if (st === 'ecg') return emitEcgNodeExport(frame, host || _ecgWin);
    if (st === 'cpap') return emitCpapNodeExport(frame, host || _cpapWin);
    throw new Error('signal-orchestrate: no compute path for signalType "' + st + '"');
  }

  // ── COMPANION PAIRING (ECG-PPG-FOLLOWUPS-HANDOFF §2(b)) ──────────────────────
  // A multi-stream node (ECGDex `*_ECG.txt`, PpgDex `*_PPG.txt`) is captured by Polar Sensor
  // Logger as a PRIMARY waveform + device sidecars (ECG: _RR/_HR/_ACC; PPG: _ACC/_GYRO/_MAGN/_PPI),
  // all sharing ONE `YYYYMMDD_HHMMSS` filename stamp. The single-text adapter boundary drops them;
  // this lifts the apps' loadFiles nearest-by-stamp pairing into ONE shared place both hosts (Data
  // Unifier · OverDex) call, so the matched companion TEXT rides to the adapter via ctx.companions →
  // the frame → compute(). Pairs by FILENAME stamp (known before parsing; PSL stamps every stream of
  // one recording identically), so no chicken-and-egg with the not-yet-parsed frame's t0Ms.
  var _COMPANION_KINDS = { ecg: ['rr', 'hr', 'acc'], ppg: ['acc', 'gyro', 'magn', 'ppi'] };
  function companionKinds(signalType) {
    return (_COMPANION_KINDS[signalType] || []).slice();
  }
  function streamKind(name) {
    var u = String(name == null ? '' : name).toUpperCase();
    if (/_ECG\b|_ECG\./.test(u)) return 'ecg';
    if (/_PPG\b|_PPG\./.test(u)) return 'ppg';
    if (/_GYRO\b|_GYRO\./.test(u)) return 'gyro';
    if (/_MAGN\b|_MAGN\./.test(u)) return 'magn';
    if (/_ACC\b|_ACC\./.test(u)) return 'acc';
    if (/_PPI\b|_PPI\./.test(u)) return 'ppi';
    if (/_HR\b|_HR\./.test(u)) return 'hr';
    if (/_RR\b|_RR\./.test(u)) return 'rr';
    return null;
  }
  // Floating wall-clock ms (Clock Contract) from a filename stamp. Resolution order matters:
  //
  //   (1) ANCHORED after a Polar device id — the same shape dex-ingest.js:stampMs uses. The old
  //       single unanchored pattern below ate a NUMERIC device id as the date: on the real corpus
  //       `Polar_H10_02849638_20260617_010616_ACC.txt` parsed as year 0284 (it consumed `0284|96|38`
  //       then took `20|26|06` — i.e. only the MONTH digits of the true date), so every H10 file in a
  //       given month collapsed to ONE stamp. pairCompanions' nearest-stamp tiebreak then degraded to
  //       "first candidate of that kind": measured 147/153 wrong-night pairings across 51 ECG primaries
  //       (ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF §1.1). A LETTERED id (`0C301E3F`, or the
  //       `AAAA`/`X` ids the older tests used) can't be misread as digits, which is why it hid so long.
  //   (2) Year-restricted general fallback — keeps NON-Polar vendors stamping exactly as before, but
  //       requires a plausible `20xx` year so a numeric id can no longer masquerade as one.
  //
  // Do NOT collapse these back into one loose pattern.
  function fnameStampMs(name) {
    var s = String(name == null ? '' : name);
    var m =
      s.match(/^POLAR_[A-Z0-9]+_[A-Z0-9]+_(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/i) ||
      s.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; // floating wall-clock (Clock Contract)
  }
  // §1 (ECG-INGEST-FOLLOWUPS-II) — device identity + foreign-vendor classification are NO LONGER
  // declared here. pairCompanions now consults the ONE shared registry (dex-ingest.js / DexIngest) —
  // the SAME surface ecgdex-app.js + ppgdex-app.js use — so deviceKey/foreignVendor cannot drift
  // across the app and host ingest paths (the classic two-copy trap this fold closes; the deferred
  // AND-FRONTIER (b)). dex-ingest.js is pure + headless like this module and is co-loaded BEFORE
  // signal-orchestrate.js in all four hosts (Data Unifier · OverDex · Dex-Test-Suite ·
  // tests/run-tests.mjs). Resolve it at call-time and fail LOUD if a host forgot to co-load it
  // (never silently mis-pair). streamKind/fnameStampMs stay LOCAL — no DexIngest equivalent (generic
  // name→kind + a loose any-name stamp parse, vs DexIngest's node-specific Polar-anchored classifiers).
  function _ingest() {
    var DI = root.DexIngest;
    if (!(DI && typeof DI.deviceKey === 'function' && typeof DI.foreignVendor === 'function'))
      throw new Error('signal-orchestrate: DexIngest not found on host — load dex-ingest.js BEFORE signal-orchestrate.js (Data Unifier / OverDex / both test runners)');
    return DI;
  }
  // entries: [{ name, text }] (the whole drop). Returns { kind: text } for the signalType's companion
  // kinds, each = the same-DEVICE same-kind sidecar with the nearest filename stamp to the primary
  // (the primary itself is excluded). A kind with no match is omitted; no companions at all → null.
  // §1 (ECG-INGEST-FOLLOWUPS): the device-id filter is the cross-host analogue of the app fix — a
  // folder-walk that contains BOTH a Verity-Sense and an H10 session no longer cross-pairs a
  // Sense `_ACC` onto an H10 `_ECG` by nearest stamp; only a same-device (or bare) sidecar attaches.
  function pairCompanions(signalType, primaryName, entries) {
    var kinds = _COMPANION_KINDS[signalType];
    if (!kinds || !Array.isArray(entries) || !entries.length) return null;
    var DI = _ingest(); // §1-II: the shared dex-ingest.js registry (deviceKey / foreignVendor)
    var ref = fnameStampMs(primaryName);
    var primDev = DI.deviceKey(primaryName);
    var out = {},
      any = false;
    for (var ki = 0; ki < kinds.length; ki++) {
      var kind = kinds[ki],
        best = null,
        bd = Infinity;
      for (var ei = 0; ei < entries.length; ei++) {
        var e = entries[ei];
        if (!e || e.name === primaryName || streamKind(e.name) !== kind) continue;
        if (DI.foreignVendor(e.name)) continue; // an O2Ring SpO₂ / Libre CGM file is never a sidecar
        // device-id filter: when BOTH names carry a Polar device id they must MATCH (a Verity-Sense
        // `_ACC` never attaches to an H10 `_ECG`, even when its stamp is the nearer one); a bare /
        // non-Polar candidate (cdev null) falls back to nearest-stamp, as before.
        var cdev = DI.deviceKey(e.name);
        if (primDev && cdev && primDev !== cdev) continue;
        var d = Math.abs((fnameStampMs(e.name) || 0) - (ref || 0));
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best && best.text) {
        out[kind] = best.text;
        any = true;
      }
    }
    return any ? out : null;
  }

  // signalTypes that HAVE a compute()/emit path (the migrated nodes). Auxiliary channels
  // (acc/hr companions) are NOT emitters. The Data Unifier + OverDex gate their emit UI on this
  // so a newly-migrated node lights up in ONE place, not per-host (HOST-EMIT-ALLOWLIST-2026-06-27).
  var _EMITTABLE = { rr: 1, spo2: 1, hrv: 1, cgm: 1, ppg: 1, ecg: 1, cpap: 1 };
  function canEmit(signalType) {
    return !!_EMITTABLE[signalType];
  }
  // emittableTypes(): the LIVE emit-allowlist keys — the durable accessor the generic-emit gate
  // prefers over parsing THIS file's source (GENERIC-EMIT-GATE-FOLLOWUPS-II §3). Reading the runtime
  // object is immune to source-format drift (a nested `}` in a future structured _EMITTABLE value, a
  // reformat, a stray comment-brace) that could silently truncate a regex parse of the literal. Inert
  // at runtime — the apps gate emit on canEmit(), nothing reads this — so adding it needs NO app
  // re-bundle (same inert-shared-module-addition rule as MetricRegistry.BADGE_CSS; see CLAUDE.md).
  function emittableTypes() {
    return Object.keys(_EMITTABLE);
  }

  root.SignalOrchestrate = {
    pulseHost: pulseHost,
    pulseWin: pulseWin,
    emitRRNodeExport: emitRRNodeExport,
    oxyHost: oxyHost,
    oxyWin: oxyWin,
    emitSpO2NodeExport: emitSpO2NodeExport,
    hrvHost: hrvHost,
    hrvWin: hrvWin,
    emitSummaryNodeExport: emitSummaryNodeExport,
    glucoHost: glucoHost,
    glucoWin: glucoWin,
    emitCgmNodeExport: emitCgmNodeExport,
    ppgHost: ppgHost,
    ppgWin: ppgWin,
    emitPpgNodeExport: emitPpgNodeExport,
    ecgHost: ecgHost,
    ecgWin: ecgWin,
    emitEcgNodeExport: emitEcgNodeExport,
    cpapHost: cpapHost,
    cpapWin: cpapWin,
    emitCpapNodeExport: emitCpapNodeExport,
    emitNodeExport: emitNodeExport,
    nodeExportSummary: nodeExportSummary,
    companionKinds: companionKinds,
    streamKind: streamKind,
    fnameStampMs: fnameStampMs,
    pairCompanions: pairCompanions,
    canEmit: canEmit,
    emittableTypes: emittableTypes
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
