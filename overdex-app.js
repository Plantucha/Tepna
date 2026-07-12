/*
 * overdex-app.js — Tepna OverDex: one-drop folder → route → run → fuse
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ════════════════════════════════════════════════════════════════════════
 * The capstone consumer (brief Phase 10). Point it at a FOLDER of mixed raw
 * exports from any device; it walks the tree, identifies each file, runs the
 * right node(s), and hands every result to the Integrator — one drop, one fused
 * result out. OverDex is a CONSUMER that sits ON TOP, exactly like the
 * Integrator — never a coupler.
 *
 * 🔒 THE INDEPENDENCE INVARIANT (non-negotiable): OverDex makes NO Dex depend on
 * any other Dex. It reuses the SAME public seams everything else does —
 *   · router      = SignalAdapters.route()        (shared, brief §2.4)
 *   · node compute= SignalOrchestrate.emitNodeExport()  (shared, co-loaded namespaced DSPs)
 *   · fusion      = IntegratorDSP (normalizeFile → dedupeRecs → runFusion)
 *   · the bus     = ganglior.node-export JSON  (the only cross-node contract)
 * No node imports OverDex; OverDex imports no node's internals. Delete OverDex
 * and every node + the Integrator work byte-identically.
 *
 * Two ways a file becomes a node-export to fuse:
 *   (a) RAW vendor file an adapter recognizes (Polar/Coospo RR …) → SignalFrame
 *       → run the node's real DSP → ganglior.node-export.
 *   (b) an ALREADY-EXPORTED ganglior.node-export JSON (any node) → pass straight
 *       through to the Integrator (this is how nodes WITHOUT an adapter yet —
 *       OxyDex/GlucoDex — still fuse: drop their *_ganglior.json).
 * Unknown files are SET ASIDE (never guessed); ambiguous routes are surfaced for
 * the user to confirm.
 * ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var WALK = window.OverDexWalk, REG = window.SignalAdapters, SF = window.SignalFrame,
      ORCH = window.SignalOrchestrate, D = window.IntegratorDSP;

  // ── file IO ────────────────────────────────────────────────────────────
  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(r.error || new Error('read error')); };
      r.readAsText(file);
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  // Node-agnostic one-line summary of a computed node-export — delegates to the ONE
  // shared summarizer in signal-orchestrate.js (SIGNAL-ADAPTER-FOLLOWUPS-II §5 / -III §3),
  // so the per-node one-liner is no longer copy-branched here AND in the Data Unifier.
  function _computedDetail(c) {
    return (window.SignalOrchestrate && window.SignalOrchestrate.nodeExportSummary)
      ? window.SignalOrchestrate.nodeExportSummary(c) : 'computed';
  }
  function fmtClock(ms) { if (ms == null) return '—'; var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); }

  // ── classify one walked file (cheap: route by name + head, then JSON sniff) ──
  // Returns { file, relPath, klass, route?, node?, json?, signalType?, note? }
  // klass ∈ 'raw' (adapter-routed) | 'export' (ready node-export) | 'ambiguous' | 'unknown' | 'error'
  function classify(file, text) {
    var relPath = WALK.relOf(file);
    var head = (text || '').slice(0, 2048);
    var r = REG.route({ name: file.name }, head);
    if (r.best) {
      if (r.ambiguous) {
        return { file: file, relPath: relPath, klass: 'ambiguous', route: r,
          note: 'best ' + r.best.vendor + ' (' + r.best.confidence.toFixed(2) + ') vs ' + r.runnerUp.vendor + ' (' + r.runnerUp.confidence.toFixed(2) + ')' };
      }
      return { file: file, relPath: relPath, klass: 'raw', route: r, signalType: r.best.signalType,
        node: (r.best.signalType === 'spo2' ? 'OxyDex' : r.best.signalType === 'hrv' ? 'HRVDex' : 'PulseDex'), adapter: r.best.adapter, vendor: r.best.vendor };
    }
    // not adapter-routable → is it an already-exported ganglior.node-export?
    var json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    if (json && typeof json === 'object') {
      var res = D.normalizeFile(json, file.name);
      if (res.recs && res.recs.length) {
        var node = res.recs[0].node;
        return { file: file, relPath: relPath, klass: 'export', json: json, node: node,
          nRecs: res.recs.length, warnings: res.warnings || [] };
      }
      return { file: file, relPath: relPath, klass: 'unknown', note: 'JSON, but not a recognized node-export (no fusible records)' };
    }
    return { file: file, relPath: relPath, klass: 'unknown', note: 'no adapter matched and not a node-export JSON — set aside, never guessed' };
  }

  // ════════════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════════════
  var ITEMS = [];          // classified files
  var FUSION = null, FUSED_EXPORT = null;

  // ── walk + classify a dropped/picked pile ───────────────────────────────
  function ingest(files) {
    if (!files || !files.length) return;
    setStatus('reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…', 'run');
    FUSION = null; FUSED_EXPORT = null;
    Promise.all(files.map(function (f) {
      return readText(f).then(function (t) { f.__text = t; return classify(f, t); },
        function (e) { return { file: f, relPath: WALK.relOf(f), klass: 'error', note: 'read error: ' + e.message }; });
    })).then(function (items) {
      ITEMS = items;
      renderManifest();
      var counts = tally();
      setStatus(counts.raw + ' raw · ' + counts.export + ' node-export · ' + counts.ambiguous + ' ambiguous · ' + counts.unknown + ' set aside', 'idle');
    });
  }

  function tally() {
    var c = { raw: 0, export: 0, ambiguous: 0, unknown: 0, error: 0 };
    ITEMS.forEach(function (it) { c[it.klass] = (c[it.klass] || 0) + 1; });
    return c;
  }

  // ── RUN & FUSE ──────────────────────────────────────────────────────────
  async function runAndFuse() {
    if (!ITEMS.length) return;
    var needPulse = ITEMS.some(function (it) { return it.klass === 'raw' && it.signalType === 'rr'; })
                 || ITEMS.some(function (it) { return it.klass === 'ambiguous' && it.resolvedTo && it.resolvedTo.signalType === 'rr'; });
    var needOxy = ITEMS.some(function (it) { return it.klass === 'raw' && it.signalType === 'spo2'; })
               || ITEMS.some(function (it) { return it.klass === 'ambiguous' && it.resolvedTo && it.resolvedTo.signalType === 'spo2'; });
    var needHrv = ITEMS.some(function (it) { return it.klass === 'raw' && it.signalType === 'hrv'; })
               || ITEMS.some(function (it) { return it.klass === 'ambiguous' && it.resolvedTo && it.resolvedTo.signalType === 'hrv'; });
    var pw = null, ow = null, hw = null;
    if (needPulse) {
      setStatus('loading PulseDex compute…', 'run');
      try { pw = await ORCH.pulseHost(); } catch (e) { setStatus('PulseDex host failed: ' + e.message, 'bad'); return; }
    }
    if (needOxy) {
      setStatus('loading OxyDex compute…', 'run');
      try { ow = await ORCH.oxyHost(); } catch (e) { setStatus('OxyDex host failed: ' + e.message, 'bad'); return; }
    }
    if (needHrv) {
      setStatus('loading HRVDex compute…', 'run');
      try { hw = await ORCH.hrvHost(); } catch (e) { setStatus('HRVDex host failed: ' + e.message, 'bad'); return; }
    }
    setStatus('routing → running nodes → fusing…', 'run');

    var exports = [];     // { json, label, from }
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      try {
        if (it.klass === 'export') {
          exports.push({ json: it.json, label: it.relPath, from: 'node-export ' + it.node });
        } else if (it.klass === 'raw' || (it.klass === 'ambiguous' && it.resolvedTo)) {
          var adapter = (it.klass === 'raw') ? it.adapter : it.resolvedTo.adapter;
          var sigType = (it.klass === 'raw') ? it.signalType : it.resolvedTo.signalType;
          var ctx = { files: [it.relPath] };
          if (sigType === 'rr' && pw) ctx.parseRRInput = pw.parseRRInput;
          if (sigType === 'spo2' && ow) ctx.parseCSV = ow.parseCSV;
          if (sigType === 'hrv' && hw) ctx.parseRows = hw.HRVDex.parseRows;
          // companion-bundle ingest (ECG/PPG multi-file): pair matched device sidecars by filename
          // stamp across the walked drop so the adapter attaches them to the frame (HANDOFF §2(b)).
          if ((sigType === 'ecg' || sigType === 'ppg') && ORCH && typeof ORCH.pairCompanions === 'function') {
            var _ents = []; for (var ci = 0; ci < ITEMS.length; ci++) { var cit = ITEMS[ci]; if (cit && cit.file) _ents.push({ name: cit.file.name, text: cit.file.__text }); }
            var comps = ORCH.pairCompanions(sigType, it.file.name, _ents);
            if (comps) ctx.companions = comps;
          }
          var frame = REG.runAdapter(adapter, it.file.__text, ctx);
          var valid = SF.validateFrame(frame);
          it.frame = frame; it.valid = valid;
          if (frame && frame.usable && valid.ok && ORCH.canEmit(sigType)) {
            var exp = ORCH.emitNodeExport(frame);   // signalType-dispatched (rr/spo2/hrv) — §-II 4
            if (exp && exp.schema && exp.schema.ingest) exp.schema.ingest.via = 'OverDex';
            it.computed = exp;
            exports.push({ json: exp, label: it.relPath, from: 'computed ' + (frame.provenance.adapter) });
          } else {
            it.runNote = frame && !frame.usable ? ('unusable frame: ' + (frame.reason || '?')) : (valid && !valid.ok ? valid.errors.join('; ') : 'no compute path for ' + sigType);
          }
        }
      } catch (e) { it.runNote = 'run error: ' + e.message; }
    }

    if (!exports.length) { setStatus('nothing fusible — drop raw RR / O2Ring files or node-export JSON', 'bad'); renderManifest(); renderFusion(null, []); return; }

    // ── feed the Integrator (the exact public seam integrator-app.js uses) ──
    var RECS = [], WARN = [];
    exports.forEach(function (e) {
      var res = D.normalizeFile(e.json, e.label);
      (res.warnings || []).forEach(function (w) { WARN.push(w); });
      if (res.recs && res.recs.length) {
        var dd = D.dedupeRecs(RECS, res.recs);
        (dd.warns || []).forEach(function (w) { WARN.push(w); });
        dd.kept.forEach(function (r) { RECS.push(r); });
      }
    });
    FUSION = D.runFusion(RECS, { toleranceSec: 120 });
    FUSED_EXPORT = D.buildFusionExport(RECS, FUSION);

    renderManifest();
    renderFusion(FUSION, exports, WARN, RECS);
    var ap = FUSION.apnea;
    setStatus('fused ' + RECS.length + ' recording' + (RECS.length === 1 ? '' : 's') + ' · ' + FUSION.findings.length + ' finding' + (FUSION.findings.length === 1 ? '' : 's'), 'done');
  }

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  var manifestEl, fusionEl, statusEl;
  function setStatus(t, cls) { if (statusEl) { statusEl.textContent = t; statusEl.className = 'pill ' + (cls || 'idle'); } }

  var KLASS_META = {
    raw:       { dot: 'teal',  tag: 'raw → run',     desc: 'adapter recognized — node DSP will run live' },
    export:    { dot: 'green', tag: 'node-export',   desc: 'ready ganglior.node-export — passes straight to fusion' },
    ambiguous: { dot: 'amber', tag: 'ambiguous',     desc: 'two adapters tie — confirm which vendor' },
    unknown:   { dot: 'red',   tag: 'set aside',     desc: 'unrecognized — never guessed' },
    error:     { dot: 'red',   tag: 'read error',    desc: '' }
  };

  function renderManifest() {
    if (!ITEMS.length) { manifestEl.innerHTML = ''; return; }
    var order = ['raw', 'export', 'ambiguous', 'unknown', 'error'];
    var groups = {};
    ITEMS.forEach(function (it, i) { it._idx = i; (groups[it.klass] = groups[it.klass] || []).push(it); });
    var html = '';
    order.forEach(function (k) {
      var g = groups[k]; if (!g || !g.length) return;
      var meta = KLASS_META[k];
      html += '<div class="grp">';
      html += '<div class="grphead"><span class="dot ' + meta.dot + '"></span>' +
        '<span class="grptag">' + meta.tag + '</span><span class="grpn">' + g.length + '</span>' +
        '<span class="grpdesc">' + esc(meta.desc) + '</span></div>';
      g.forEach(function (it) {
        var right = '';
        if (k === 'raw') right = '<span class="vendor">' + esc(it.vendor) + '</span> <span class="sig">' + esc(it.signalType) + '</span> → <b>' + esc(it.node) + '</b>' + (it.runNote ? ' <span class="warn">· ' + esc(it.runNote) + '</span>' : (it.computed ? ' <span class="ok">· ' + _computedDetail(it.computed) + '</span>' : ''));
        else if (k === 'export') right = '<b>' + esc(it.node) + '</b> <span class="muted">' + (it.nRecs > 1 ? it.nRecs + ' recs' : '1 rec') + '</span>';
        else if (k === 'ambiguous') right = ambiguousControl(it);
        else right = '<span class="muted">' + esc(it.note || '') + '</span>';
        html += '<div class="row"><span class="path">' + esc(it.relPath) + '</span><span class="rt">' + right + '</span></div>';
      });
      html += '</div>';
    });
    manifestEl.innerHTML = html;
  }

  function ambiguousControl(it) {
    var cands = it.route.candidates.slice(0, 4);
    var opts = '<option value="">— confirm vendor —</option>' + cands.map(function (c, ci) {
      return '<option value="' + ci + '"' + (it.resolvedTo && it.resolvedTo.adapter === c.adapter ? ' selected' : '') + '>' + esc(c.vendor) + ' / ' + esc(c.signalType) + ' (' + c.confidence.toFixed(2) + ')</option>';
    }).join('') + '<option value="skip"' + (it.skipped ? ' selected' : '') + '>skip — set aside</option>';
    return '<select class="ambsel" data-idx="' + it._idx + '">' + opts + '</select> <span class="muted">' + esc(it.note) + '</span>';
  }

  function renderFusion(fusion, exports, warns, recs) {
    if (!fusion) { fusionEl.innerHTML = ''; fusionEl.style.display = 'none'; return; }
    fusionEl.style.display = 'block';
    var ap = fusion.apnea, hrv = fusion.hrv, w = fusion.window;
    var nodes = fusion.nodes || [];

    // DEEP-AUDIT §21 — OverDex rendered a fused CLINICAL KPI grid while loading no badge engine at
    // all. These are cross-node fusion outputs that belong to no single node's registry, so they are
    // graded the way integrator-render.js grades its own: the fusion layer's epistemic tier on the
    // shared 5-level ladder, rendered through the SAME MetricRegistry.badge so the disc is
    // byte-identical to every node. Counted quantities are `measured`; the corroborated apnea index
    // is `emerging` — the exact tier the Integrator gives the same number.
    var STAT_EV = {
      'recordings fused': { ev: 'measured', cite: 'Count of recordings that routed to a node and produced an export — a counted quantity, not a model.' },
      'overlap (union)': { ev: 'measured', cite: 'Union of the recordings\' time windows on the shared clock — counted, not modelled.' },
      'cross-signal findings': { ev: 'measured', cite: 'Count of coincidences the Integrator confirmed inside the overlap window.' },
      'confirmed apnea idx': { ev: 'emerging', cite: 'Cross-signal corroboration — O₂ desaturation ⟷ autonomic surge in a directional window (AASM ODI framing; Azarbarzin 2019). A corroboration signal, not a scored AHI.' }
    };
    function statBadge(label) {
      var R = window.MetricRegistry, e = STAT_EV[label];
      return R && R.badge && e ? R.badge(e.ev, e.cite) : '';
    }
    function stat(label, val, cls) {
      return '<div class="stat">' + '<div class="sv ' + (cls || '') + '">' + val + '</div><div class="sl">' + statBadge(label) + esc(label) + '</div></div>';
    }

    var apIdx = (ap && ap.confirmedAHI != null) ? ap.confirmedAHI : null;
    var apReportable = ap && ap.confirmedAHIReportable;
    var html = '<div class="fhead"><span class="eyebrow">fused result · Ganglior</span>' +
      '<h2>One folder in, one fused picture out</h2>' +
      '<div class="fsub">Every routed file ran through its node and converged on the Integrator via the <code>ganglior.node-export</code> contract — the same seam the Integrator always uses. No node knew OverDex was here.</div></div>';

    html += '<div class="statgrid">';
    html += stat('recordings fused', recs ? recs.length : nodes.length);
    html += stat('overlap (union)', (w.overlapUnionMin != null ? w.overlapUnionMin + ' min' : '—'));
    html += stat('cross-signal findings', fusion.findings.length, fusion.findings.length ? 'teal' : 'muted');
    html += stat('confirmed apnea idx', apIdx == null ? '—' : apIdx.toFixed(1), apReportable ? 'amber' : 'muted');
    html += '</div>';

    // nodes fused
    html += '<div class="block"><div class="bt">Nodes on the bus</div><div class="chips">';
    nodes.forEach(function (n) {
      var col = D.nodeColor(n.node);
      html += '<span class="chip" style="--c:' + col + '"><span class="cdot"></span>' + esc(n.node) +
        '<span class="cmeta">' + (n.date || (n.dateUnknown ? 'date unknown' : '')) + ' · ' + n.nEvents + ' ev</span></span>';
    });
    html += '</div></div>';

    // findings
    if (fusion.findings.length) {
      html += '<div class="block"><div class="bt">Findings</div><div class="findings">';
      fusion.findings.slice(0, 12).forEach(function (f) {
        var conf = f.conf == null ? '—' : f.conf.toFixed(2);
        html += '<div class="finding"><div class="fr1"><span class="ftype">' + esc(f.type.replace(/_/g, ' ')) + '</span>' +
          '<span class="ftime">' + (f.tMs != null ? fmtClock(f.tMs) : '') + '</span>' +
          '<span class="fconf">conf ' + conf + (f.belowChance ? ' <span class="warn">· below chance</span>' : '') + '</span></div>' +
          (f.note ? '<div class="fnote">' + esc(f.note) + '</div>' : '') + '</div>';
      });
      html += '</div></div>';
    } else {
      html += '<div class="block"><div class="bt">Findings</div><div class="muted small">No cross-signal coincidences in the overlap window — the nodes did not co-witness a fusible event (honest null, not an error). ' +
        (w.nodesExcluded && w.nodesExcluded.length ? 'Excluded (overlap nothing): ' + esc(w.nodesExcluded.join(', ')) + '.' : '') + '</div></div>';
    }

    // HRV consensus
    if (hrv && hrv.blocks && hrv.blocks.length) {
      html += '<div class="block"><div class="bt">HRV consensus</div>';
      hrv.blocks.forEach(function (b) {
        html += '<div class="small ' + (b.qc === 'divergent' ? 'warn' : 'ok') + '">' + esc(b.window) + ' · ' + esc(b.nodes.join(' / ')) + ' — ' + esc(b.note) + '</div>';
      });
      html += '</div>';
    }

    // kernel audit + warnings
    if (fusion.kernelAudit && !fusion.kernelAudit.ok) {
      html += '<div class="block warnbox"><b>Kernel drift:</b> ' + esc(fusion.kernelAudit.mismatches.map(function (m) { return m.node + ' (' + m.status + ')'; }).join(', ')) + ' — built against a different physiology rulebook.</div>';
    }
    if (warns && warns.length) {
      html += '<div class="block"><div class="bt">Ingest notes</div>' + warns.slice(0, 8).map(function (x) { return '<div class="small muted">· ' + esc(x) + '</div>'; }).join('') + '</div>';
    }

    html += '<div class="ffoot"><button id="dlFused">download fused ganglior.fusion-export →</button>' +
      '<span class="muted small">100% local · the per-node apps are untouched and still open standalone</span></div>';

    fusionEl.innerHTML = html;
    var dl = document.getElementById('dlFused');
    if (dl) dl.addEventListener('click', function () {
      // Name through the shared exportName() — recording-anchored to the fusion window start (getUTC*),
      // span-aware. The old now() fallback stamped an UNDATED export with the date of the click: a
      // Clock-Contract fabrication that integrator-app.js already dropped for exactly this reason.
      // No window start → 'undated' (honest). DEEP-AUDIT §17.
      var ws = (FUSION && FUSION.window.startMs != null) ? FUSION.window.startMs : null;
      var we = (FUSION && FUSION.window.endMs != null) ? FUSION.window.endMs : null;
      var span = (ws != null && we != null) ? Math.round((we - ws) / 864e5) : null;
      download(exportName({ node: 'OverDex', t0Ms: ws, kind: 'summary', ext: 'json', spanDays: span }), FUSED_EXPORT);
    });
  }

  function download(name, obj) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }

  // ════════════════════════════════════════════════════════════════════════
  // WIRE
  // ════════════════════════════════════════════════════════════════════════
  function wire() {
    manifestEl = document.getElementById('manifest');
    fusionEl = document.getElementById('fusion');
    statusEl = document.getElementById('status');
    var dropEl = document.getElementById('drop');
    var dirInput = document.getElementById('dir');
    var fileInput = document.getElementById('files');
    var runBtn = document.getElementById('runBtn');

    dropEl.addEventListener('click', function () { dirInput.click(); });
    ['dragenter', 'dragover'].forEach(function (ev) { dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove('over'); }); });
    dropEl.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      WALK.fromDataTransfer(e.dataTransfer).then(ingest);
    });
    dirInput.addEventListener('change', function () { ingest(WALK.fromInput(dirInput.files)); dirInput.value = ''; });
    if (fileInput) fileInput.addEventListener('change', function () { ingest(WALK.fromInput(fileInput.files)); fileInput.value = ''; });
    runBtn.addEventListener('click', runAndFuse);

    // ambiguous-route confirmation
    manifestEl.addEventListener('change', function (e) {
      var sel = e.target.closest && e.target.closest('select.ambsel');
      if (!sel) return;
      var it = ITEMS[+sel.getAttribute('data-idx')];
      var v = sel.value;
      if (v === '' ) { it.resolvedTo = null; it.skipped = false; }
      else if (v === 'skip') { it.resolvedTo = null; it.skipped = true; }
      else { var c = it.route.candidates[+v]; it.resolvedTo = { adapter: c.adapter, signalType: c.signalType, vendor: c.vendor }; it.skipped = false; }
    });

    // adapter inventory
    var inv = document.getElementById('adapters');
    if (inv && REG) {
      inv.innerHTML = REG.list().map(function (a) {
        return '<span class="adp"><b>' + esc(a.id) + '</b> <span class="muted">' + esc(a.signalType) + '</span> ' + esc(a.vendor) + '</span>';
      }).join('');
    }

    // expose for the verifier / programmatic checks
    window.OverDex = { ingest: ingest, runAndFuse: runAndFuse, classify: classify,
      items: function () { return ITEMS; }, fusion: function () { return FUSION; }, fusedExport: function () { return FUSED_EXPORT; } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
