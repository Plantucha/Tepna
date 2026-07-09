/*
 * pat-feasibility.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * PAT feasibility — BATCH driver (PAT-FEASIBILITY-2026-07-08-BRIEF). Drop a whole capture
 * folder: this auto-groups files into nights (Polar Sensor Logger naming), flags every
 * H10 _ECG + Verity _PPG eligible pair, and runs each in a worker lane (pat-feasibility-
 * worker.js) — the raw ECG is multi-MB, so nothing heavy touches the main thread. Per-night
 * summaries fill a table; the aggregate characterises inter-device clock drift across N
 * nights (the point of running >1: turn n=1 into a systematic finding + tell linear-vs-
 * wander for the fix). Click a night to see its per-beat scatter. Ingestion/night-keying
 * mirror sensor-trio-power-analysis.js. 100% local; serve over http://.
 */
(function () {
  'use strict';
  var PHYS_LO = 200, PHYS_HI = 650;   // chest ECG R → ankle PPG foot: longest peripheral PTT + PEP + convention
  var C = { ink: '#e6edf6', mut: '#6f8096', teal: '#3DE0D0', blue: '#58A6FF', amber: '#FFB84D', red: '#FF6B7A', green: '#39D98A' };
  var NIGHTS = {};            // nightKey → { key, label, cand:{ecg:[],ppg:[]}, ecg, ppg }
  var RESULTS = {};           // nightKey → worker result
  var detailWorker = null;

  function el(id) { return document.getElementById(id); }
  function median(a) { if (!a.length) return NaN; var b = a.slice().sort(function (x, y) { return x - y; }); var m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : NaN; }
  function fmtClock(ms) { if (ms == null || !isFinite(ms)) return '—'; var d = new Date(ms), p = function (x) { return (x < 10 ? '0' : '') + x; }; return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); }
  function fmtDate(ms) { if (ms == null || !isFinite(ms)) return '—'; var d = new Date(ms), p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()); }
  function setStatus(t, c) { var p = el('status'); if (p) { p.textContent = t; p.className = 'pill ' + (c || 'idle'); } }

  // ── file classification + night grouping (Polar Sensor Logger naming) ──────
  function classify(file) {
    var n = file.name, mo;
    // anchor the YYYYMMDD_HHMMSS immediately before the kind suffix — a loose \d{8}_\d{6}
    // scan grabs the H10 device serial (H10-01) instead of the date (the zero-nights bug).
    if ((mo = n.match(/_(\d{8})_(\d{6})_ECG\.txt$/i))) return { role: 'ecg', stamp: mo[1] + mo[2] };
    if ((mo = n.match(/_(\d{8})_(\d{6})_PPG\.txt$/i))) return { role: 'ppg', stamp: mo[1] + mo[2] };
    // ACC on BOTH devices → the cross-device drift anchor (H10 chest vs Verity arm)
    if ((mo = n.match(/_(\d{8})_(\d{6})_ACC\.txt$/i))) return { role: /Polar_H10/i.test(n) ? 'ecgacc' : 'ppgacc', stamp: mo[1] + mo[2] };
    return null;
  }
  // sessions starting before noon fold into the PREVIOUS evening (floating civil time)
  function nightKeyOf(stamp) {
    var Y = +stamp.slice(0, 4), M = +stamp.slice(4, 6), D = +stamp.slice(6, 8), h = +stamp.slice(8, 10);
    var ms = Date.UTC(Y, M - 1, D); if (h < 12) ms -= 86400000;
    var d = new Date(ms), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function largest(a) { return (a && a.length) ? a.reduce(function (b, x) { return x.file.size > b.file.size ? x : b; }) : null; }
  function resolvePair(nt) {
    var e = largest(nt.cand.ecg), p = largest(nt.cand.ppg), ea = largest(nt.cand.ecgacc), pa = largest(nt.cand.ppgacc);
    nt.ecg = e ? e.file : null; nt.ppg = p ? p.file : null;
    nt.ecgAcc = ea ? ea.file : null; nt.ppgAcc = pa ? pa.file : null;
  }
  var eligible = function (nt) { return !!(nt.ecg && nt.ppg); };

  function ingestFiles(list) {
    NIGHTS = {}; RESULTS = {};
    for (var i = 0; i < list.length; i++) {
      var f = list[i], c = classify(f); if (!c) continue;
      var nk = nightKeyOf(c.stamp), nt = NIGHTS[nk] || (NIGHTS[nk] = { key: nk, label: nk, cand: { ecg: [], ppg: [], ecgacc: [], ppgacc: [] } });
      nt.cand[c.role].push({ file: f, stamp: c.stamp });
    }
    Object.keys(NIGHTS).forEach(function (k) { resolvePair(NIGHTS[k]); });
    renderNightTable();
    var keys = Object.keys(NIGHTS), elig = keys.filter(function (k) { return eligible(NIGHTS[k]); }).length;
    setStatus(keys.length + ' nights · ' + elig + ' eligible (from ' + list.length + ' files)', keys.length ? 'idle' : 'idle');
    var pb = el('run'); if (pb) pb.disabled = elig === 0;
    var tag = el('nightTag'); if (tag) tag.textContent = keys.length + ' nights · ' + elig + ' eligible';
  }

  function renderNightTable() {
    var tb = el('nightBody'); if (!tb) return; tb.innerHTML = '';
    var keys = Object.keys(NIGHTS).sort();
    if (!keys.length) { tb.innerHTML = '<tr><td colspan="7" class="muted">Drop a capture folder to index nights.</td></tr>'; return; }
    keys.forEach(function (k) {
      var nt = NIGHTS[k], ok = eligible(nt), tr = document.createElement('tr');
      tr.setAttribute('data-k', k);
      if (ok) { tr.style.cursor = 'pointer'; tr.addEventListener('click', function () { focusNight(k); }); }
      tr.innerHTML =
        '<td>' + k + '</td>' +
        '<td class="ctr">' + (nt.ecg ? '●' : '<span style="color:#FF6B7A">·</span>') + '</td>' +
        '<td class="ctr">' + (nt.ppg ? '●' : '<span style="color:#FF6B7A">·</span>') + '</td>' +
        '<td class="num" id="c-shared-' + k + '">—</td>' +
        '<td class="num" id="c-coup-' + k + '">—</td>' +
        '<td class="num" id="c-lag-' + k + '">—</td>' +
        '<td class="mono" id="c-vd-' + k + '" style="color:#6f8096">' + (ok ? 'ready' : 'ineligible') + '</td>';
      tb.appendChild(tr);
    });
  }

  function tierColor(t) { return t === 'go' ? C.green : t === 'maybe' ? C.amber : C.red; }
  function setRow(k, m) {
    var sh = el('c-shared-' + k), co = el('c-coup-' + k), lg = el('c-lag-' + k), vd = el('c-vd-' + k);
    if (m.error) { if (vd) { vd.textContent = 'error'; vd.style.color = C.red; vd.title = m.error; } return; }
    if (sh) { sh.textContent = m.sc.ok ? 'yes' : 'no'; sh.style.color = m.sc.ok ? C.green : C.red; }
    if (m.cp.ok) {
      if (co) co.textContent = (m.cp.matchRate * 100).toFixed(0) + '%';
      if (lg) lg.textContent = m.cp.med.toFixed(0) + ' ms';
    }
    if (vd) {
      var corrTxt = (m.cpCorr && m.cpCorr.ok && isFinite(m.cpCorr.driftRange)) ? ' → ' + m.cpCorr.driftRange.toFixed(0) + 'ms✦' : (m.accSync && !m.accSync.available ? ' (no ACC)' : '');
      vd.textContent = m.vd.label + (m.cp.ok && isFinite(m.cp.driftRange) ? ' · ' + m.cp.driftRange.toFixed(0) + 'ms' : '') + corrTxt;
      vd.style.color = tierColor(m.vd.tier);
    }
  }

  // ── worker pool over eligible nights ───────────────────────────────────────
  function runBatch() {
    var nights = Object.keys(NIGHTS).sort().map(function (k) { return NIGHTS[k]; }).filter(eligible);
    if (!nights.length) { setStatus('no eligible night', 'idle'); return; }
    RESULTS = {};
    el('run').disabled = true;
    setStatus('booting workers…', 'run');
    var queue = nights.slice(), total = nights.length, done = 0;
    var N = Math.min(navigator.hardwareConcurrency || 4, Math.max(1, total)), workers = [];
    function feed(w) { if (!queue.length) return; var nt = queue.shift(); setStatus('processing ' + (done + 1) + '/' + total + '…', 'run'); w.postMessage({ type: 'job', key: nt.key, label: nt.label, ecgFile: nt.ecg, ppgFile: nt.ppg, ecgAccFile: nt.ecgAcc, ppgAccFile: nt.ppgAcc, detail: false }); }
    for (var i = 0; i < N; i++) {
      var w = new Worker('pat-feasibility-worker.js');
      w.onmessage = function (ev) {
        var m = ev.data, src = ev.target;
        if (m.type === 'ready') { if (!m.ok) { setStatus('worker DSP load failed: ' + (m.err || ''), 'idle'); } feed(src); return; }
        if (m.type === 'result') {
          RESULTS[m.key] = m; setRow(m.key, m); done++;
          if (done >= total) { finishBatch(); workers.forEach(function (x) { x.terminate(); }); }
          else feed(src);
        }
      };
      w.onerror = function (e) { setStatus('worker error: ' + (e && e.message || e), 'idle'); };
      w.postMessage({ type: 'ping' });
      workers.push(w);
    }
  }

  function finishBatch() {
    el('run').disabled = false;
    var oks = Object.keys(RESULTS).map(function (k) { return RESULTS[k]; }).filter(function (m) { return m.cp && m.cp.ok && m.sc && m.sc.ok; });
    renderAggregate(oks);
    setStatus('done · ' + oks.length + ' coupled night(s)', 'done');
    el('dlBtn').disabled = false;
    // auto-focus the first eligible if only one, else the worst-drift night (most informative)
    var elig = Object.keys(NIGHTS).sort().filter(function (k) { return eligible(NIGHTS[k]); });
    if (elig.length) focusNight(elig.length === 1 ? elig[0] : elig[0]);
  }

  function agg(oks, f) { return oks.map(f).filter(function (v) { return isFinite(v); }); }
  function renderAggregate(oks) {
    var cards = [];
    var nNights = Object.keys(NIGHTS).filter(function (k) { return eligible(NIGHTS[k]); }).length;
    var totalBeats = oks.reduce(function (s, m) { return s + (m.cp.nCoupled || 0); }, 0);
    cards.push(hcard('eligible nights', String(nNights), '', oks.length + ' coupled · ' + Object.keys(NIGHTS).length + ' indexed', C.ink));
    cards.push(hcard('coupled beats (ΣN)', totalBeats.toLocaleString(), '', 'across all coupled nights', C.blue));
    if (oks.length) {
      var ppm = agg(oks, function (m) { return m.cp.ppm; }), mr = agg(oks, function (m) { return m.cp.matchRate * 100; });
      var riq = agg(oks, function (m) { return m.cp.residIQR; }), lin = agg(oks, function (m) { return m.cp.linR2; });
      cards.push(hcard('inter-device drift', isFinite(median(ppm)) ? median(ppm).toFixed(0) : '—', 'ppm', 'median · range ' + Math.min.apply(null, ppm).toFixed(0) + '–' + Math.max.apply(null, ppm).toFixed(0), C.amber));
      cards.push(hcard('coupling', median(mr).toFixed(0), '%', 'median across nights', median(mr) >= 55 ? C.green : C.amber));
      cards.push(hcard('beat-to-beat spread', median(riq).toFixed(0), 'ms', 'median lag IQR', median(riq) <= 60 ? C.green : C.amber));
      var linMed = median(lin), kind = linMed >= 0.6 ? 'LINEAR — 2-point sync fixes it' : 'NON-LINEAR — needs continuous correction';
      cards.push(hcard('drift shape', linMed >= 0.6 ? 'linear' : 'wander', '', 'median R²=' + (isFinite(linMed) ? linMed.toFixed(2) : '—') + ' · ' + kind, linMed >= 0.6 ? C.green : C.amber));
      // ACC-sync before/after (the point of the whole stage)
      var corrN = oks.filter(function (m) { return m.cpCorr && m.cpCorr.ok && m.accSync && m.accSync.available; });
      var mCorr = NaN, mRaw = NaN;
      if (corrN.length) {
        var cDr = agg(corrN, function (m) { return m.cpCorr.driftRange; }), rDr = agg(corrN, function (m) { return m.cp.driftRange; });
        mCorr = median(cDr); mRaw = median(rDr);
        cards.push(hcard('drift after ACC-sync', isFinite(mCorr) ? mCorr.toFixed(0) : '—', 'ms', 'median · was ' + (isFinite(mRaw) ? mRaw.toFixed(0) : '—') + ' ms raw · ' + corrN.length + ' nights', mCorr < 100 ? C.green : (mCorr < mRaw * 0.5 ? C.amber : C.red)));
      }
      // verdict-of-verdicts
      var drift = oks.filter(function (m) { return m.vd.tier === 'no'; }).length, go = oks.filter(function (m) { return m.vd.tier === 'go'; }).length;
      var concl = go === oks.length ? 'All nights FEASIBLE even before correction — build the provisional trend panel.'
        : (drift >= oks.length * 0.5 ? 'Raw: drift-dominated across nights (~' + median(ppm).toFixed(0) + ' ppm) — systematic device-clock drift confirmed, not viable from phone timestamps alone.'
          : 'Raw: mixed — coupling holds but drift varies night to night.');
      if (corrN.length) {
        var redPct = mRaw > 0 ? (1 - mCorr / mRaw) * 100 : 0;
        concl += ' <b style="color:' + (mCorr < 100 ? C.green : C.amber) + '">ACC-sync</b> (automatic, from your sleep movements — no taps) cut drift <b>' + mRaw.toFixed(0) + '→' + mCorr.toFixed(0) + ' ms</b> (' + redPct.toFixed(0) + '% lower) over ' + corrN.length + ' nights — ' + (mCorr < 100 ? 'drift is largely REMOVABLE; the residual approaches the PAT signal, so a clean-window ankle-PAT trend looks buildable.' : mCorr < mRaw * 0.5 ? 'substantially reduced but not gone — refine motion anchors / clean-window selection.' : 'not meaningfully reduced — chest↔ankle motion may be too decorrelated; try a single-host capture.');
      }
      el('aggConcl').innerHTML = '<b style="color:' + (go === oks.length ? C.green : C.amber) + '">Across ' + oks.length + ' nights:</b> ' + concl;
    } else {
      el('aggConcl').innerHTML = '<span class="muted">No night produced a coupled result — check that each night has BOTH a Polar H10 _ECG.txt and a Verity _PPG.txt from the same session.</span>';
    }
    el('aggCards').innerHTML = cards.join('');
  }

  // ── focused single-night detail (scatter + hist) ───────────────────────────
  function focusNight(k) {
    var nt = NIGHTS[k]; if (!nt || !eligible(nt)) return;
    el('focusTitle').textContent = 'Night ' + k;
    setStatus('rendering ' + k + '…', 'run');
    if (!detailWorker) detailWorker = new Worker('pat-feasibility-worker.js');
    detailWorker.onmessage = function (ev) {
      var m = ev.data; if (m.type === 'ready') { return; }
      if (m.type !== 'result') return;
      setStatus('done', 'done');
      if (m.error) { el('focusHead').innerHTML = '<div class="muted" style="color:' + C.red + '">' + m.error + '</div>'; return; }
      renderFocus(m);
    };
    detailWorker.postMessage({ type: 'job', key: k, label: k, ecgFile: nt.ecg, ppgFile: nt.ppg, ecgAccFile: nt.ecgAcc, ppgAccFile: nt.ppgAcc, detail: true });
  }

  function renderFocus(m) {
    var cp = m.cp, sc = m.sc;
    el('prov').innerHTML = 'ECG <b>' + fmtDate(m.ecg.t0Ms) + ' ' + fmtClock(m.ecg.t0Ms) + '</b> · ' + m.ecg.n + ' R @ ' + m.ecg.fs + ' Hz · ' + (m.ecg.durSec / 60).toFixed(0) + ' min &nbsp;|&nbsp; PPG <b>' + fmtDate(m.ppg.t0Ms) + ' ' + fmtClock(m.ppg.t0Ms) + '</b> · ' + m.ppg.n + ' feet @ ' + m.ppg.fs + ' Hz';
    var vc = el('focusVerdict'); vc.className = 'verdict ' + m.vd.tier;
    vc.innerHTML = '<div class="vlabel" style="color:' + tierColor(m.vd.tier) + '">' + m.vd.label + '</div>';
    var cards = [];
    cards.push(hcard('shared clock', sc.ok ? 'YES' : 'NO', '', 'Δstart ' + (sc.dT0 / 1000).toFixed(1) + ' s · beats ' + (sc.beatRatio * 100).toFixed(1) + '%', sc.ok ? C.green : C.red));
    if (cp.ok) {
      cards.push(hcard('beats coupled', (cp.matchRate * 100).toFixed(0), '%', cp.nCoupled + ' beats (local baseline)', cp.matchRate >= 0.55 ? C.green : C.amber));
      cards.push(hcard('median lag', cp.med.toFixed(0), 'ms', 'IQR ' + cp.p25.toFixed(0) + '–' + cp.p75.toFixed(0), C.blue));
      cards.push(hcard('beat-to-beat', isFinite(cp.residIQR) ? cp.residIQR.toFixed(0) : '—', 'ms', 'lag IQR vs local baseline', cp.residIQR <= 60 ? C.green : C.amber));
      cards.push(hcard('drift', isFinite(cp.driftRange) ? cp.driftRange.toFixed(0) : '—', 'ms', (isFinite(cp.ppm) ? cp.ppm.toFixed(0) + ' ppm' : '') + (isFinite(cp.linR2) ? ' · R²=' + cp.linR2.toFixed(2) : ''), cp.driftRange <= 60 ? C.green : C.amber));
    }
    if (m.accSync && m.accSync.available && m.cpCorr && m.cpCorr.ok) {
      cards.push('<div style="height:1px;background:rgba(255,255,255,.08);margin:2px 0"></div>');
      cards.push(hcard('ACC-sync drift', m.cp.driftRange.toFixed(0) + '→' + m.cpCorr.driftRange.toFixed(0), 'ms', m.accSync.anchors + ' motion anchors · ' + (m.accSync.coverage * 100).toFixed(0) + '% cover', m.cpCorr.driftRange < m.cp.driftRange * 0.5 ? C.green : C.amber));
      cards.push(hcard('after correction', (m.cpCorr.matchRate * 100).toFixed(0) + '%', '', 'coupling · beat-to-beat ' + (isFinite(m.cpCorr.residIQR) ? m.cpCorr.residIQR.toFixed(0) : '—') + ' ms', C.blue));
    } else if (m.accSync) {
      cards.push('<div style="height:1px;background:rgba(255,255,255,.08);margin:2px 0"></div>');
      cards.push(hcard('ACC-sync', 'n/a', '', m.accSync.reason || 'unavailable', C.mut));
    }
    el('focusHead').innerHTML = cards.join('');
    drawScatter(m); drawHist(m);
  }

  function hcard(label, val, unit, sub, tone) {
    return '<div class="hcard"><div class="hl" style="color:' + (tone || C.ink) + '">' + val + (unit ? ' <span class="hu">' + unit + '</span>' : '') + '</div><div class="hk">' + label + '</div>' + (sub ? '<div class="hs">' + sub + '</div>' : '') + '</div>';
  }
  function prep(cv) { var d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || cv.width, h = cv.height; cv.width = w * d; cv.height = h * d; var ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h); return { ctx: ctx, w: w, h: h }; }

  function drawScatter(m) {
    var cv = el('scatter'); if (!cv) return; var g = prep(cv), ctx = g.ctx, w = g.w, h = g.h, pad = 44;
    if (!m.cp.ok || !m.detail) { ctx.fillStyle = C.mut; ctx.font = '12px monospace'; ctx.fillText('no coupled beats', pad, h / 2); return; }
    var pts = m.detail.patAtR, cp = m.cp; if (!pts.length) return;
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var lo = Math.max(0, cp.med - 300), hi = cp.med + 300;
    var X = function (t) { return pad + (t - t0) / (t1 - t0 || 1) * (w - pad - 12); };
    var Y = function (v) { return h - pad - (v - lo) / (hi - lo || 1) * (h - pad - 14); };
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.fillStyle = C.mut; ctx.font = '10px monospace';
    for (var gy = 0; gy <= 4; gy++) { var v = lo + (hi - lo) * gy / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 12, y); ctx.stroke(); ctx.fillText(v.toFixed(0), 6, y + 3); }
    ctx.fillText('R→foot lag (ms) vs time of night', pad, 12);
    ctx.fillStyle = 'rgba(57,217,138,.07)'; ctx.fillRect(pad, Y(PHYS_HI), w - pad - 12, Y(PHYS_LO) - Y(PHYS_HI));
    ctx.fillStyle = 'rgba(88,166,255,.5)';
    for (var i = 0; i < pts.length; i++) { ctx.beginPath(); ctx.arc(X(pts[i].t), Y(pts[i].lag), 1.3, 0, 6.283); ctx.fill(); }
    ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.beginPath();
    cp.binMed.forEach(function (b, i) { var x = X(t0 + b.min * 60000), y = Y(b.med); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  }
  function drawHist(m) {
    var cv = el('hist'); if (!cv) return; var g = prep(cv), ctx = g.ctx, w = g.w, h = g.h, pad = 30;
    if (!m.cp.ok || !m.detail) { ctx.fillStyle = C.mut; ctx.font = '12px monospace'; ctx.fillText('no coupled beats', pad, h / 2); return; }
    var cp = m.cp, lo = Math.max(0, cp.med - 300), hi = cp.med + 300, nb = 44, bins = new Array(nb).fill(0);
    m.detail.pat.forEach(function (v) { var b = Math.floor((v - lo) / (hi - lo) * nb); if (b >= 0 && b < nb) bins[b]++; });
    var mx = Math.max.apply(null, bins) || 1, bw = (w - pad - 12) / nb;
    ctx.fillStyle = C.mut; ctx.font = '10px monospace'; ctx.fillText('lag distribution (ms)', pad, 12);
    for (var i = 0; i < nb; i++) { var bh = bins[i] / mx * (h - pad - 16), x = pad + i * bw, cc = lo + (i + .5) / nb * (hi - lo); ctx.fillStyle = (cc >= PHYS_LO && cc <= PHYS_HI) ? C.green : C.blue; ctx.globalAlpha = .8; ctx.fillRect(x, h - pad - bh, bw - 1, bh); ctx.globalAlpha = 1; }
    ctx.strokeStyle = C.mut; ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - 12, h - pad); ctx.stroke();
    ctx.fillStyle = C.mut; ctx.fillText(lo.toFixed(0), pad, h - pad + 12); ctx.fillText(hi.toFixed(0), w - 40, h - pad + 12);
  }

  function downloadJSON() {
    var oks = Object.keys(RESULTS).map(function (k) { return RESULTS[k]; }).filter(function (m) { return m.cp && m.cp.ok && m.sc && m.sc.ok; });
    var ppm = agg(oks, function (m) { return m.cp.ppm; });
    var out = {
      generated: new Date().toISOString(),
      nightsIndexed: Object.keys(NIGHTS).length,
      nightsEligible: Object.keys(NIGHTS).filter(function (k) { return eligible(NIGHTS[k]); }).length,
      nightsCoupled: oks.length,
      totalCoupledBeats: oks.reduce(function (s, m) { return s + m.cp.nCoupled; }, 0),
      aggregate: oks.length ? {
        driftPpm: { median: +median(ppm).toFixed(1), min: +Math.min.apply(null, ppm).toFixed(1), max: +Math.max.apply(null, ppm).toFixed(1) },
        matchRatePctMedian: +median(agg(oks, function (m) { return m.cp.matchRate * 100; })).toFixed(1),
        beatToBeatIQRmsMedian: +median(agg(oks, function (m) { return m.cp.residIQR; })).toFixed(1),
        driftShapeR2Median: +median(agg(oks, function (m) { return m.cp.linR2; })).toFixed(2),
        afterAccSync: (function () { var c = oks.filter(function (m) { return m.cpCorr && m.cpCorr.ok && m.accSync && m.accSync.available; }); return c.length ? { nNights: c.length, driftRangeMsMedian: +median(agg(c, function (m) { return m.cpCorr.driftRange; })).toFixed(1), driftPpmMedian: +median(agg(c, function (m) { return m.cpCorr.ppm; })).toFixed(1), rawDriftRangeMsMedian: +median(agg(c, function (m) { return m.cp.driftRange; })).toFixed(1) } : null; })()
      } : null,
      nights: Object.keys(RESULTS).sort().map(function (k) {
        var m = RESULTS[k];
        if (m.error) return { night: k, error: m.error };
        return { night: k, start: fmtDate(m.ecg.t0Ms) + 'T' + fmtClock(m.ecg.t0Ms), sharedClock: m.sc.ok,
          overlapMin: +m.ov.min.toFixed(1), rPeaks: m.ecg.n, feet: m.ppg.n,
          coupling: m.cp.ok ? { matchRatePct: +(m.cp.matchRate * 100).toFixed(1), medianLagMs: +m.cp.med.toFixed(1), beatToBeatIQRms: +(+m.cp.residIQR).toFixed(1), driftRangeMs: +(+m.cp.driftRange).toFixed(1), driftPpm: +(+m.cp.ppm).toFixed(1), linR2: +(+m.cp.linR2).toFixed(2) } : null,
          accSync: m.accSync || null,
          correctedCoupling: (m.cpCorr && m.cpCorr.ok) ? { matchRatePct: +(m.cpCorr.matchRate * 100).toFixed(1), medianLagMs: +m.cpCorr.med.toFixed(1), beatToBeatIQRms: +(+m.cpCorr.residIQR).toFixed(1), driftRangeMs: +(+m.cpCorr.driftRange).toFixed(1), driftPpm: +(+m.cpCorr.ppm).toFixed(1) } : null,
          verdict: m.vd.label };
      })
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pat-feasibility-batch.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ── drag-drop folder (webkitGetAsEntry recursion) ──────────────────────────
  function collectEntries(items) {
    var files = [], top = [];
    function walk(entry) { return new Promise(function (res) { if (!entry) return res(); if (entry.isFile) entry.file(function (f) { files.push(f); res(); }, function () { res(); }); else if (entry.isDirectory) { var rd = entry.createReader(), all = []; (function read() { rd.readEntries(function (ents) { if (!ents.length) { Promise.all(all.map(walk)).then(function () { res(); }); } else { all = all.concat([].slice.call(ents)); read(); } }, function () { res(); }); })(); } else res(); }); }
    for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry(); if (en) top.push(walk(en)); }
    return Promise.all(top).then(function () { return files; });
  }

  window.addEventListener('DOMContentLoaded', function () {
    var fi = el('folderInput'), xi = el('fileInput'), dz = el('dropzone');
    if (fi) fi.addEventListener('change', function (e) { ingestFiles(e.target.files); });
    if (xi) xi.addEventListener('change', function (e) { ingestFiles(e.target.files); });
    if (dz) {
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.borderColor = 'rgba(88,166,255,.6)'; });
      dz.addEventListener('dragleave', function () { dz.style.borderColor = 'rgba(255,255,255,.18)'; });
      dz.addEventListener('drop', function (e) { e.preventDefault(); dz.style.borderColor = 'rgba(255,255,255,.18)'; var dt = e.dataTransfer; if (dt && dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) collectEntries(dt.items).then(ingestFiles); else if (dt && dt.files) ingestFiles(dt.files); });
    }
    if (el('run')) el('run').addEventListener('click', runBatch);
    if (el('dlBtn')) el('dlBtn').addEventListener('click', downloadJSON);
    renderNightTable();
  });
})();
