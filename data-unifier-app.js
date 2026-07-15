/*
 * data-unifier-app.js — Tepna universal ingest front-door (UNBUNDLED tool)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * The adapter registry given a drop-zone UI (brief §2.5). Drop any vendor's
 * file → run every registered detect() → route to the best adapter → show the
 * normalized SignalFrame summary + usable/reason → optionally emit a schema-
 * valid ganglior.node-export the Integrator ingests.
 *
 * ✅ §3 CO-LOAD (SIGNAL-ADAPTER-FOLLOWUPS): the migrated DSPs ship a NAMESPACED
 * build, so this page sets window.__DEX_NAMESPACED__=true and co-loads pulsedex/
 * oxydex/hrvdex-dsp.js in ONE realm (no isolation iframe) — each exposes only
 * PulseDex/OxyDex/HRVDex, no bare-global collision. The host shim + the RR/SpO₂/HRV
 * → ganglior.node-export emit live in the SHARED signal-orchestrate.js, so OverDex
 * (Phase 10) reuses the same engine — NOT a second copy (§1). This file is the UI.
 *
 * ROUTER NOTE: the routing core (detect → best/ambiguous/unknown) lives in
 * SignalAdapters.route(); the per-signal compute orchestration lives in
 * SignalOrchestrate (emitNodeExport dispatch). Both are UI-free and reused by OverDex.
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ORCH = window.SignalOrchestrate;
  function pulseHost() {
    return ORCH.pulseHost();
  }
  function oxyHost() {
    return ORCH.oxyHost();
  }
  function hrvHost() {
    return ORCH.hrvHost();
  }
  // Emit through the shared signalType-dispatched entry (SIGNAL-ADAPTER-FOLLOWUPS-II §4),
  // then stamp this surface's `via`. ONE call site for every signal — no per-signal switch.
  function emitNodeExport(frame) {
    var e = ORCH.emitNodeExport(frame);
    if (e && e.schema && e.schema.ingest) e.schema.ingest.via = 'Data Unifier';
    return e;
  }

  // ── file reading ───────────────────────────────────────────────────────────
  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(String(r.result || ''));
      };
      r.onerror = function () {
        reject(r.error || new Error('read error'));
      };
      r.readAsText(file);
    });
  }

  // ── ganglior.node-export emit lives in the shared SignalOrchestrate module
  //    (emitNodeExport, signalType-dispatched) — runs each node's public compute(),
  //    not just its parser. Reused verbatim by OverDex, not a second copy.

  // ── routing one file ────────────────────────────────────────────────────────
  function head(text) {
    return (text || '').slice(0, 2048);
  }

  function processOne(file, text, pw, ow, hw, entries) {
    var REG = window.SignalAdapters,
      SF = window.SignalFrame,
      ORCH = window.SignalOrchestrate;
    var r = REG.route({ name: file.name }, head(text));
    if (r.unknown || !r.best) {
      return { file: file, route: r, frame: null, valid: null, note: 'no adapter recognized this file — set aside, never guessed' };
    }
    var ctx = { files: [file.name] };
    if (r.best.signalType === 'rr' && pw) ctx.parseRRInput = pw.parseRRInput;
    if (r.best.signalType === 'spo2' && ow) ctx.parseCSV = ow.parseCSV;
    if (r.best.signalType === 'hrv' && hw) ctx.parseRows = hw.HRVDex.parseRows;
    // companion-bundle ingest (ECG/PPG are multi-file): pair the matched device sidecars by filename
    // stamp across the whole drop, so the adapter attaches deviceRR/HR/ACC (ECG) or acc/gyro/magn/PPI
    // (PPG) to the frame → compute() gains posture + device cross-checks (HANDOFF §2(b)).
    if ((r.best.signalType === 'ecg' || r.best.signalType === 'ppg') && ORCH && typeof ORCH.pairCompanions === 'function') {
      var comps = ORCH.pairCompanions(r.best.signalType, file.name, entries || []);
      if (comps) ctx.companions = comps;
    }
    var frame = REG.runAdapter(r.best.adapter, text, ctx);
    var valid = SF.validateFrame(frame);
    return { file: file, route: r, frame: frame, valid: valid, pw: pw, ow: ow, hw: hw };
  }

  // ── rendering ───────────────────────────────────────────────────────────────
  var resultsEl, dropEl, emptyEl;
  var _lastExports = [];

  function pillClass(res) {
    if (!res.frame) return 'unknown';
    if (res.frame.usable && res.valid.ok) return 'ok';
    return res.valid.ok ? 'warn' : 'bad';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  // Node-agnostic emit note — delegates to the ONE shared summarizer in
  // signal-orchestrate.js (SIGNAL-ADAPTER-FOLLOWUPS-II §5 / -III §3), so the per-node
  // one-liner is no longer copy-branched here AND in OverDex.
  function _emitNote(exp) {
    return window.SignalOrchestrate && window.SignalOrchestrate.nodeExportSummary ? window.SignalOrchestrate.nodeExportSummary(exp) : 'computed';
  }
  function fmtClock(ms) {
    if (ms == null) return '—';
    var d = new Date(ms),
      p = function (n) {
        return (n < 10 ? '0' : '') + n;
      };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  function renderResult(res, idx) {
    var f = res.frame,
      r = res.route;
    var card = document.createElement('div');
    card.className = 'rescard ' + pillClass(res);

    var best = r.best;
    var routeLine = best
      ? '<span class="vendor">' +
        esc(best.vendor) +
        '</span> <span class="muted">·</span> ' +
        '<span class="sig">' +
        esc(best.signalType) +
        '</span> ' +
        '<span class="conf">detect ' +
        best.confidence.toFixed(2) +
        '</span>' +
        (r.ambiguous ? ' <span class="amb">⚠ ambiguous vs ' + esc(r.runnerUp.vendor) + ' (' + r.runnerUp.confidence.toFixed(2) + ') — confirm</span>' : '')
      : '<span class="amb">unrecognized</span>';

    var body = '';
    if (f) {
      var n = f.kind === 'intervals' ? (f.intervals ? f.intervals.length : 0) : f.samples ? f.samples.length : 0;
      var unit = window.SignalSpec.unitOf(f.signalType);
      body += '<div class="kv"><span>signal</span><b>' + esc(f.signalType) + ' / ' + esc(f.kind) + '</b></div>';
      body += '<div class="kv"><span>' + (f.kind === 'intervals' ? 'intervals' : 'samples') + '</span><b>' + n + ' ' + esc(unit || '') + '</b></div>';
      body += '<div class="kv"><span>t0Ms (floating)</span><b>' + (f.t0Ms == null ? '<i class="muted">null — no stamp</i>' : fmtClock(f.t0Ms)) + '</b></div>';
      body += '<div class="kv"><span>offsetMin</span><b>' + (f.offsetMin == null ? 'null' : f.offsetMin) + '</b></div>';
      body += '<div class="kv"><span>usable</span><b class="' + (f.usable ? 'good' : 'bad') + '">' + f.usable + '</b></div>';
      if (!f.usable && f.reason) body += '<div class="reason">' + esc(f.reason) + '</div>';
      body += '<div class="kv"><span>validateFrame</span><b class="' + (res.valid.ok ? 'good' : 'bad') + '">' + (res.valid.ok ? 'ok' : res.valid.errors.join('; ')) + '</b></div>';
      body += '<div class="prov">adapter <code>' + esc(f.provenance.adapter) + '</code> · kernel <code>' + esc(f.provenance.kernelHash || '—') + '</code></div>';
    } else {
      body += '<div class="reason">' + esc(res.note || 'unrecognized file') + '</div>';
    }

    var canEmit = f && f.usable && res.valid.ok && !!(window.SignalOrchestrate && window.SignalOrchestrate.canEmit(f.signalType));
    card.innerHTML =
      '<div class="reshead"><span class="dot"></span><span class="fname">' +
      esc(res.file.name) +
      '</span>' +
      '<span class="route">' +
      routeLine +
      '</span></div>' +
      '<div class="resbody">' +
      body +
      '</div>' +
      (canEmit ? '<div class="resfoot"><button class="emit" data-idx="' + idx + '">emit ganglior.node-export →</button><span class="emitnote"></span></div>' : '');
    return card;
  }

  function rerender(results) {
    resultsEl.innerHTML = '';
    if (!results.length) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    results.forEach(function (res, i) {
      resultsEl.appendChild(renderResult(res, i));
    });
    _lastExports = results;
  }

  // ── orchestration ───────────────────────────────────────────────────────────
  function setStatus(txt, cls) {
    var p = document.getElementById('status');
    if (p) {
      p.textContent = txt;
      p.className = 'pill ' + (cls || 'idle');
    }
  }

  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f && f.size != null;
    });
    if (!files.length) return;
    setStatus('routing ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…', 'run');
    var pw = null,
      ow = null,
      hw = null;
    try {
      pw = await pulseHost();
    } catch (e) {
      setStatus('RR parser host failed: ' + e.message, 'bad');
    }
    try {
      ow = await oxyHost();
    } catch (e) {
      /* SpO₂ host optional — only needed if an O2Ring file is dropped */
    }
    try {
      hw = await hrvHost();
    } catch (e) {
      /* HRV host optional — only needed if a Welltory summary CSV is dropped */
    }
    // read EVERY file's text up front so ECG/PPG companion sidecars can be paired by stamp (§2(b))
    var entries = [];
    for (var ri = 0; ri < files.length; ri++) {
      try {
        entries.push({ name: files[ri].name, text: await readText(files[ri]) });
      } catch (e) {
        entries.push({ name: files[ri].name, text: '', __err: e.message });
      }
    }
    var results = [];
    for (var i = 0; i < files.length; i++) {
      var ent = entries[i];
      if (ent.__err != null) {
        results.push({ file: files[i], route: { unknown: true, best: null }, frame: null, valid: null, note: 'read error: ' + ent.__err });
        continue;
      }
      try {
        results.push(processOne(files[i], ent.text, pw, ow, hw, entries));
      } catch (e) {
        results.push({ file: files[i], route: { unknown: true, best: null }, frame: null, valid: null, note: 'process error: ' + e.message });
      }
    }
    rerender(results);
    var ok = results.filter(function (r) {
      return r.frame && r.frame.usable && r.valid.ok;
    }).length;
    setStatus(ok + '/' + results.length + ' → valid SignalFrame', ok ? 'done' : 'bad');
  }

  function download(name, obj) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function wire() {
    resultsEl = document.getElementById('results');
    dropEl = document.getElementById('drop');
    emptyEl = document.getElementById('empty');
    var input = document.getElementById('file');

    dropEl.addEventListener('click', function () {
      input.click();
    });
    input.addEventListener('change', function () {
      handleFiles(input.files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.remove('over');
      });
    });
    dropEl.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    resultsEl.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button.emit');
      if (!btn) return;
      var res = _lastExports[+btn.getAttribute('data-idx')];
      if (!res || !res.frame) return;
      var exp = emitNodeExport(res.frame); // signalType-dispatched (rr/spo2/hrv) — §-II 4
      if (!exp) return;
      download((res.frame.provenance.adapter || 'frame') + '_unified_ganglior.json', exp);
      var note = btn.parentElement.querySelector('.emitnote');
      if (note) note.textContent = _emitNote(exp) + ' · drop into Integrator';
    });

    // adapter inventory line
    var inv = document.getElementById('adapters');
    if (inv && window.SignalAdapters) {
      inv.innerHTML = window.SignalAdapters.list()
        .map(function (a) {
          return '<span class="adp"><b>' + esc(a.id) + '</b> <span class="muted">' + esc(a.signalType) + '</span> ' + esc(a.vendor) + '</span>';
        })
        .join('');
    }

    // expose for the verifier / programmatic checks
    window.DataUnifier = { handleFiles: handleFiles, processOne: processOne, emitNodeExport: emitNodeExport, pulseHost: pulseHost };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
