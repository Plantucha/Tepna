/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   qrs-equiv-analysis.js — figure engine for the candidate paper
   "Three-way rMSSD equivalence: PulseDex · ECGDex · PpgDex on one set of beats."

   Drives a pool of qrs-equiv-worker.js realms (FULL-lane ECGDex + PpgDex) and one
   PulseDex realm (cohort-harness.html?node=pulsedex). Per patient, one ~9-min apnea-
   cluster window is scored for rMSSD by all three REAL detectors on the SAME beats:
   PulseDex reads the ground-truth RR (the reference), ECGDex re-derives it from the
   raw int16 ECG (130 Hz + Pan-Tompkins), PpgDex from the optical pulse (176 Hz +
   pulse-arrival-time). Pairwise Bland–Altman then isolates the error sources:
   ECG−Pulse = sampling + QRS detection; PPG−Pulse = + PAT jitter (+ optical detect);
   the extra dispersion of PPG−Pulse over ECG−Pulse is the PAT-jitter component.

   HONEST FRAMING (in-page + export): synthetic ground truth. Certifies that three
   independent detectors agree on rMSSD on co-generated beats and quantifies each
   modality's intrinsic dispersion — NOT a real-patient equivalence study. 100% local.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var WIN = [];                 // [{ahi,cpap,pulse,ecg,ppg}]
  var workers = [], pdx = {}, pend = new Map(), seq = 1, RESULT = null;
  var COL = { pulse: '#3DE0D0', ecg: '#58A6FF', ppg: '#FFB84D', line: '#FF6B7A' };

  function $(id) { return document.getElementById(id); }
  function setStatus(t, c) { var e = $('status'); e.textContent = t; e.className = 'pill ' + (c || 'idle'); }
  function setProg(f) { $('progBar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }

  // ── FULL worker pool ──
  function bootPool(n) {
    workers = []; var readies = [];
    for (var i = 0; i < n; i++) {
      (function () {
        var w = new Worker('qrs-equiv-worker.js'); var rec = { w: w, ready: false, err: null };
        readies.push(new Promise(function (res) { w.onmessage = function (ev) { var m = ev.data || {}; if (m.type === 'ready') { rec.ready = !m.err; rec.err = m.err || null; res(); } }; }));
        workers.push(rec); w.postMessage({ type: 'init' });
      })();
    }
    return Promise.all(readies);
  }
  // ── PulseDex realm (reuses the shipped single-node harness) ──
  function bootPdx() {
    return new Promise(function (resolve) {
      var f = document.createElement('iframe');
      f.style.cssText = 'position:absolute;width:10px;height:10px;left:-3000px;top:0;border:0';
      f.src = 'cohort-harness.html?node=pulsedex'; pdx = { iframe: f, ready: false };
      document.body.appendChild(f); var done = false;
      window.addEventListener('message', function (ev) {
        var m = ev.data || {}; if (m.node !== 'pulsedex') return;
        if (m.type === 'ready') { pdx.ready = !m.error; pdx.bootErr = m.error || null; if (!done) { done = true; resolve(); } }
        else if (m.type === 'result') { var p = pend.get(m.reqId); if (p) { pend.delete(m.reqId); p(m); } }
      });
      setTimeout(function () { if (!done) { done = true; resolve(); } }, 9000);
    });
  }
  function callPdx(rrText) {
    return new Promise(function (resolve) {
      var id = seq++; pend.set(id, resolve);
      pdx.iframe.contentWindow.postMessage({ type: 'run', reqId: id, payload: { rrText: rrText } }, '*');
      setTimeout(function () { if (pend.has(id)) { pend.delete(id); resolve({ error: 'timeout' }); } }, 20000);
    });
  }

  // collect raw worker outputs first (with rrText), then score PulseDex
  function runWorkers(seeds, onProg) {
    return new Promise(function (resolve) {
      var idx = 0, done = 0, total = seeds.length, out = [];
      function pump(rec) {
        if (CANCEL || idx >= total) { if (!workers.some(function (r) { return r.busy; })) resolve(out); return; }
        var seed = seeds[idx++]; rec.busy = true; rec.w.onmessage = function (ev) {
          var m = ev.data || {}; if (m.type !== 'done') return;
          if (m.result && !m.result.skip) out.push(m.result);
          done++; onProg(done / total); rec.busy = false;
          if (CANCEL) { if (!workers.some(function (r) { return r.busy; })) resolve(out); return; }
          if (done >= total) { resolve(out); return; }
          pump(rec);
        };
        rec.w.postMessage({ type: 'job', reqId: seed, seed: seed });
      }
      workers.forEach(function (rec) { if (rec.ready) pump(rec); });
      if (!workers.some(function (r) { return r.ready; })) resolve(out);
    });
  }

  // ── stats ──
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function sd(a) { if (a.length < 2) return null; var m = mean(a), s = 0; a.forEach(function (v) { s += (v - m) * (v - m); }); return Math.sqrt(s / (a.length - 1)); }
  function pearson(x, y) { var n = Math.min(x.length, y.length); if (n < 3) return null; var mx = mean(x), my = mean(y), sx = 0, sy = 0, sxy = 0; for (var i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) * (x[i] - mx); sy += (y[i] - my) * (y[i] - my); } return (sx && sy) ? sxy / Math.sqrt(sx * sy) : null; }
  function ba(aArr, bArr) {            // a − b agreement
    var d = [], m = [], a = [], b = [];
    for (var i = 0; i < aArr.length; i++) { if (aArr[i] != null && bArr[i] != null && isFinite(aArr[i]) && isFinite(bArr[i])) { d.push(aArr[i] - bArr[i]); m.push((aArr[i] + bArr[i]) / 2); a.push(aArr[i]); b.push(bArr[i]); } }
    if (d.length < 3) return null;
    var bias = mean(d), s = sd(d), mb = mean(b);
    return { n: d.length, bias: bias, sd: s, loLoA: bias - 1.96 * s, hiLoA: bias + 1.96 * s,
      biasPct: mb ? 100 * bias / mb : null, r: pearson(a, b), d: d, m: m };
  }

  // ── run ──
  var targetN;
  async function run() {
    $('run').disabled = true; WIN = []; CANCEL = false;
    if ($('cancel')) { $('cancel').style.display = ''; $('cancel').disabled = false; }
    targetN = Math.max(10, Math.min(20000, +$('nSubj').value || 60));
    setStatus('booting FULL-lane + PulseDex realms…', 'run'); setProg(0);
    var cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4)));
    await Promise.all([bootPool(cores), bootPdx()]);
    if (!workers.some(function (w) { return w.ready; }) || !pdx.ready) {
      setStatus('realm boot failed' + (pdx.bootErr ? ' (pulsedex: ' + pdx.bootErr + ')' : ''), 'idle'); $('run').disabled = false; return;
    }
    setStatus('rendering ' + targetN + ' windows · ' + cores + ' realms…', 'run');
    var seeds = []; for (var s = 0; s < targetN; s++) seeds.push(s);
    var raw = await runWorkers(seeds, function (f) { setProg(f * 0.6); });
    workers.forEach(function (w) { try { w.w.terminate(); } catch (e) {} });

    setStatus('scoring PulseDex on ' + raw.length + ' windows…', 'run');
    for (var i = 0; i < raw.length; i++) {
      if (CANCEL) break;
      var r = raw[i];
      var pr = await callPdx(r.rrText);
      var pulse = (pr && pr.score && pr.score.rmssd != null && isFinite(pr.score.rmssd)) ? pr.score.rmssd : null;
      WIN.push({ ahi: r.ahi, cpap: r.cpap, nBeats: r.nBeats, pulse: pulse, ecg: r.ecgRmssd, ppg: r.ppgRmssd });
      setProg(0.6 + 0.4 * (i + 1) / raw.length);
      if (i % 4 === 0) { setStatus('PulseDex ' + (i + 1) + '/' + raw.length, 'run'); await new Promise(function (rs) { setTimeout(rs, 0); }); }
    }
    setProg(1);
    if ($('cancel')) $('cancel').style.display = 'none';
    setStatus((CANCEL ? 'cancelled — partial · ' : 'analyzing ') + WIN.length + ' windows', CANCEL ? 'idle' : 'done');
    if (WIN.length) analyze();
    $('run').disabled = false;
    ['dlCsv', 'dlStats', 'dlFig'].forEach(function (id) { $(id).disabled = !WIN.length; });
  }

  // ── analyze ──
  function col(k) { return WIN.map(function (w) { return w[k]; }); }
  function analyze() {
    var pulse = col('pulse'), ecg = col('ecg'), ppg = col('ppg');
    var baEP = ba(ecg, pulse);     // ECG − Pulse
    var baPP = ba(ppg, pulse);     // PPG − Pulse
    var baPE = ba(ppg, ecg);       // PPG − ECG
    // PAT-jitter dispersion isolate: extra SD of PPG−Pulse over ECG−Pulse (added in quadrature)
    var patSD = (baEP && baPP && baPP.sd > baEP.sd) ? Math.sqrt(baPP.sd * baPP.sd - baEP.sd * baEP.sd) : 0;

    // headline
    function ms(v) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1); }
    var cards = '';
    cards += hcard(COL.ecg, ms(baEP && baEP.bias) + '<span class="hu"> ms</span>', 'ECGDex − PulseDex bias', 'LoA ' + (baEP ? baEP.loLoA.toFixed(1) + '…' + baEP.hiLoA.toFixed(1) + ' ms' : '—') + ' · sampling + QRS detect');
    cards += hcard(COL.ppg, ms(baPP && baPP.bias) + '<span class="hu"> ms</span>', 'PpgDex − PulseDex bias', 'LoA ' + (baPP ? baPP.loLoA.toFixed(1) + '…' + baPP.hiLoA.toFixed(1) + ' ms' : '—') + ' · + PAT jitter');
    cards += hcard(COL.line, '±' + patSD.toFixed(1) + '<span class="hu"> ms</span>', 'PAT-jitter dispersion', 'optical-only SD = √(SD²ₚₚ − SD²ₑₚ)');
    $('headline').innerHTML = cards;

    // table
    var rows = [['ECGDex − PulseDex', baEP], ['PpgDex − PulseDex', baPP], ['PpgDex − ECGDex', baPE]];
    var tb = '';
    rows.forEach(function (r) {
      var b = r[1]; if (!b) { tb += '<tr><td>' + r[0] + '</td><td colspan="6" class="muted">—</td></tr>'; return; }
      tb += '<tr><td>' + r[0] + '</td><td class="num">' + b.n + '</td>'
        + '<td class="num">' + (b.bias >= 0 ? '+' : '') + b.bias.toFixed(2) + '</td>'
        + '<td class="num">' + (b.biasPct != null ? (b.biasPct >= 0 ? '+' : '') + b.biasPct.toFixed(1) + '%' : '—') + '</td>'
        + '<td class="num">' + b.sd.toFixed(2) + '</td>'
        + '<td class="num">' + b.loLoA.toFixed(1) + ' … ' + b.hiLoA.toFixed(1) + '</td>'
        + '<td class="num">' + (b.r != null ? b.r.toFixed(3) : '—') + '</td></tr>';
    });
    $('tblBody').innerHTML = tb;

    RESULT = { generated: new Date().toISOString(), nWindows: WIN.length,
      framing: 'Three-way rMSSD equivalence on co-generated beats. One ~9-min apnea-cluster window per patient, scored by the REAL PulseDex (RR text reference), ECGDex (raw int16 ECG @130 Hz, R rendered at true beat times), and PpgDex (optical pulse @176 Hz) on the SAME beats. Pairwise Bland–Altman: ECG−Pulse = sampling + QRS detection; PPG−Pulse = + PAT jitter (+ optical detection); PAT-jitter SD = quadrature excess of PPG−Pulse over ECG−Pulse. SYNTHETIC GROUND TRUTH — certifies detector agreement and quantifies intrinsic dispersion, not a real-patient equivalence study.',
      pairs: {} };
    [['ecg_minus_pulse', baEP], ['ppg_minus_pulse', baPP], ['ppg_minus_ecg', baPE]].forEach(function (p) {
      if (p[1]) RESULT.pairs[p[0]] = { n: p[1].n, biasMs: +p[1].bias.toFixed(3), biasPct: p[1].biasPct != null ? +p[1].biasPct.toFixed(2) : null, sdMs: +p[1].sd.toFixed(3), loaLoMs: +p[1].loLoA.toFixed(2), loaHiMs: +p[1].hiLoA.toFixed(2), pearson: p[1].r != null ? +p[1].r.toFixed(4) : null };
    });
    RESULT.patJitterSdMs = +patSD.toFixed(3);
    try { window.QRS_EQUIV = RESULT; } catch (e) {}

    drawScatter(pulse, ecg, ppg);
    drawBA('baPpg', baPP, 'PpgDex − PulseDex', COL.ppg);
    drawBA('baEcg', baEP, 'ECGDex − PulseDex', COL.ecg);
  }
  function hcard(c, hl, k, s) { return '<div class="hcard"><div class="hl" style="color:' + c + '">' + hl + '</div><div class="hk">' + k + '</div><div class="hs">' + s + '</div></div>'; }

  // ════════ figures ════════
  function clearC(ctx, w, h) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0f141b'; ctx.fillRect(0, 0, w, h); }
  function axes(ctx, P, w, h, xmin, xmax, ymin, ymax, xt, yt, xlab, ylab, xfmt, yfmt) {
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.font = '11px ui-monospace,monospace';
    ctx.beginPath(); ctx.moveTo(P, 12); ctx.lineTo(P, h - P); ctx.lineTo(w - 14, h - P); ctx.stroke();
    var i;
    for (i = 0; i <= xt; i++) { var xv = xmin + (xmax - xmin) * i / xt, px = P + (w - P - 14) * i / xt; ctx.fillStyle = '#6f8096'; ctx.fillText(xfmt ? xfmt(xv) : Math.round(xv), px - 10, h - P + 16); }
    for (i = 0; i <= yt; i++) { var yv = ymin + (ymax - ymin) * i / yt, py = (h - P) - (h - P - 12) * i / yt; ctx.fillStyle = '#6f8096'; ctx.fillText(yfmt ? yfmt(yv) : Math.round(yv), 8, py + 4); ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(P, py); ctx.lineTo(w - 14, py); ctx.stroke(); }
    ctx.fillStyle = '#aab8cc'; ctx.font = '11px ui-monospace,monospace'; ctx.fillText(xlab, w / 2 - 60, h - 5);
    ctx.save(); ctx.translate(13, h / 2 + 50); ctx.rotate(-Math.PI / 2); ctx.fillText(ylab, 0, 0); ctx.restore();
  }
  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

  // Fig 1 — agreement scatter: PulseDex (x) vs ECG + PPG (y), identity
  function drawScatter(pulse, ecg, ppg) {
    var cv = $('scatter'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 48; clearC(ctx, w, h);
    var vals = []; for (var i = 0; i < pulse.length; i++) { [pulse[i], ecg[i], ppg[i]].forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); }); }
    if (!vals.length) { ctx.fillStyle = '#6f8096'; ctx.font = '12px ui-monospace'; ctx.fillText('run to populate', 20, 40); return; }
    var hi = Math.min(160, Math.ceil(Math.max.apply(null, vals) / 10) * 10 + 5);
    axes(ctx, P, w, h, 0, hi, 0, hi, 5, 5, 'PulseDex rMSSD (ms) — reference', 'detector rMSSD (ms)', function (v) { return Math.round(v); }, function (v) { return Math.round(v); });
    var X = function (v) { return P + (w - P - 14) * Math.max(0, Math.min(1, v / hi)); };
    var Y = function (v) { return (h - P) - (h - P - 12) * Math.max(0, Math.min(1, v / hi)); };
    ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(hi), Y(hi)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#9fb0c4'; ctx.font = '10px ui-monospace'; ctx.fillText('identity', X(hi) - 70, Y(hi) + 14);
    for (var k = 0; k < pulse.length; k++) {
      if (pulse[k] == null) continue;
      if (ecg[k] != null && isFinite(ecg[k])) { ctx.fillStyle = hexA(COL.ecg, 0.6); ctx.beginPath(); ctx.arc(X(pulse[k]), Y(ecg[k]), 3.2, 0, 7); ctx.fill(); }
      if (ppg[k] != null && isFinite(ppg[k])) { ctx.fillStyle = hexA(COL.ppg, 0.6); ctx.beginPath(); ctx.arc(X(pulse[k]), Y(ppg[k]), 3.2, 0, 7); ctx.fill(); }
    }
    $('scatterLeg').innerHTML = '<span class="chip" style="background:' + COL.ecg + '"></span>ECGDex &nbsp; <span class="chip" style="background:' + COL.ppg + '"></span>PpgDex &nbsp;·&nbsp; vs PulseDex reference (x). On-identity = agreement.';
  }

  // Bland–Altman panel
  function drawBA(id, b, title, color) {
    var cv = $(id), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 48; clearC(ctx, w, h);
    if (!b) { ctx.fillStyle = '#6f8096'; ctx.font = '12px ui-monospace'; ctx.fillText('run to populate', 20, 40); return; }
    var xhi = Math.min(160, Math.ceil(Math.max.apply(null, b.m) / 10) * 10 + 5);
    var span = Math.max(Math.abs(b.loLoA), Math.abs(b.hiLoA)) * 1.25 + 2;
    var ylo = -span, yhi = span;
    axes(ctx, P, w, h, 0, xhi, ylo, yhi, 5, 4, 'mean of pair (ms)', title + ' (ms)', function (v) { return Math.round(v); }, function (v) { return v.toFixed(0); });
    var X = function (v) { return P + (w - P - 14) * Math.max(0, Math.min(1, v / xhi)); };
    var Y = function (v) { return (h - P) - (h - P - 12) * Math.max(0, Math.min(1, (v - ylo) / (yhi - ylo))); };
    // zero, bias, LoA lines
    function hline(val, style, dash, label) { ctx.strokeStyle = style; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(P, Y(val)); ctx.lineTo(w - 14, Y(val)); ctx.stroke(); ctx.setLineDash([]); if (label) { ctx.fillStyle = style; ctx.font = '10px ui-monospace'; ctx.fillText(label, w - 150, Y(val) - 4); } }
    hline(0, 'rgba(255,255,255,.18)');
    hline(b.bias, color, [], 'bias ' + b.bias.toFixed(1));
    hline(b.loLoA, 'rgba(255,107,122,.6)', [5, 4], '−1.96 SD ' + b.loLoA.toFixed(1));
    hline(b.hiLoA, 'rgba(255,107,122,.6)', [5, 4], '+1.96 SD ' + b.hiLoA.toFixed(1));
    for (var i = 0; i < b.d.length; i++) { ctx.fillStyle = hexA(color, 0.5); ctx.beginPath(); ctx.arc(X(b.m[i]), Y(b.d[i]), 2.8, 0, 7); ctx.fill(); }
  }

  // ── exports ──
  function dl(name, text, mime) { var bl = new Blob([text], { type: mime || 'text/plain' }); var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  $('dlCsv').onclick = function () {
    var rows = [['ahi', 'cpap', 'nBeats', 'pulseRmssd', 'ecgRmssd', 'ppgRmssd']];
    WIN.forEach(function (wd) { rows.push([wd.ahi, wd.cpap ? 1 : 0, wd.nBeats, wd.pulse, wd.ecg, wd.ppg]); });
    dl('rmssd-equivalence-results.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
  };
  $('dlStats').onclick = function () { dl('rmssd-equivalence-stats.json', JSON.stringify(RESULT, null, 2), 'application/json'); };
  $('dlFig').onclick = function () {
    var a = $('scatter'), b = $('baPpg'), c = $('baEcg'), gap = 16;
    var W = a.width + gap * 2, H = a.height + b.height + c.height + gap * 4;
    var out = document.createElement('canvas'); out.width = W; out.height = H; var ctx = out.getContext('2d');
    ctx.fillStyle = '#0c0f14'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(a, gap, gap); ctx.drawImage(b, gap, gap * 2 + a.height); ctx.drawImage(c, gap, gap * 3 + a.height + b.height);
    out.toBlob(function (bl) { var u = URL.createObjectURL(bl); var an = document.createElement('a'); an.href = u; an.download = 'rmssd-equivalence-figures.png'; an.click(); }, 'image/png');
  };
  var CANCEL = false;
  $('run').onclick = run;
  if ($('cancel')) $('cancel').onclick = function () { CANCEL = true; $('cancel').disabled = true; setStatus('cancelling…', 'run'); };
})();
