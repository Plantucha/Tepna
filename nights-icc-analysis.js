/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   nights-icc-analysis.js — "How many nights?" test-retest reliability engine.

   For each STABLE (flat-arc) synthetic patient in the 1–12-night longitudinal lane
   we measure three single-signal metrics PER OCCASION with the REAL Dex detectors:
     · ODI-4   — OxyDex   (per night, real oxydex-dsp.processNight)
     · rMSSD   — PulseDex (per night, real pulsedex-dsp time-domain HRV)
     · CGM-CV  — GlucoDex (per day,  real glucodex-dsp.analyze on day-split stream)

   Single-occasion test-retest reliability is the one-way random-effects
   intraclass correlation ICC(1,1) = σ²_between / (σ²_between + σ²_within), estimated
   by ANOVA over each subject's repeated occasions. The Spearman–Brown prophecy then
   gives the reliability of an average of m occasions and the minimum m that reaches
   a target reliability — the "minimum reliable recording length" per metric.

   Flat arc only: a stable latent per subject, so within-subject spread is genuine
   night-to-night biology + detector noise, NOT a planted trend. rMSSD/ODI are also
   re-computed on the LATENT targets (planted rMSSD, planted AHI) to show the real
   detector preserves the reliability structure (non-circular check).

   100% local. Reuses synth-gen.js + cohort-gen.js + the three real-DSP harness realms.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MET = ['odi', 'rmssd', 'cv'];
  var META = {
    odi:   { label: 'ODI-4',  node: 'OxyDex',   unit: 'events/h', color: '#58A6FF', occ: 'night' },
    rmssd: { label: 'rMSSD',  node: 'PulseDex', unit: 'ms',       color: '#FFB84D', occ: 'night' },
    cv:    { label: 'CGM-CV', node: 'GlucoDex', unit: '%',        color: '#3DE0D0', occ: 'day'  },
  };
  // subject -> { odi:[], rmssd:[], cv:[], odiLatent:[], rmssdLatent:[], age, baseAHI }
  var SUBJ = [];
  var pend = new Map(), seq = 1;

  function $(id) { return document.getElementById(id); }
  function setStatus(t, c) { var e = $('status'); e.textContent = t; e.className = 'pill ' + (c || 'idle'); }
  function setProg(f) { $('progBar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }

  // ── TWO Web-Worker pools: `oxy` (ODI-4 per night) + `iccpg` (rMSSD per night + CGM-CV per
  //   day). OxyDex and PulseDex collide on bare globals, so OxyDex must be its own realm; the
  //   lean `iccpg` kind runs PulseDex+GlucoDex (which coexist) off the main thread. True multicore.
  var oxyPool = [], iccPool = [];
  function bootKind(arr, kind, K) {
    arr.length = 0; var readies = [];
    for (var i = 0; i < K; i++) {
      (function () {
        var w = new Worker('cohort-worker.js');
        var rec = { w: w, ready: false, _res: null };
        arr.push(rec); readies.push(new Promise(function (r) { rec._res = r; }));
        w.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.type === 'ready') { rec.ready = !m.err; if (rec._res) { rec._res(); rec._res = null; } return; }
          if (m.type === 'done') { var p = pend.get(m.reqId); if (p) { pend.delete(m.reqId); p(m); } }
        };
        w.postMessage({ type: 'init', kind: kind });
      })();
    }
    return Promise.race([Promise.all(readies), new Promise(function (r) { setTimeout(r, 15000); })]);
  }
  function bootPools(K) { return Promise.all([bootKind(oxyPool, 'oxy', K), bootKind(iccPool, 'iccpg', K)]); }
  function runSeed(rec, seed) {
    return new Promise(function (resolve) {
      var id = seq++; pend.set(id, resolve);
      rec.w.postMessage({ type: 'job', reqId: id, seed: seed });
      setTimeout(function () { if (pend.has(id)) { pend.delete(id); resolve({ error: 'timeout' }); } }, 120000);
    });
  }

  // ── durable checkpoint + single-instance lock (preview refresh resumes, not restarts) ──
  function idbOpen() { return new Promise(function (res, rej) { var r = indexedDB.open('nicc_ckpt', 1); r.onupgradeneeded = function () { r.result.createObjectStore('s'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  async function ckptSave(o) { try { var db = await idbOpen(); await new Promise(function (res, rej) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(o, 'run'); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); db.close(); } catch (e) {} }
  async function ckptLoad() { try { var db = await idbOpen(); var o = await new Promise(function (res, rej) { var tx = db.transaction('s', 'readonly'); var rq = tx.objectStore('s').get('run'); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); db.close(); return o; } catch (e) { return null; } }
  async function ckptClear() { try { var db = await idbOpen(); await new Promise(function (res) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').delete('run'); tx.oncomplete = res; }); db.close(); } catch (e) {} }
  function genVer() { return (window.CohortGen && CohortGen.VERSION) || '?'; }
  var RUN_ID = Math.random().toString(36).slice(2);
  function lockFresh() { try { var l = JSON.parse(localStorage.getItem('nicc_lock') || 'null'); return (l && (Date.now() - l.ts) < 6000) ? l : null; } catch (e) { return null; } }
  function lockHeldByOther() { var l = lockFresh(); return !!(l && l.id !== RUN_ID); }
  function lockBeat() { try { localStorage.setItem('nicc_lock', JSON.stringify({ id: RUN_ID, ts: Date.now() })); } catch (e) {} }
  function lockRelease() { try { var l = lockFresh(); if (l && l.id === RUN_ID) localStorage.removeItem('nicc_lock'); } catch (e) {} }
  function fmtETA(sec) { if (!isFinite(sec) || sec < 0) return '—'; var m = Math.floor(sec / 60), s = Math.round(sec % 60); return m ? (m + 'm' + (s < 10 ? '0' : '') + s + 's') : (s + 's'); }

  // join one flat-arc subject's measured + latent series from the two pools (ICC treats each
  // metric's per-subject series independently, so no per-night pairing is required).
  function measureFromResults(seed, oxyRes, iccRes) {
    if (!oxyRes || !oxyRes.result || !iccRes || !iccRes.result) return null;
    var prof = (oxyRes.result.meta && oxyRes.result.meta.profile);
    if (!prof) return null;
    var gtN = (oxyRes.result.meta.groundTruth && oxyRes.result.meta.groundTruth.nights) || [];
    var rec = { seed: seed, age: prof.age, baseAHI: prof.baseAHI, sev: prof.osaSeverity,
                odi: [], rmssd: [], cv: [], odiLatent: [], rmssdLatent: [] };
    var on = oxyRes.result.oxy && oxyRes.result.oxy.score && oxyRes.result.oxy.score.nights;
    (on || []).forEach(function (sc) { if (sc && sc.odi != null && isFinite(sc.odi)) rec.odi.push(sc.odi); });
    (iccRes.result.pulse || []).forEach(function (pp) { var ps = pp.score || pp; if (ps && ps.rmssd != null && isFinite(ps.rmssd)) rec.rmssd.push(ps.rmssd); });
    (iccRes.result.perDay || []).forEach(function (d) { if (d.cv != null && isFinite(d.cv)) rec.cv.push(d.cv); });
    gtN.forEach(function (n) { if (n.ahiTruth != null) rec.odiLatent.push(n.ahiTruth); if (n.rmssdTarget != null) rec.rmssdLatent.push(n.rmssdTarget); });
    return rec;
  }

  // ── split the continuous CGM stream into per-calendar-day CSVs (floating wall-clock) ──
  function splitCgmByDay(csv) {
    var lines = (csv || '').split(/\r?\n/);
    if (lines.length < 3) return [];
    var header = lines[0];
    var byDay = {};
    for (var i = 1; i < lines.length; i++) {
      var ln = lines[i]; if (!ln.trim()) continue;
      var comma = ln.indexOf(',');
      if (comma < 10) continue;
      var ts = ln.slice(0, comma).trim();
      var day = ts.slice(0, 10);                 // YYYY-MM-DD prefix of the zoned ISO stamp
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      (byDay[day] || (byDay[day] = [])).push(ln);
    }
    var out = [];
    Object.keys(byDay).sort().forEach(function (day) {
      var rows = byDay[day];
      if (rows.length < 200) return;             // need ≥~16 h of 5-min readings for a stable daily CV
      out.push({ day: day, n: rows.length, csv: header + '\n' + rows.join('\n') + '\n' });
    });
    return out;
  }

  // ── ANOVA one-way random-effects ICC(1,1) over ragged subjects ──
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function iccOneWay(groups) {
    // groups: array of arrays (each subject's repeated measurements); keep subjects with ≥2 obs
    var g = groups.filter(function (a) { return a.length >= 2; });
    var k = g.length; if (k < 2) return null;
    var all = []; g.forEach(function (a) { a.forEach(function (v) { all.push(v); }); });
    var N = all.length, grand = mean(all);
    var ssb = 0, ssw = 0, sumN2 = 0;
    g.forEach(function (a) {
      var mi = mean(a), ni = a.length; sumN2 += ni * ni;
      ssb += ni * (mi - grand) * (mi - grand);
      a.forEach(function (v) { ssw += (v - mi) * (v - mi); });
    });
    var dfb = k - 1, dfw = N - k;
    if (dfw <= 0) return null;
    var msb = ssb / dfb, msw = ssw / dfw;
    var n0 = (N - sumN2 / N) / dfb;              // average group size (balanced → n per subject)
    var icc = (msb - msw) / (msb + (n0 - 1) * msw);
    icc = Math.max(0, Math.min(0.999, icc));
    var varB = Math.max(0, (msb - msw) / n0), varW = Math.max(0, msw);
    return {
      icc: icc, k: k, N: N, n0: n0, msb: msb, msw: msw,
      varB: varB, varW: varW, grand: grand,
      withinSD: Math.sqrt(varW), withinCVpct: grand ? 100 * Math.sqrt(varW) / Math.abs(grand) : null,
      medianOcc: medianOf(g.map(function (a) { return a.length; })),
    };
  }
  function medianOf(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  // Spearman–Brown: reliability of an average of m occasions
  function sb(icc, m) { return icc <= 0 ? 0 : (m * icc) / (1 + (m - 1) * icc); }
  // minimum occasions to reach target reliability
  function minOcc(icc, target) {
    if (icc <= 0) return Infinity;
    if (icc >= target) return 1;
    return Math.ceil((target * (1 - icc)) / ((1 - target) * icc));
  }

  // ── run ──
  var minNights, targetSubj, RESULT = null;
  async function run(resumeCk) {
    if (lockHeldByOther()) { setStatus('another tab/instance is running this cohort — not duplicating', 'idle'); $('run').disabled = false; return; }
    lockBeat(); var _hb = setInterval(lockBeat, 2000);
    $('run').disabled = true; CANCEL = false;
    if ($('cancel')) { $('cancel').style.display = ''; $('cancel').disabled = false; }
    minNights  = Math.max(3, Math.min(12, +$('minN').value || 5));
    targetSubj = Math.max(10, Math.min(100000, +$('nSubj').value || 40));
    var ver = genVer();
    var K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    setStatus('booting ' + K + '× OxyDex + ' + K + '× (PulseDex+GlucoDex) realms…', 'run'); setProg(0);
    if (!oxyPool.length || !iccPool.length) await bootPools(K);
    var oxyRdy = oxyPool.filter(function (r) { return r.ready; }), iccRdy = iccPool.filter(function (r) { return r.ready; });
    if (!oxyRdy.length || !iccRdy.length) { setStatus('worker boot failed', 'idle'); $('run').disabled = false; clearInterval(_hb); lockRelease(); return; }

    // scan flat-arc (stable) subjects with ≥minNights occasions — profiles only, deterministic
    setStatus('scanning profiles…', 'run');
    var seeds = [], seed = 0, CAP = 2000000;
    while (seeds.length < targetSubj && seed < CAP) {
      var pf; try { pf = CohortGen.sampleProfile(seed); } catch (e) { seed++; continue; }
      if (pf && pf.arc === 'flat' && pf.nNights >= minNights) seeds.push(seed);
      seed++;
    }
    var total = seeds.length;

    var startCursor = 0;
    if (resumeCk && resumeCk.ver === ver && resumeCk.targetSubj === targetSubj && resumeCk.minNights === minNights && resumeCk.cursor < total && Array.isArray(resumeCk.SUBJ)) {
      SUBJ = resumeCk.SUBJ; startCursor = resumeCk.cursor;
      setStatus('resuming ' + startCursor + '/' + total + '…', 'run');
    } else { SUBJ = []; await ckptClear(); }

    var cursor = startCursor, pdone = 0, t0 = performance.now();
    async function lane(oxyW, iccW) {
      while (!CANCEL) {
        var idx = cursor++; if (idx >= total) return;
        var s = seeds[idx];
        var pair = await Promise.all([runSeed(oxyW, s), runSeed(iccW, s)]);
        pdone++;
        var rec = measureFromResults(s, pair[0], pair[1]);
        if (rec) SUBJ.push(rec);
        var done = startCursor + pdone;
        if (pdone % 4 === 0 || done === total) {
          var el = (performance.now() - t0) / 1000, rate = pdone / el;
          setProg(done / total);
          setStatus('subject ' + done + '/' + total + ' · ' + oxyRdy.length + '× · n=' + SUBJ.length + ' · ETA ' + fmtETA((total - done) / (rate || 1)), 'run');
          await new Promise(function (r) { setTimeout(r, 0); });
        }
        if (pdone % 48 === 0) ckptSave({ ver: ver, targetSubj: targetSubj, minNights: minNights, cursor: cursor, SUBJ: SUBJ, savedAt: Date.now() });
      }
    }
    var K2 = Math.min(oxyRdy.length, iccRdy.length), lanes = [];
    for (var i = 0; i < K2; i++) lanes.push(lane(oxyRdy[i], iccRdy[i]));
    await Promise.all(lanes);
    clearInterval(_hb); lockRelease();
    var elapsed = (performance.now() - t0) / 1000;
    if (!CANCEL) await ckptClear(); else ckptSave({ ver: ver, targetSubj: targetSubj, minNights: minNights, cursor: cursor, SUBJ: SUBJ, savedAt: Date.now() });
    try { localStorage.setItem('nicc_ptPerSec', String(pdone / Math.max(0.001, elapsed))); } catch (e) {}

    setProg(1);
    if ($('cancel')) $('cancel').style.display = 'none';
    setStatus((CANCEL ? 'cancelled — partial · ' : 'done · ') + SUBJ.length + ' subjects in ' + fmtETA(elapsed), CANCEL ? 'idle' : 'done');
    try { updEta(); } catch (e) {}
    if (SUBJ.length) analyze();
    $('run').disabled = false;
    ['dlCsv', 'dlStats', 'dlFig'].forEach(function (id) { $(id).disabled = !SUBJ.length; });
  }

  // ── analyze ──
  function analyze() {
    var target = Math.max(0.5, Math.min(0.95, +$('tgt').value || 0.8));
    $('tgtEcho').textContent = target.toFixed(2);
    var stats = {};
    MET.forEach(function (m) {
      var groups = SUBJ.map(function (s) { return s[m]; }).filter(function (a) { return a.length >= minNights; });
      stats[m] = iccOneWay(groups);
    });
    // latent (planted) ICC for the two metrics with a clean latent target
    var lat = {};
    ['odi', 'rmssd'].forEach(function (m) {
      var key = m + 'Latent';
      var groups = SUBJ.map(function (s) { return s[key]; }).filter(function (a) { return a.length >= minNights; });
      lat[m] = iccOneWay(groups);
    });

    // headline + table
    var tb = '', cards = '';
    MET.forEach(function (m) {
      var st = stats[m], mm = META[m];
      var icc = st ? st.icc : null;
      var n75 = st ? minOcc(icc, 0.75) : null, n80 = st ? minOcc(icc, 0.80) : null, n90 = st ? minOcc(icc, 0.90) : null;
      var nT  = st ? minOcc(icc, target) : null;
      tb += '<tr>'
          + '<td><span class="chip" style="background:' + mm.color + '"></span>' + mm.label + '</td>'
          + '<td class="dim">' + mm.node + '</td>'
          + '<td class="num">' + (icc != null ? icc.toFixed(3) : '—') + '</td>'
          + '<td class="num">' + (st ? st.k : '—') + '</td>'
          + '<td class="num">' + (st ? st.N : '—') + '</td>'
          + '<td class="num">' + fmtN(n75) + '</td>'
          + '<td class="num">' + fmtN(n80) + '</td>'
          + '<td class="num">' + fmtN(n90) + '</td>'
          + '</tr>';
      cards += '<div class="hcard"><div class="hl" style="color:' + mm.color + '">' + (nT != null && isFinite(nT) ? nT : '—') + '<span class="hu"> ' + mm.occ + (nT === 1 ? '' : 's') + '</span></div>'
            + '<div class="hk">' + mm.label + ' · min for ICC ≥ ' + target.toFixed(2) + '</div>'
            + '<div class="hs">single-' + mm.occ + ' ICC ' + (icc != null ? icc.toFixed(2) : '—') + '</div></div>';
    });
    $('tblBody').innerHTML = tb;
    $('headline').innerHTML = cards;

    // non-circular note
    var nc = '';
    ['odi', 'rmssd'].forEach(function (m) {
      if (stats[m] && lat[m]) nc += META[m].label + ': measured ICC ' + stats[m].icc.toFixed(2) + ' vs latent ' + lat[m].icc.toFixed(2) + '.  ';
    });
    $('ncNote').textContent = nc || '—';

    RESULT = { generated: new Date().toISOString(), target: target, minNights: minNights,
      nSubjects: SUBJ.length,
      framing: 'Test-retest reliability on STABLE (flat-arc) synthetic patients, 1–12-night longitudinal lane. Each occasion measured by the REAL detector (ODI-4 OxyDex / rMSSD PulseDex / CGM-CV GlucoDex day-split). ICC(1,1) one-way random effects; Spearman–Brown → minimum occasions per target. Latent ICC = same ANOVA on planted targets (non-circular detector check). Synthetic ground truth — certifies the reliability structure of the pipeline, not real-world clinical reliability.',
      metrics: {}, latent: {} };
    MET.forEach(function (m) {
      var st = stats[m]; if (!st) return;
      RESULT.metrics[m] = { node: META[m].node, occasion: META[m].occ, unit: META[m].unit,
        icc1: +st.icc.toFixed(4), subjects: st.k, occasions: st.N, medianOccPerSubject: st.medianOcc,
        varBetween: +st.varB.toFixed(4), varWithin: +st.varW.toFixed(4),
        withinSD: +st.withinSD.toFixed(3), withinCVpct: st.withinCVpct != null ? +st.withinCVpct.toFixed(1) : null,
        minOcc: { '0.75': minOcc(st.icc, 0.75), '0.80': minOcc(st.icc, 0.80), '0.90': minOcc(st.icc, 0.90), target: minOcc(st.icc, target) } };
    });
    ['odi', 'rmssd'].forEach(function (m) { if (lat[m]) RESULT.latent[m] = { icc1: +lat[m].icc.toFixed(4), subjects: lat[m].k }; });

    drawCurves(stats, target);
    drawIcc(stats, target);
    drawRepro(stats);
    try { window.NIGHTS_ICC = RESULT; } catch (e) {}
  }
  function fmtN(n) { return n == null ? '—' : (isFinite(n) ? n : '∞'); }

  // ════════ figures ════════
  function clearC(ctx, w, h) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0f141b'; ctx.fillRect(0, 0, w, h); }
  function axes(ctx, P, w, h, xmin, xmax, ymin, ymax, xt, yt, xlab, ylab, xfmt, yfmt) {
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.fillStyle = '#6f8096'; ctx.font = '11px ui-monospace,monospace';
    ctx.beginPath(); ctx.moveTo(P, 12); ctx.lineTo(P, h - P); ctx.lineTo(w - 14, h - P); ctx.stroke();
    var i;
    for (i = 0; i <= xt; i++) {
      var xv = xmin + (xmax - xmin) * i / xt, px = P + (w - P - 14) * i / xt;
      ctx.fillStyle = '#6f8096'; ctx.fillText(xfmt ? xfmt(xv) : Math.round(xv), px - 6, h - P + 16);
    }
    for (i = 0; i <= yt; i++) {
      var yv = ymin + (ymax - ymin) * i / yt, py = (h - P) - (h - P - 12) * i / yt;
      ctx.fillStyle = '#6f8096'; ctx.fillText(yfmt ? yfmt(yv) : Math.round(yv), 8, py + 4);
      ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(P, py); ctx.lineTo(w - 14, py); ctx.stroke();
    }
    ctx.fillStyle = '#aab8cc'; ctx.font = '11px ui-monospace,monospace';
    ctx.fillText(xlab, w / 2 - 40, h - 5);
    ctx.save(); ctx.translate(13, h / 2 + 34); ctx.rotate(-Math.PI / 2); ctx.fillText(ylab, 0, 0); ctx.restore();
  }
  function drawCurves(stats, target) {
    var cv = $('curves'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 46; clearC(ctx, w, h);
    var XMAX = 12;
    axes(ctx, P, w, h, 1, XMAX, 0, 1, 11, 5, 'occasions averaged (nights / days)', 'reliability  ICC(m)',
      function (v) { return Math.round(v); }, function (v) { return v.toFixed(1); });
    var X = function (m) { return P + (w - P - 14) * (m - 1) / (XMAX - 1); };
    var Y = function (r) { return (h - P) - (h - P - 12) * r; };
    // target line
    ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(P, Y(target)); ctx.lineTo(w - 14, Y(target)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#9fb0c4'; ctx.font = '10px ui-monospace'; ctx.fillText('target ' + target.toFixed(2), w - 110, Y(target) - 5);
    MET.forEach(function (m) {
      var st = stats[m]; if (!st) return; var icc = st.icc, col = META[m].color;
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath();
      for (var mm = 1; mm <= XMAX; mm++) { var r = sb(icc, mm); (mm === 1 ? ctx.moveTo : ctx.lineTo).call(ctx, X(mm), Y(r)); }
      ctx.stroke();
      // single-occasion dot
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(1), Y(icc), 3.2, 0, 7); ctx.fill();
      // knee marker at min occasions for target
      var k = minOcc(icc, target);
      if (isFinite(k) && k <= XMAX) {
        var kx = X(k), ky = Y(sb(icc, k));
        ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(kx, h - P); ctx.lineTo(kx, ky); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(kx, ky, 4.2, 0, 7); ctx.fill();
        ctx.fillStyle = '#e6edf6'; ctx.font = 'bold 11px ui-monospace'; ctx.fillText(META[m].label + ' → ' + k, kx + 7, ky - 6);
      }
    });
    $('curvesLeg').innerHTML = MET.map(function (m) { var st = stats[m]; return '<span class="chip" style="background:' + META[m].color + '"></span>' + META[m].label + (st ? ' (ICC₁=' + st.icc.toFixed(2) + ')' : ''); }).join(' &nbsp; ');
  }
  function drawIcc(stats, target) {
    var cv = $('iccbars'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height; clearC(ctx, w, h);
    var P = 96, top = 26, rowH = 64, x0 = P, x1 = w - 130;
    ctx.font = '11px ui-monospace'; ctx.fillStyle = '#6f8096';
    // scale ticks 0..1
    for (var t = 0; t <= 5; t++) { var gx = x0 + (x1 - x0) * t / 5; ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(gx, top - 6); ctx.lineTo(gx, top + rowH * MET.length); ctx.stroke(); ctx.fillStyle = '#6f8096'; ctx.fillText((t / 5).toFixed(1), gx - 7, top + rowH * MET.length + 16); }
    MET.forEach(function (m, i) {
      var st = stats[m]; var y = top + i * rowH + 8, bh = 26, col = META[m].color;
      ctx.fillStyle = '#e6edf6'; ctx.font = 'bold 13px ui-sans-serif,system-ui'; ctx.fillText(META[m].label, 12, y + bh - 7);
      ctx.fillStyle = '#6f8096'; ctx.font = '10px ui-monospace'; ctx.fillText(META[m].node, 12, y + bh + 8);
      if (!st) return;
      // between (filled = ICC) + within fraction
      var icc = st.icc, bw = (x1 - x0);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; rrect(ctx, x0, y, bw, bh, 5); ctx.fill();
      ctx.fillStyle = col; rrect(ctx, x0, y, bw * icc, bh, 5); ctx.fill();
      ctx.fillStyle = '#0b0e13'; ctx.font = 'bold 12px ui-monospace'; ctx.fillText(icc.toFixed(2), x0 + 8, y + bh - 8);
      // min-occasion annotation
      var k = minOcc(icc, target);
      ctx.fillStyle = '#aab8cc'; ctx.font = '11px ui-monospace'; ctx.textAlign = 'left';
      ctx.fillText('→ ' + (isFinite(k) ? k : '∞') + ' ' + META[m].occ + (k === 1 ? '' : 's'), x1 + 10, y + bh - 8);
    });
    ctx.fillStyle = '#9fb0c4'; ctx.font = '11px ui-monospace'; ctx.fillText('single-occasion ICC (filled = reliable share of variance)   ·   target ICC ≥ ' + target.toFixed(2), 12, top + rowH * MET.length + 16);
  }
  function rrect(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawRepro(stats) {
    // per-subject mean ± night spread for rMSSD (the most labile metric) — visualizes within vs between
    var cv = $('repro'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 46; clearC(ctx, w, h);
    var subs = SUBJ.filter(function (s) { return s.rmssd.length >= minNights; })
                   .map(function (s) { return { vals: s.rmssd, m: mean(s.rmssd) }; })
                   .sort(function (a, b) { return a.m - b.m; });
    if (!subs.length) { ctx.fillStyle = '#6f8096'; ctx.font = '12px ui-monospace'; ctx.fillText('run to populate', 20, 40); return; }
    var allv = []; subs.forEach(function (s) { s.vals.forEach(function (v) { allv.push(v); }); });
    var ymin = Math.max(0, Math.floor(Math.min.apply(null, allv) / 5) * 5 - 2), ymax = Math.ceil(Math.max.apply(null, allv) / 5) * 5 + 2;
    axes(ctx, P, w, h, 1, subs.length, ymin, ymax, Math.min(subs.length - 1, 6), 5, 'subject (sorted by mean rMSSD)', 'measured rMSSD (ms)',
      function () { return ''; }, function (v) { return Math.round(v); });
    var X = function (i) { return P + (w - P - 14) * (subs.length <= 1 ? 0.5 : i / (subs.length - 1)); };
    var Y = function (v) { return (h - P) - (h - P - 12) * (v - ymin) / (ymax - ymin); };
    subs.forEach(function (s, i) {
      var x = X(i);
      ctx.strokeStyle = 'rgba(255,184,77,.30)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x, Y(Math.min.apply(null, s.vals))); ctx.lineTo(x, Y(Math.max.apply(null, s.vals))); ctx.stroke();
      s.vals.forEach(function (v) { ctx.fillStyle = 'rgba(255,184,77,.55)'; ctx.beginPath(); ctx.arc(x, Y(v), 2, 0, 7); ctx.fill(); });
      ctx.fillStyle = '#FFB84D'; ctx.beginPath(); ctx.arc(x, Y(s.m), 3, 0, 7); ctx.fill();
    });
    var st = stats.rmssd;
    $('reproLeg').innerHTML = 'Each column = one subject (vertical bar = night-to-night range, large dot = subject mean). '
      + (st ? 'Between-subject SD ' + Math.sqrt(st.varB).toFixed(1) + ' ms vs within-subject (night) SD ' + st.withinSD.toFixed(1) + ' ms → ICC₁ ' + st.icc.toFixed(2) + '.' : '');
  }

  // ── exports ──
  function dl(name, text, mime) { var b = new Blob([text], { type: mime || 'text/plain' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  $('dlCsv').onclick = function () {
    var rows = [['seed', 'age', 'baseAHI', 'severity', 'metric', 'occasion_index', 'value']];
    SUBJ.forEach(function (s) {
      MET.forEach(function (m) { s[m].forEach(function (v, i) { rows.push([s.seed, s.age, s.baseAHI, s.sev, m, i, v]); }); });
    });
    dl('nights-icc-results.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
  };
  $('dlStats').onclick = function () { dl('nights-icc-stats.json', JSON.stringify(RESULT, null, 2), 'application/json'); };
  $('dlFig').onclick = function () {
    var a = $('curves'), b = $('iccbars'), c = $('repro'), gap = 16;
    var W = a.width + gap * 2, H = a.height + b.height + c.height + gap * 4;
    var out = document.createElement('canvas'); out.width = W; out.height = H; var ctx = out.getContext('2d');
    ctx.fillStyle = '#0c0f14'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(a, gap, gap); ctx.drawImage(b, gap, gap * 2 + a.height); ctx.drawImage(c, gap, gap * 3 + a.height + b.height);
    out.toBlob(function (bl) { var u = URL.createObjectURL(bl); var an = document.createElement('a'); an.href = u; an.download = 'nights-icc-figures.png'; an.click(); }, 'image/png');
  };
  $('tgt').oninput = function () { if (RESULT) analyze(); };
  var CANCEL = false;
  $('run').onclick = function () { run(); };
  if ($('cancel')) $('cancel').onclick = function () { CANCEL = true; $('cancel').disabled = true; setStatus('cancelling…', 'run'); };
  function updEta() {
    var e = $('eta'); if (!e) return;
    var n = Math.max(10, Math.min(100000, +$('nSubj').value || 40));
    var rate = parseFloat(localStorage.getItem('nicc_ptPerSec'));
    if (rate && isFinite(rate) && rate > 0) e.textContent = '≈ ' + fmtETA(n / rate) + ' on this machine (' + rate.toFixed(0) + ' subj/s · ' + (navigator.hardwareConcurrency || '?') + ' cores)';
    else e.textContent = '↑ first run calibrates a per-machine time estimate (real detectors, ' + (navigator.hardwareConcurrency || '?') + ' cores)';
  }
  if ($('nSubj')) $('nSubj').addEventListener('input', updEta);
  updEta();
  (function () {
    async function tryResume() {
      try {
        var ck = await ckptLoad();
        if (!(ck && ck.ver === genVer() && ck.cursor < ck.targetSubj && (Date.now() - (ck.savedAt || 0)) < 20 * 60000)) return;
        if (lockHeldByOther()) { setStatus('another instance running ' + ck.cursor + '/' + ck.targetSubj + '… (watching)', 'run'); setTimeout(tryResume, 5000 + Math.random() * 2000); return; }
        if ($('nSubj')) $('nSubj').value = ck.targetSubj;
        if ($('minN')) $('minN').value = ck.minNights;
        setStatus('resuming previous run ' + ck.cursor + '…', 'run');
        run(ck);
      } catch (e) {}
    }
    tryResume();
  })();
})();
