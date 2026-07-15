/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   treatment-response-analysis.js — "Treatment-response detection" engine.

   For each INTERVENTION-arc synthetic patient in the 1–12-night longitudinal lane
   the suite plants a CPAP-start night (profile.interventionNight, 0-based index of
   the first treated night): ODI-4 steps DOWN and rMSSD steps UP at that boundary.
   We measure both metrics PER NIGHT with the REAL detectors (ODI-4 OxyDex, rMSSD
   PulseDex) and ask: can a single change-point detector recover the planted night
   from the noisy trajectory — and detect that a change happened at all?

     · localization — single change-point by minimum within-segment SSE, per metric
       (ODI-4, rMSSD) and FUSED (z-scored, rMSSD sign-flipped, averaged). Scored vs
       the planted night: exact, within ±1 night, median |error|.
     · detection   — step-model R² (1 − SSE_split/SSE_total) as a "a change happened"
       statistic; ROC/AUC of intervention patients vs FLAT-arc controls (no change).

   HONEST FRAMING (in-page + export): synthetic ground truth. The planted step is a
   known, fairly clean drop; this certifies that the pipeline + a vanilla change-point
   detector recover a treatment response and localize it — NOT real-world CPAP-response
   detection, which is noisier and confounded. 100% local; reuses cohort-gen.js +
   the two real-DSP harness realms (cohort-harness.html?node=oxydex|pulsedex).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var pend = new Map(), seq = 1;
  var TX = [], FLAT = [], RESULT = null;
  var minNights, targetSubj;

  function $(id) { return document.getElementById(id); }
  function setStatus(t, c) { var e = $('status'); e.textContent = t; e.className = 'pill ' + (c || 'idle'); }
  function setProg(f) { $('progBar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }

  // ── TWO Web-Worker pools (OxyDex + PulseDex collide on bare globals, so they MUST live in
  //   separate realms). Each seed is scored by BOTH pools off the main thread → true multicore.
  //   Mirrors hrv-confound's pool; both kinds (`oxy`, `pulse`) already exist in cohort-worker.js.
  var oxyPool = [], pulsePool = [];
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
  function bootPools(K) { return Promise.all([bootKind(oxyPool, 'oxy', K), bootKind(pulsePool, 'pulse', K)]); }
  function runSeed(rec, seed) {
    return new Promise(function (resolve) {
      var id = seq++; pend.set(id, resolve);
      rec.w.postMessage({ type: 'job', reqId: id, seed: seed });
      setTimeout(function () { if (pend.has(id)) { pend.delete(id); resolve({ error: 'timeout' }); } }, 120000);
    });
  }

  // ── durable checkpoint + single-instance lock (so a preview refresh resumes, not restarts) ──
  function idbOpen() { return new Promise(function (res, rej) { var r = indexedDB.open('txresp_ckpt', 1); r.onupgradeneeded = function () { r.result.createObjectStore('s'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  async function ckptSave(o) { try { var db = await idbOpen(); await new Promise(function (res, rej) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(o, 'run'); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); db.close(); } catch (e) {} }
  async function ckptLoad() { try { var db = await idbOpen(); var o = await new Promise(function (res, rej) { var tx = db.transaction('s', 'readonly'); var rq = tx.objectStore('s').get('run'); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); db.close(); return o; } catch (e) { return null; } }
  async function ckptClear() { try { var db = await idbOpen(); await new Promise(function (res) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').delete('run'); tx.oncomplete = res; }); db.close(); } catch (e) {} }
  function genVer() { return (window.CohortGen && CohortGen.VERSION) || '?'; }
  var RUN_ID = Math.random().toString(36).slice(2);
  function lockFresh() { try { var l = JSON.parse(localStorage.getItem('txresp_lock') || 'null'); return (l && (Date.now() - l.ts) < 6000) ? l : null; } catch (e) { return null; } }
  function lockHeldByOther() { var l = lockFresh(); return !!(l && l.id !== RUN_ID); }
  function lockBeat() { try { localStorage.setItem('txresp_lock', JSON.stringify({ id: RUN_ID, ts: Date.now() })); } catch (e) {} }
  function lockRelease() { try { var l = lockFresh(); if (l && l.id === RUN_ID) localStorage.removeItem('txresp_lock'); } catch (e) {} }
  function fmtETA(sec) { if (!isFinite(sec) || sec < 0) return '—'; var m = Math.floor(sec / 60), s = Math.round(sec % 60); return m ? (m + 'm' + (s < 10 ? '0' : '') + s + 's') : (s + 's'); }

  // ── stats helpers ──
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function sse(a) { if (a.length < 1) return 0; var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return s; }
  function std(a) { return a.length > 1 ? Math.sqrt(sse(a) / (a.length - 1)) : 0; }
  function zscore(a) { var m = mean(a), s = std(a) || 1; return a.map(function (v) { return (v - m) / s; }); }

  // single change-point: minimise within-segment SSE; k = first index of RIGHT segment.
  // requires ≥2 points each side. returns { k, r2, meanL, meanR } or null.
  // Single-sourced in analysis-stats.js (TEST-COVERAGE-ANALYSIS 2026-07-15) — known-answer tested in
  // dex-tests.js. Aliased so call sites are untouched; behavior is identical.
  var bestSplit = AnalysisStats.bestSplit;

  // join one patient's per-night ODI-4 (oxy pool) + rMSSD (pulse pool) results, both from
  // the SAME deterministic seed. Full coverage required (any gap → skip, as before).
  function measureFromResults(seed, oxyRes, pulseRes) {
    if (!oxyRes || !oxyRes.result || !pulseRes || !pulseRes.result) return null;
    var prof = (oxyRes.result.meta && oxyRes.result.meta.profile) || (pulseRes.result.meta && pulseRes.result.meta.profile);
    if (!prof) return null;
    var N = prof.nNights;
    var on = oxyRes.result.oxy && oxyRes.result.oxy.score && oxyRes.result.oxy.score.nights;
    if (!on || on.length !== N) return null;
    var odi = [];
    for (var i = 0; i < N; i++) { var sc = on[i]; if (!sc || sc.odi == null || !isFinite(sc.odi)) return null; odi.push(sc.odi); }
    var pn = pulseRes.result.pulse || [];
    var pairs = pn.map(function (pp) { var ps = pp.score || pp; return { n: (pp.n != null ? pp.n : ps.n), v: ps.rmssd }; })
                  .filter(function (o) { return o.v != null && isFinite(o.v); })
                  .sort(function (a, b) { return a.n - b.n; });
    if (pairs.length !== N) return null;
    var rmssd = pairs.map(function (o) { return o.v; });
    return { seed: seed, nNights: N, arc: prof.arc, cp: prof.interventionNight,
             baseAHI: prof.baseAHI, age: prof.age, odi: odi, rmssd: rmssd };
  }

  // build the three detectors for one measured patient
  function detect(p) {
    var fused = (function () { var zo = zscore(p.odi), zr = zscore(p.rmssd); return zo.map(function (v, i) { return (-v + zr[i]) / 2; }); })();
    return { odi: bestSplit(p.odi), rmssd: bestSplit(p.rmssd), fused: bestSplit(fused) };
  }

  async function run(resumeCk) {
    if (lockHeldByOther()) { setStatus('another tab/instance is running this cohort — not duplicating', 'idle'); $('run').disabled = false; return; }
    lockBeat(); var _hb = setInterval(lockBeat, 2000);
    $('run').disabled = true; CANCEL = false;
    if ($('cancel')) { $('cancel').style.display = ''; $('cancel').disabled = false; }
    minNights  = Math.max(5, Math.min(12, +$('minN').value || 6));
    targetSubj = Math.max(15, Math.min(100000, +$('nSubj').value || 45));
    var ver = genVer();
    var K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    setStatus('booting ' + K + '× OxyDex + ' + K + '× PulseDex realms…', 'run'); setProg(0);
    if (!oxyPool.length || !pulsePool.length) await bootPools(K);
    var oxyRdy = oxyPool.filter(function (r) { return r.ready; }), pulseRdy = pulsePool.filter(function (r) { return r.ready; });
    if (!oxyRdy.length || !pulseRdy.length) { setStatus('worker boot failed', 'idle'); $('run').disabled = false; clearInterval(_hb); lockRelease(); return; }

    // scan for intervention-arc patients (≥2 pre & ≥2 post) + matched flat-arc controls
    // (profiles only — cheap, deterministic, so resume re-derives the identical seed list).
    setStatus('scanning profiles…', 'run');
    var txSeeds = [], flatSeeds = [], seed = 0, CAP = 2000000;
    while ((txSeeds.length < targetSubj || flatSeeds.length < targetSubj) && seed < CAP) {
      var pf; try { pf = CohortGen.sampleProfile(seed); } catch (e) { seed++; continue; }
      if (pf) {
        if (pf.arc === 'intervention' && pf.nNights >= minNights &&
            pf.interventionNight >= 2 && pf.interventionNight <= pf.nNights - 2 &&
            txSeeds.length < targetSubj) txSeeds.push(seed);
        else if (pf.arc === 'flat' && pf.nNights >= minNights && flatSeeds.length < targetSubj) flatSeeds.push(seed);
      }
      seed++;
    }
    // interleave tx + flat so any partial/snapshot cohort is balanced (both arms accumulate
    // together) — concatenating would measure all intervention patients before any control.
    var all = [], _mx = Math.max(txSeeds.length, flatSeeds.length);
    for (var _i = 0; _i < _mx; _i++) {
      if (_i < txSeeds.length) all.push({ s: txSeeds[_i], grp: 'tx' });
      if (_i < flatSeeds.length) all.push({ s: flatSeeds[_i], grp: 'flat' });
    }
    var total = all.length;

    var startCursor = 0;
    if (resumeCk && resumeCk.ver === ver && resumeCk.targetSubj === targetSubj && resumeCk.minNights === minNights && resumeCk.cursor < total && Array.isArray(resumeCk.TX)) {
      TX = resumeCk.TX; FLAT = resumeCk.FLAT; startCursor = resumeCk.cursor;
      setStatus('resuming ' + startCursor + '/' + total + '…', 'run');
    } else { TX = []; FLAT = []; await ckptClear(); }

    var cursor = startCursor, pdone = 0, t0 = performance.now();
    async function lane(oxyW, pulseW) {
      while (!CANCEL) {
        var idx = cursor++; if (idx >= total) return;
        var item = all[idx];
        var pair = await Promise.all([runSeed(oxyW, item.s), runSeed(pulseW, item.s)]);
        pdone++;
        var rec = measureFromResults(item.s, pair[0], pair[1]);
        if (rec) { rec.det = detect(rec); (item.grp === 'tx' ? TX : FLAT).push(rec); }
        var done = startCursor + pdone;
        if (pdone % 4 === 0 || done === total) {
          var el = (performance.now() - t0) / 1000, rate = pdone / el;
          setProg(done / total);
          setStatus('patient ' + done + '/' + total + ' · ' + oxyRdy.length + '× · tx=' + TX.length + ' flat=' + FLAT.length + ' · ETA ' + fmtETA((total - done) / (rate || 1)), 'run');
          await new Promise(function (r) { setTimeout(r, 0); });
        }
        if (pdone % 64 === 0) ckptSave({ ver: ver, targetSubj: targetSubj, minNights: minNights, cursor: cursor, TX: TX, FLAT: FLAT, savedAt: Date.now() });
      }
    }
    var K2 = Math.min(oxyRdy.length, pulseRdy.length), lanes = [];
    for (var i = 0; i < K2; i++) lanes.push(lane(oxyRdy[i], pulseRdy[i]));
    await Promise.all(lanes);
    clearInterval(_hb); lockRelease();
    var elapsed = (performance.now() - t0) / 1000;
    if (!CANCEL) await ckptClear(); else ckptSave({ ver: ver, targetSubj: targetSubj, minNights: minNights, cursor: cursor, TX: TX, FLAT: FLAT, savedAt: Date.now() });
    try { localStorage.setItem('txresp_ptPerSec', String(pdone / Math.max(0.001, elapsed))); } catch (e) {}

    setProg(1);
    if ($('cancel')) $('cancel').style.display = 'none';
    setStatus((CANCEL ? 'cancelled — partial · tx=' : 'done · tx=') + TX.length + ' flat=' + FLAT.length + ' in ' + fmtETA(elapsed), CANCEL ? 'idle' : 'done');
    try { updEta(); } catch (e) {}
    if (TX.length || FLAT.length) analyze();
    $('run').disabled = false;
    ['dlCsv', 'dlStats', 'dlFig'].forEach(function (id) { $(id).disabled = (!TX.length && !FLAT.length); });
  }

  // ── analysis ──
  var DET = ['odi', 'rmssd', 'fused'];
  var DMETA = { odi: { label: 'ODI-4', color: '#58A6FF' }, rmssd: { label: 'rMSSD', color: '#FFB84D' }, fused: { label: 'Fused', color: '#3DE0D0' } };

  // Mann–Whitney AUC single-sourced in analysis-stats.js (TEST-COVERAGE-ANALYSIS 2026-07-15) —
  // known-answer tested in dex-tests.js. Aliased so call sites are untouched; behavior is identical.
  var auc = AnalysisStats.mannWhitneyAUC;

  function analyze() {
    var loc = {}, det = {};
    DET.forEach(function (d) {
      var errs = [], exact = 0, w1 = 0, n = 0;
      TX.forEach(function (p) { var b = p.det[d]; if (!b) return; var e = b.k - p.cp; errs.push(Math.abs(e)); if (e === 0) exact++; if (Math.abs(e) <= 1) w1++; n++; });
      errs.sort(function (a, b) { return a - b; });
      loc[d] = { n: n, exactPct: n ? 100 * exact / n : null, within1Pct: n ? 100 * w1 / n : null,
                 medAbsErr: errs.length ? (errs.length % 2 ? errs[errs.length >> 1] : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2) : null };
      var posR2 = TX.map(function (p) { return p.det[d] ? p.det[d].r2 : null; }).filter(function (v) { return v != null; });
      var negR2 = FLAT.map(function (p) { return p.det[d] ? p.det[d].r2 : null; }).filter(function (v) { return v != null; });
      det[d] = { auc: auc(posR2, negR2), txMedR2: median(posR2), flatMedR2: median(negR2) };
    });

    // headline cards
    var cards = '';
    cards += hcard(DMETA.fused.color, (loc.fused.within1Pct != null ? loc.fused.within1Pct.toFixed(0) + '%' : '—'), 'Fused · CPAP-night localized within ±1 night', 'exact ' + (loc.fused.exactPct != null ? loc.fused.exactPct.toFixed(0) + '%' : '—'));
    cards += hcard(DMETA.fused.color, (det.fused.auc != null ? det.fused.auc.toFixed(2) : '—'), 'Fused · detection AUC (intervention vs flat)', 'step-R² ' + fmt(det.fused.txMedR2) + ' vs ' + fmt(det.fused.flatMedR2));
    cards += hcard('#9fb0c4', TX.length + ' / ' + FLAT.length, 'intervention / flat-control patients', 'min ' + minNights + ' nights · ≥2 pre & ≥2 post');
    $('headline').innerHTML = cards;

    // table
    var tb = '';
    DET.forEach(function (d) {
      tb += '<tr><td><span class="chip" style="background:' + DETA(d) + '"></span>' + DMETA[d].label + '</td>'
          + '<td class="num">' + loc[d].n + '</td>'
          + '<td class="num">' + pct(loc[d].exactPct) + '</td>'
          + '<td class="num">' + pct(loc[d].within1Pct) + '</td>'
          + '<td class="num">' + (loc[d].medAbsErr != null ? loc[d].medAbsErr.toFixed(1) : '—') + '</td>'
          + '<td class="num">' + (det[d].auc != null ? det[d].auc.toFixed(2) : '—') + '</td>'
          + '<td class="num">' + fmt(det[d].txMedR2) + '</td>'
          + '<td class="num">' + fmt(det[d].flatMedR2) + '</td></tr>';
    });
    $('tblBody').innerHTML = tb;

    RESULT = { generated: new Date().toISOString(), minNights: minNights,
      nIntervention: TX.length, nFlatControl: FLAT.length,
      framing: 'Intervention-arc synthetic patients (planted CPAP-start night = first treated night, 0-based index; restricted to ≥2 pre- and ≥2 post-treatment nights). Per-night ODI-4 (OxyDex) and rMSSD (PulseDex) measured by the REAL detectors. Single change-point by minimum within-segment SSE; FUSED = z-scored ODI-4 (sign-flipped) + rMSSD averaged. Localization scored vs the planted night; detection = step-R² AUC vs flat-arc controls. Synthetic ground truth — certifies pipeline + change-point recovery, not real-world CPAP-response detection.',
      localization: loc, detection: det };
    try { window.TREATMENT_RESPONSE = RESULT; } catch (e) {}

    drawExample(); drawAccuracy(loc); drawRoc(det);
  }
  function DETA(d) { return DMETA[d].color; }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function fmt(v) { return v == null ? '—' : v.toFixed(2); }
  function pct(v) { return v == null ? '—' : v.toFixed(0) + '%'; }
  function hcard(col, big, k, sub) { return '<div class="hcard"><div class="hl" style="color:' + col + '">' + big + '</div><div class="hk">' + k + '</div><div class="hs">' + sub + '</div></div>'; }

  // ════════ figures ════════
  function clearC(ctx, w, h) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0f141b'; ctx.fillRect(0, 0, w, h); }
  function rrect(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // representative intervention patient: dual-axis ODI-4 + rMSSD with planted & detected CP
  function drawExample() {
    var cv = $('example'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 46; clearC(ctx, w, h);
    // pick the median-nNights intervention patient with a correct-ish fused detection, else first
    var p = TX.find(function (q) { return q.det.fused && Math.abs(q.det.fused.k - q.cp) <= 1 && q.nNights >= 7; }) || TX[0];
    if (!p) { ctx.fillStyle = '#6f8096'; ctx.font = '12px ui-monospace'; ctx.fillText('run to populate', 20, 40); return; }
    var N = p.nNights;
    var odiMax = Math.max.apply(null, p.odi) * 1.15 + 1, rmMin = Math.min.apply(null, p.rmssd) - 3, rmMax = Math.max.apply(null, p.rmssd) + 3;
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(P, 14); ctx.lineTo(P, h - P); ctx.lineTo(w - P, h - P); ctx.stroke();
    var X = function (i) { return P + (w - 2 * P) * (N <= 1 ? 0.5 : i / (N - 1)); };
    var Yo = function (v) { return (h - P) - (h - P - 14) * (v / odiMax); };
    var Yr = function (v) { return (h - P) - (h - P - 14) * ((v - rmMin) / (rmMax - rmMin)); };
    // planted CP band (between cp-1 and cp)
    var cx = (X(p.cp - 1) + X(p.cp)) / 2;
    ctx.fillStyle = 'rgba(57,217,138,.10)'; ctx.fillRect(cx, 14, w - P - cx, h - P - 14);
    ctx.strokeStyle = 'rgba(57,217,138,.7)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(cx, 14); ctx.lineTo(cx, h - P); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#39D98A'; ctx.font = '10px ui-monospace'; ctx.fillText('planted CPAP start', cx + 6, 26);
    // detected fused CP
    if (p.det.fused) { var dx = (X(p.det.fused.k - 1) + X(p.det.fused.k)) / 2; ctx.strokeStyle = 'rgba(61,224,208,.9)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(dx, 14); ctx.lineTo(dx, h - P); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#3DE0D0'; ctx.fillText('detected', dx + 6, h - P - 8); }
    // series
    function line(arr, Y, col) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); arr.forEach(function (v, i) { (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(i), Y(v)); }); ctx.stroke(); arr.forEach(function (v, i) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(i), Y(v), 3, 0, 7); ctx.fill(); }); }
    line(p.odi, Yo, '#58A6FF'); line(p.rmssd, Yr, '#FFB84D');
    ctx.fillStyle = '#9fb0c4'; ctx.font = '11px ui-monospace';
    ctx.fillText('night →', w / 2 - 20, h - P + 20);
    ctx.fillStyle = '#58A6FF'; ctx.fillText('● ODI-4 (events/h)', P + 4, h - 8);
    ctx.fillStyle = '#FFB84D'; ctx.fillText('● rMSSD (ms)', P + 150, h - 8);
    $('exampleLeg').innerHTML = 'Patient ' + p.seed + ' · ' + N + ' nights · planted CPAP-start night ' + p.cp + (p.det.fused ? ' · fused detected night ' + p.det.fused.k + ' (err ' + (p.det.fused.k - p.cp) + ')' : '');
  }

  function drawAccuracy(loc) {
    var cv = $('acc'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height; clearC(ctx, w, h);
    var P = 90, top = 26, rowH = 60, x0 = P, x1 = w - 70;
    for (var t = 0; t <= 5; t++) { var gx = x0 + (x1 - x0) * t / 5; ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(gx, top - 6); ctx.lineTo(gx, top + rowH * DET.length); ctx.stroke(); ctx.fillStyle = '#6f8096'; ctx.font = '10px ui-monospace'; ctx.fillText((t * 20) + '%', gx - 8, top + rowH * DET.length + 30); }
    DET.forEach(function (d, i) {
      var y = top + i * rowH + 6, bh = 18, col = DETA(d), L = loc[d];
      ctx.fillStyle = '#e6edf6'; ctx.font = 'bold 13px ui-sans-serif,system-ui'; ctx.fillText(DMETA[d].label, 12, y + 14);
      // within ±1 (light) then exact (solid) overlaid
      ctx.fillStyle = 'rgba(255,255,255,.07)'; rrect(ctx, x0, y, x1 - x0, bh, 4); ctx.fill();
      if (L.within1Pct != null) { ctx.fillStyle = col + '66'; rrect(ctx, x0, y, (x1 - x0) * L.within1Pct / 100, bh, 4); ctx.fill(); }
      if (L.exactPct != null) { ctx.fillStyle = col; rrect(ctx, x0, y, (x1 - x0) * L.exactPct / 100, bh, 4); ctx.fill(); }
      ctx.fillStyle = '#0b0e13'; ctx.font = 'bold 11px ui-monospace'; if (L.exactPct != null) ctx.fillText(L.exactPct.toFixed(0) + '%', x0 + 6, y + 13);
      ctx.fillStyle = '#aab8cc'; ctx.font = '10px ui-monospace'; ctx.fillText('±1: ' + pct(L.within1Pct), x0 + 4, y + 32);
    });
    ctx.fillStyle = '#9fb0c4'; ctx.font = '11px ui-monospace'; ctx.fillText('CPAP-night localization — solid = exact, light = within ±1 night', 12, top + rowH * DET.length + 14);
  }

  function drawRoc(det) {
    var cv = $('roc'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 44; clearC(ctx, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(P, 14); ctx.lineTo(P, h - P); ctx.lineTo(w - 14, h - P); ctx.stroke();
    var X = function (v) { return P + (w - P - 14) * v; }, Y = function (v) { return (h - P) - (h - P - 14) * v; };
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke(); ctx.setLineDash([]);
    DET.forEach(function (d) {
      var pos = TX.map(function (p) { return p.det[d] ? p.det[d].r2 : null; }).filter(function (v) { return v != null; });
      var neg = FLAT.map(function (p) { return p.det[d] ? p.det[d].r2 : null; }).filter(function (v) { return v != null; });
      if (!pos.length || !neg.length) return;
      var thr = pos.concat(neg).slice().sort(function (a, b) { return b - a; });
      var pts = [[0, 0]];
      var grid = [];
      for (var g = 0; g <= 100; g++) grid.push(1 - g / 100); // threshold high→low
      grid.forEach(function (th) {
        var tp = pos.filter(function (v) { return v >= th; }).length / pos.length;
        var fp = neg.filter(function (v) { return v >= th; }).length / neg.length;
        pts.push([fp, tp]);
      });
      ctx.strokeStyle = DETA(d); ctx.lineWidth = 2; ctx.beginPath();
      pts.forEach(function (pt, i) { (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(pt[0]), Y(pt[1])); }); ctx.stroke();
    });
    ctx.fillStyle = '#9fb0c4'; ctx.font = '11px ui-monospace'; ctx.fillText('false-positive rate (flat controls) →', w / 2 - 90, h - 6);
    ctx.save(); ctx.translate(13, h / 2 + 60); ctx.rotate(-Math.PI / 2); ctx.fillText('sensitivity (intervention)', 0, 0); ctx.restore();
    $('rocLeg').innerHTML = DET.map(function (d) { return '<span class="chip" style="background:' + DETA(d) + '"></span>' + DMETA[d].label + (det[d].auc != null ? ' (AUC ' + det[d].auc.toFixed(2) + ')' : ''); }).join(' &nbsp; ');
  }

  // ── exports ──
  function dl(name, text, mime) { var b = new Blob([text], { type: mime || 'text/plain' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  $('dlCsv').onclick = function () {
    var rows = [['seed', 'group', 'nNights', 'plantedCP', 'baseAHI', 'det_odi', 'det_rmssd', 'det_fused', 'r2_odi', 'r2_rmssd', 'r2_fused']];
    TX.concat(FLAT).forEach(function (p) {
      rows.push([p.seed, p.arc, p.nNights, p.cp, p.baseAHI,
        p.det.odi ? p.det.odi.k : '', p.det.rmssd ? p.det.rmssd.k : '', p.det.fused ? p.det.fused.k : '',
        p.det.odi ? p.det.odi.r2.toFixed(3) : '', p.det.rmssd ? p.det.rmssd.r2.toFixed(3) : '', p.det.fused ? p.det.fused.r2.toFixed(3) : '']);
    });
    dl('treatment-response-results.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
  };
  $('dlStats').onclick = function () { dl('treatment-response-stats.json', JSON.stringify(RESULT, null, 2), 'application/json'); };
  $('dlFig').onclick = function () {
    var a = $('example'), b = $('acc'), c = $('roc'), gap = 16;
    var W = Math.max(a.width, b.width + c.width + gap) + gap * 2, H = a.height + Math.max(b.height, c.height) + gap * 3;
    var out = document.createElement('canvas'); out.width = W; out.height = H; var ctx = out.getContext('2d');
    ctx.fillStyle = '#0c0f14'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(a, gap, gap); ctx.drawImage(b, gap, gap * 2 + a.height); ctx.drawImage(c, gap * 2 + b.width, gap * 2 + a.height);
    out.toBlob(function (bl) { var u = URL.createObjectURL(bl); var an = document.createElement('a'); an.href = u; an.download = 'treatment-response-figures.png'; an.click(); }, 'image/png');
  };
  var CANCEL = false;
  $('run').onclick = function () { run(); };
  if ($('cancel')) $('cancel').onclick = function () { CANCEL = true; $('cancel').disabled = true; setStatus('cancelling…', 'run'); };
  function updEta() {
    var e = $('eta'); if (!e) return;
    var n = Math.max(15, Math.min(100000, +$('nSubj').value || 45)) * 2;
    var rate = parseFloat(localStorage.getItem('txresp_ptPerSec'));
    if (rate && isFinite(rate) && rate > 0) {
      e.textContent = '≈ ' + fmtETA(n / rate) + ' on this machine (' + rate.toFixed(0) + ' pt/s · ' + (navigator.hardwareConcurrency || '?') + ' cores)';
    } else {
      e.textContent = '↑ first run calibrates a per-machine time estimate (real detectors, ' + (navigator.hardwareConcurrency || '?') + ' cores)';
    }
  }
  function updTot() { var e = $('totEcho'); if (!e) return; var n = Math.max(15, Math.min(100000, +$('nSubj').value || 45)); e.textContent = '= ' + (n * 2) + ' total (' + n + ' tx + ' + n + ' flat)'; }
  if ($('nSubj')) $('nSubj').addEventListener('input', function () { updTot(); updEta(); });
  updTot(); updEta();
  // auto-resume a recent (<20 min) compatible checkpoint after an accidental reload (lock-coordinated)
  (function () {
    async function tryResume() {
      try {
        var ck = await ckptLoad();
        if (!(ck && ck.ver === genVer() && ck.cursor < (ck.targetSubj * 2) && (Date.now() - (ck.savedAt || 0)) < 20 * 60000)) return;
        if (lockHeldByOther()) { setStatus('another instance running ' + ck.cursor + '/~' + (ck.targetSubj * 2) + '… (watching)', 'run'); setTimeout(tryResume, 5000 + Math.random() * 2000); return; }
        if ($('nSubj')) $('nSubj').value = ck.targetSubj;
        if ($('minN')) $('minN').value = ck.minNights;
        updTot();
        setStatus('resuming previous run ' + ck.cursor + '…', 'run');
        run(ck);
      } catch (e) {}
    }
    tryResume();
  })();
})();
