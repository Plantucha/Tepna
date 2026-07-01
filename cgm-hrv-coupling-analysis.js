/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   cgm-hrv-coupling-analysis.js — "CGM variability ↔ nocturnal autonomic coupling".

   The cohort generator CO-GENERATES glycemia and heart-rate variability from a
   shared nocturnal physiology, so two INDEPENDENT nodes — GlucoDex (CGM) and
   PulseDex (RR→HRV) — run as real detectors on their own file formats should
   recover a COHERENT cross-node relationship. We test that.

   Mechanism planted in the generator (synth-gen.js + cohort-gen.js):
     · apnea burden raises nocturnal glucose   — renderGlucoAll: mmol += (ahi/40)·0.5·sin
     · apnea burden suppresses rMSSD            — cohort-gen: rmssd = base − 0.22·ahi (+CPAP)
     → AHI is a SHARED DRIVER: heavier nights show higher nocturnal glucose AND lower rMSSD.
     · discrete nocturnal HYPO events couple a glucose excursion (GlucoDex flags it)
       with a within-night rMSSD-suppression + tachycardia signature (buildRR hypo window).

   For each patient (FAST cohort, GlucoDex + RR present, ≥minNights):
     · rMSSD per night            — REAL pulsedex-dsp on the night's RR
     · nocturnal glucose per night — slice the continuous CGM stream to the sleep
       window [t0Ms , t0Ms+durSec] (floating wall-clock, Clock Contract) → REAL
       glucodex-dsp.analyze → nocturnal mean, CV, nHypo, dawn surge.

   Coupling is decomposed into POOLED / WITHIN-patient / BETWEEN-patient correlation,
   then the shared-driver hypothesis is tested by PARTIAL correlation controlling for
   the planted apnea burden (AHI). Discrete hypo-night coupling is scored as a paired
   within-patient contrast (hypo vs flat nights) + GlucoDex hypo-flag recall.

   HONEST FRAMING (in-page + export): synthetic ground truth. This certifies that the
   harness produces CROSS-NODE TEMPORAL COHERENCE and that two real detectors recover
   it — NOT a real-world CGM↔HRV effect size. The planted AHI is the shared latent
   (OxyDex's recovery of it is characterized in the ODI-4↔AHI paper). 100% local;
   reuses cohort-gen.js + two real-DSP harness realms (cohort-harness.html?node=…).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var harness = {}, pend = new Map(), seq = 1;
  var ROWS = [];                 // one per patient-night
  var SUBJ = [];                 // grouped per patient
  var RESULT = null;
  var minNights, targetSubj;

  var GCOL = { normal: '#58A6FF', preDM: '#FFB84D', T2D: '#FF6B7A' };

  function $(id) { return document.getElementById(id); }
  function setStatus(t, c) { var e = $('status'); e.textContent = t; e.className = 'pill ' + (c || 'idle'); }
  function setProg(f) { $('progBar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }

  // ── Web Worker POOL (kind 'cgmcouple'): each worker GENERATES + SCORES a patient off the
  //   main thread — rMSSD/night (PulseDex) + nocturnal-slice glucose/night (GlucoDex) — giving
  //   true multicore. Results are order-invariant here (pooled / within / between correlations
  //   over the full set), so parallel collection equals the serial run.
  var pool = [];
  function bootPool(K) {
    pool = [];
    var readies = [];
    for (var i = 0; i < K; i++) {
      (function () {
        var w = new Worker('cohort-worker.js');
        var rec = { w: w, ready: false, err: null, _res: null };
        pool.push(rec);
        readies.push(new Promise(function (res) { rec._res = res; }));
        w.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.type === 'ready') { rec.ready = !m.err; rec.err = m.err || null; if (rec._res) { rec._res(); rec._res = null; } return; }
          if (m.type === 'done') { var p = pend.get(m.reqId); if (p) { pend.delete(m.reqId); p(m); } }
        };
        w.postMessage({ type: 'init', kind: 'cgmcouple' });
      })();
    }
    return Promise.race([ Promise.all(readies), new Promise(function (r) { setTimeout(r, 15000); }) ]);
  }
  function runSeed(rec, seed) {
    return new Promise(function (resolve) {
      var id = seq++; pend.set(id, resolve);
      rec.w.postMessage({ type: 'job', reqId: id, seed: seed });
      setTimeout(function () { if (pend.has(id)) { pend.delete(id); resolve({ error: 'timeout' }); } }, 120000);
    });
  }

  // ── durable checkpoint + single-instance lock (preview refresh resumes, not restarts) ──
  function idbOpen() { return new Promise(function (res, rej) { var r = indexedDB.open('cgmcpl_ckpt', 1); r.onupgradeneeded = function () { r.result.createObjectStore('s'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  async function ckptSave(o) { try { var db = await idbOpen(); await new Promise(function (res, rej) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(o, 'run'); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); db.close(); } catch (e) {} }
  async function ckptLoad() { try { var db = await idbOpen(); var o = await new Promise(function (res, rej) { var tx = db.transaction('s', 'readonly'); var rq = tx.objectStore('s').get('run'); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); db.close(); return o; } catch (e) { return null; } }
  async function ckptClear() { try { var db = await idbOpen(); await new Promise(function (res) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').delete('run'); tx.oncomplete = res; }); db.close(); } catch (e) {} }
  function genVer() { return (window.CohortGen && CohortGen.VERSION) || '?'; }
  var RUN_ID = Math.random().toString(36).slice(2);
  function lockFresh() { try { var l = JSON.parse(localStorage.getItem('cgmcpl_lock') || 'null'); return (l && (Date.now() - l.ts) < 6000) ? l : null; } catch (e) { return null; } }
  function lockHeldByOther() { var l = lockFresh(); return !!(l && l.id !== RUN_ID); }
  function lockBeat() { try { localStorage.setItem('cgmcpl_lock', JSON.stringify({ id: RUN_ID, ts: Date.now() })); } catch (e) {} }
  function lockRelease() { try { var l = lockFresh(); if (l && l.id === RUN_ID) localStorage.removeItem('cgmcpl_lock'); } catch (e) {} }
  function fmtETA(sec) { if (!isFinite(sec) || sec < 0) return '—'; var m = Math.floor(sec / 60), s = Math.round(sec % 60); return m ? (m + 'm' + (s < 10 ? '0' : '') + s + 's') : (s + 's'); }

  // ── slice the continuous CGM stream to one night's sleep window ──
  //  Clock Contract: regex the zoned-ISO stamp into FLOATING wall-clock ms (the same
  //  frame as the night's t0Ms); never new Date(str). Glucose is 5-min cadence,
  //  seconds always 0, so the minute-resolution regex is exact.
  function glucoTs(s) {
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }
  function sliceNocturnal(csv, t0Ms, durSec) {
    var lines = (csv || '').split(/\r?\n/);
    if (lines.length < 3) return null;
    var header = lines[0], end = t0Ms + durSec * 1000, out = [header];
    for (var i = 1; i < lines.length; i++) {
      var ln = lines[i]; if (!ln.trim()) continue;
      var comma = ln.indexOf(','); if (comma < 10) continue;
      var ms = glucoTs(ln.slice(0, comma).trim());
      if (ms == null) continue;
      if (ms >= t0Ms && ms <= end) out.push(ln);
    }
    return out.length >= 13 ? out.join('\n') + '\n' : null;     // need ≥~1 h of 5-min readings
  }

  // ── stats helpers ──
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function pearson(xs, ys) {
    var n = xs.length; if (n < 3) return null;
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { var dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (sxx <= 0 || syy <= 0) return null;
    var r = sxy / Math.sqrt(sxx * syy);
    r = Math.max(-0.9999, Math.min(0.9999, r));
    // Fisher-z 95% CI
    var z = Math.atanh(r), se = 1 / Math.sqrt(Math.max(1, n - 3));
    return { r: r, n: n, lo: Math.tanh(z - 1.96 * se), hi: Math.tanh(z + 1.96 * se),
             slope: sxy / sxx, mx: mx, my: my };
  }
  // partial r(x,y | z)
  function partial(rxy, rxz, ryz) {
    var d = Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
    return d > 0 ? (rxy - rxz * ryz) / d : null;
  }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // ── run ──
  async function run(resumeCk) {
    if (lockHeldByOther()) { setStatus('another tab/instance is running this cohort — not duplicating', 'idle'); $('run').disabled = false; return; }
    lockBeat(); var _hb = setInterval(lockBeat, 2000);
    $('run').disabled = true; CANCEL = false;
    if ($('cancel')) { $('cancel').style.display = ''; $('cancel').disabled = false; }
    minNights  = Math.max(3, Math.min(12, +$('minN').value || 5));
    targetSubj = Math.max(10, Math.min(100000, +$('nSubj').value || 40));
    var hypoEnrich = !!($('hypoEnrich') && $('hypoEnrich').checked);   // bias profile sampling toward hypo-carriers (generator untouched)
    var ver = genVer();
    var K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    setStatus('booting ' + K + '× PulseDex+GlucoDex worker realms…', 'run'); setProg(0);
    if (!pool.length) await bootPool(K);
    var rdy = pool.filter(function (r) { return r.ready; });
    if (!rdy.length) { setStatus('worker boot failed', 'idle'); $('run').disabled = false; clearInterval(_hb); lockRelease(); return; }

    // scan for patients carrying BOTH CGM and a cardiac source with ≥minNights (profiles only — cheap, deterministic)
    setStatus('scanning profiles…', 'run');
    var seeds = [], seed = 0, CAP = 2000000;
    while (seeds.length < targetSubj && seed < CAP) {
      var pf; try { pf = CohortGen.sampleProfile(seed); } catch (e) { seed++; continue; }
      if (pf && pf.nNights >= minNights && pf.nodes.GlucoDex && (pf.nodes.PulseDex || pf.nodes.ECGDex) && (!hypoEnrich || pf.nocturnalHypo)) seeds.push(seed);
      seed++;
    }
    var total = seeds.length;

    var startCursor = 0;
    if (resumeCk && resumeCk.ver === ver && resumeCk.targetSubj === targetSubj && resumeCk.minNights === minNights && resumeCk.cursor < total && Array.isArray(resumeCk.ROWS) && Array.isArray(resumeCk.SUBJ)) {
      ROWS = resumeCk.ROWS; SUBJ = resumeCk.SUBJ; startCursor = resumeCk.cursor;
      setStatus('resuming ' + startCursor + '/' + total + '…', 'run');
    } else { ROWS = []; SUBJ = []; await ckptClear(); }

    var cursor = startCursor, pdone = 0, t0 = performance.now();
    setStatus('measuring ' + total + ' patients via ' + rdy.length + '× real DSP…', 'run');

    // PARALLEL: K lanes pull seeds; each worker returns pulse[] (rMSSD/night) + nocturnal[]
    // (sleep-window glucose/night) + meta (profile + ground truth). Join per night n.
    async function lane(rec) {
      while (!CANCEL) {
        var idx = cursor++; if (idx >= total) return;
        var sd = seeds[idx];
        var m = await runSeed(rec, sd);
        pdone++;
        if (m && m.result && m.result.meta && m.result.meta.profile) {
          var res = m.result, prof = res.meta.profile;
          var gtN = {}; ((res.meta.groundTruth && res.meta.groundTruth.nights) || []).forEach(function (gn) { gtN[gn.n] = gn; });
          var nocB = {}; (res.nocturnal || []).forEach(function (x) { nocB[x.n] = x.score; });
          var subjNights = [];
          (res.pulse || []).forEach(function (pp) {
            var ps = pp.score || pp; if (!ps || ps.rmssd == null || !isFinite(ps.rmssd)) return;
            var g = nocB[ps.n]; if (!g || g.mean == null || !isFinite(g.mean)) return;
            var gn = gtN[ps.n] || {};
            var rec2 = { seed: sd, age: prof.age, glyc: prof.glycemic, arc: prof.arc,
              night: ps.n, ahi: gn.ahiTruth, gluc: gn.gluc, cpap: !!gn.cpap,
              rmssd: ps.rmssd, gMean: g.mean, gCV: g.cv, nHypo: g.nHypo || 0, nHypoWin: g.winHypo || 0, dawn: g.dawnSurge };
            ROWS.push(rec2); subjNights.push(rec2);
          });
          if (subjNights.length >= 2) SUBJ.push({ seed: sd, glyc: prof.glycemic, age: prof.age, nights: subjNights });
        }
        var done = startCursor + pdone;
        if (pdone % 8 === 0 || done === total) {
          var el = (performance.now() - t0) / 1000, rate = pdone / el;
          setProg(done / total);
          setStatus('patient ' + done + '/' + total + ' · ' + rdy.length + '× · ' + ROWS.length + ' nights · ETA ' + fmtETA((total - done) / (rate || 1)), 'run');
          await new Promise(function (r) { setTimeout(r, 0); });
        }
        if (pdone % 64 === 0) ckptSave({ ver: ver, targetSubj: targetSubj, minNights: minNights, cursor: cursor, ROWS: ROWS, SUBJ: SUBJ, savedAt: Date.now() });
      }
    }
    await Promise.all(rdy.map(lane));
    clearInterval(_hb); lockRelease();
    var elapsed = (performance.now() - t0) / 1000;
    if (!CANCEL) await ckptClear(); else ckptSave({ ver: ver, targetSubj: targetSubj, minNights: minNights, cursor: cursor, ROWS: ROWS, SUBJ: SUBJ, savedAt: Date.now() });
    try { localStorage.setItem('cgmcpl_ptPerSec', String(pdone / Math.max(0.001, elapsed))); } catch (e) {}

    setProg(1);
    if ($('cancel')) $('cancel').style.display = 'none';
    setStatus((CANCEL ? 'cancelled — partial · ' : 'done · ') + SUBJ.length + ' patients · ' + ROWS.length + ' nights in ' + fmtETA(elapsed), CANCEL ? 'idle' : 'done');
    try { updEta(); } catch (e) {}
    if (ROWS.length) analyze();
    $('run').disabled = false;
    ['dlCsv', 'dlStats', 'dlFig'].forEach(function (id) { $(id).disabled = !ROWS.length; });
  }

  // ── analysis ──
  function analyze() {
    var yvar = $('gvar').value;            // 'gMean' | 'gCV'
    var glabel = yvar === 'gCV' ? 'nocturnal CGM-CV (%)' : 'nocturnal mean glucose (mg/dL)';

    // pooled (night-level) correlations
    var rmAll = ROWS.map(function (r) { return r.rmssd; });
    var gAll  = ROWS.map(function (r) { return r[yvar]; });
    var aAll  = ROWS.map(function (r) { return r.ahi; });
    var pooled = pearson(gAll, rmAll);
    var rgA = pearson(aAll, gAll), rmA = pearson(aAll, rmAll);

    // within-patient residuals (center each var by patient mean) & between-patient (patient means)
    var winG = [], winM = [], winA = [], btwG = [], btwM = [];
    SUBJ.forEach(function (su) {
      var ns = su.nights; if (ns.length < 2) return;
      var mg = mean(ns.map(function (r) { return r[yvar]; }));
      var mm = mean(ns.map(function (r) { return r.rmssd; }));
      var ma = mean(ns.map(function (r) { return r.ahi; }));
      btwG.push(mg); btwM.push(mm);
      ns.forEach(function (r) { winG.push(r[yvar] - mg); winM.push(r.rmssd - mm); winA.push(r.ahi - ma); });
    });
    var within = pearson(winG, winM), between = pearson(btwG, btwM);
    // partial within-patient r(gluc, rmssd | AHI), all on within residuals
    var rwGA = pearson(winG, winA), rwMA = pearson(winG.length ? winM : [], winA);
    var partWin = (within && rwGA && rwMA) ? partial(within.r, rwGA.r, rwMA.r) : null;

    // discrete hypo coupling — paired within-patient (hypo vs flat nights)
    // recall: window-LOCAL hypo (nHypoWin, the fixed slice-safe detector); hypoFlagHit
    // keeps the legacy full-context analyze() flag (nHypo) for before/after comparison.
    var dRm = [], dCv = [], hypoRecallHit = 0, hypoFlagHit = 0, hypoRecallN = 0;
    SUBJ.forEach(function (su) {
      var hyp = su.nights.filter(function (r) { return r.gluc === 'hypo'; });
      var flat = su.nights.filter(function (r) { return r.gluc === 'flat'; });
      hyp.forEach(function (r) { hypoRecallN++; if (r.nHypoWin > 0) hypoRecallHit++; if (r.nHypo > 0) hypoFlagHit++; });
      if (hyp.length && flat.length) {
        dRm.push(mean(hyp.map(function (r) { return r.rmssd; })) - mean(flat.map(function (r) { return r.rmssd; })));
        dCv.push(mean(hyp.map(function (r) { return r.gCV; }))   - mean(flat.map(function (r) { return r.gCV; })));
      }
    });
    var hypoRecall = hypoRecallN ? hypoRecallHit / hypoRecallN : null;
    var hypoFlagRecall = hypoRecallN ? hypoFlagHit / hypoRecallN : null;

    // ── headline ──
    var cards = '';
    cards += hcard('#3DE0D0', pooled ? fmtR(within ? within.r : pooled.r) : '—',
      'within-patient rMSSD ↔ ' + (yvar === 'gCV' ? 'CGM-CV' : 'nocturnal glucose'),
      within ? 'night-level, ' + within.n + ' nights · pooled ' + fmtR(pooled.r) : '—');
    cards += hcard('#58A6FF', partWin != null ? fmtR(partWin) : '—',
      'same coupling, partialling out apnea burden',
      'shared-driver test — collapse ⇒ AHI-mediated');
    cards += hcard('#FFB84D', (rgA && rmA) ? fmtR(rgA.r) + ' / ' + fmtR(rmA.r) : '—',
      'apnea burden drives both: glucose ↑ / rMSSD ↓',
      'the shared latent (AHI), ' + (rgA ? rgA.n : '—') + ' nights');
    $('headline').innerHTML = cards;

    // ── table ──
    var tb = '';
    tb += crow('rMSSD ↔ ' + (yvar === 'gCV' ? 'CGM-CV' : 'nocturnal glucose'), 'pooled (all nights)', pooled);
    tb += crow('rMSSD ↔ ' + (yvar === 'gCV' ? 'CGM-CV' : 'nocturnal glucose'), 'within-patient', within, true);
    tb += crow('rMSSD ↔ ' + (yvar === 'gCV' ? 'CGM-CV' : 'nocturnal glucose'), 'between-patient', between);
    tb += crow('rMSSD ↔ ' + (yvar === 'gCV' ? 'CGM-CV' : 'nocturnal glucose'), 'within · partial | AHI', partWin != null ? { r: partWin, n: within ? within.n : 0 } : null);
    tb += crow((yvar === 'gCV' ? 'CGM-CV' : 'nocturnal glucose') + ' ↔ apnea burden (AHI)', 'pooled', rgA);
    tb += crow('rMSSD ↔ apnea burden (AHI)', 'pooled', rmA);
    $('tblBody').innerHTML = tb;

    RESULT = { generated: new Date().toISOString(), glucoseVar: yvar, minNights: minNights,
      nPatients: SUBJ.length, nNights: ROWS.length,
      framing: 'Cross-node coupling on co-generated synthetic patients (FAST cohort). rMSSD (REAL pulsedex-dsp) and nocturnal glucose (REAL glucodex-dsp on the [t0,t0+dur] sleep-window slice) measured per night by two INDEPENDENT detectors on their own file formats. Coupling decomposed POOLED / WITHIN-patient / BETWEEN-patient; partial correlation controls for the planted apnea burden (AHI, the shared latent driver). Discrete nocturnal-hypo coupling scored as a paired within-patient hypo-vs-flat contrast + GlucoDex hypo-flag recall. Synthetic ground truth — certifies harness cross-node coherence + two-detector recovery, not a real-world CGM↔HRV effect size.',
      coupling: {
        pooled: r2obj(pooled), within: r2obj(within), between: r2obj(between),
        within_partial_AHI: partWin != null ? +partWin.toFixed(3) : null,
        glucose_vs_AHI: r2obj(rgA), rmssd_vs_AHI: r2obj(rmA),
      },
      hypo: { recall: hypoRecall != null ? +hypoRecall.toFixed(3) : null, recallMethod: 'window-local ≥15-min run <70 mg/dL on the slice',
        flagRecall: hypoFlagRecall != null ? +hypoFlagRecall.toFixed(3) : null, flagRecallMethod: 'legacy glucodex analyze() nocturnalHypo flag (full-context, slice-truncated)',
        enriched: !!($('hypoEnrich') && $('hypoEnrich').checked), nHypoNights: hypoRecallN,
        pairedPatients: dRm.length, medianDeltaRmssd: median(dRm), medianDeltaCV: median(dCv) } };
    try { window.CGM_HRV_COUPLING = RESULT; } catch (e) {}

    drawScatter(yvar, glabel, within);
    drawDriver(within, partWin, rgA, rmA, yvar);
    drawDrivers(yvar);
  }

  function fmtR(r) { return r == null ? '—' : (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2); }
  function fmtMs(v) { return v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' ms'; }
  function r2obj(p) { return p ? { r: +p.r.toFixed(3), n: p.n, ci: [+p.lo.toFixed(3), +p.hi.toFixed(3)] } : null; }
  function hcard(col, big, k, sub) { return '<div class="hcard"><div class="hl" style="color:' + col + '">' + big + '</div><div class="hk">' + k + '</div><div class="hs">' + sub + '</div></div>'; }
  function crow(pair, level, p, hi) {
    var r = p ? p.r : null, n = p ? p.n : null, ci = (p && p.lo != null) ? (fmtR(p.lo) + ', ' + fmtR(p.hi)) : '—';
    return '<tr' + (hi ? ' style="background:rgba(61,224,208,.06)"' : '') + '>'
      + '<td>' + pair + '</td><td class="dim">' + level + '</td>'
      + '<td class="num" style="color:' + (r == null ? 'var(--text3)' : r < 0 ? 'var(--teal)' : 'var(--amber)') + '">' + fmtR(r) + '</td>'
      + '<td class="num">' + (n == null ? '—' : n) + '</td>'
      + '<td class="num dim">' + ci + '</td></tr>';
  }

  // ════════ figures ════════
  function clearC(ctx, w, h) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0f141b'; ctx.fillRect(0, 0, w, h); }
  function rrect(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // within-patient residual scatter: Δglucose vs ΔrMSSD (centered per patient)
  function drawScatter(yvar, glabel, within) {
    var cv = $('scatter'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 52; clearC(ctx, w, h);
    var pts = [];
    SUBJ.forEach(function (su) {
      var ns = su.nights; if (ns.length < 2) return;
      var mg = mean(ns.map(function (r) { return r[yvar]; })), mm = mean(ns.map(function (r) { return r.rmssd; }));
      ns.forEach(function (r) { pts.push({ x: r[yvar] - mg, y: r.rmssd - mm, c: GCOL[r.glyc] || '#9fb0c4' }); });
    });
    if (!pts.length) { ctx.fillStyle = '#6f8096'; ctx.font = '12px ui-monospace'; ctx.fillText('run to populate', 20, 40); return; }
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var xmax = Math.max(1, Math.max.apply(null, xs.map(Math.abs))) * 1.08;
    var ymax = Math.max(1, Math.max.apply(null, ys.map(Math.abs))) * 1.08;
    var X = function (v) { return P + (w - P - 16) * (v + xmax) / (2 * xmax); };
    var Y = function (v) { return (h - P) - (h - P - 14) * (v + ymax) / (2 * ymax); };
    // axes through origin
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(0), 14); ctx.lineTo(X(0), h - P); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(P, Y(0)); ctx.lineTo(w - 16, Y(0)); ctx.stroke();
    ctx.fillStyle = '#6f8096'; ctx.font = '10px ui-monospace';
    ctx.fillText('+', X(xmax) - 16, Y(0) - 6); ctx.fillText('Δ ' + (yvar === 'gCV' ? 'CV' : 'glucose') + ' (night − patient mean) →', P, h - P + 22);
    ctx.save(); ctx.translate(15, h / 2 + 64); ctx.rotate(-Math.PI / 2); ctx.fillText('Δ rMSSD (night − patient mean, ms) →', 0, 0); ctx.restore();
    // points
    pts.forEach(function (p) { ctx.fillStyle = p.c + 'b0'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.6, 0, 7); ctx.fill(); });
    // OLS line through residuals (origin)
    if (within) {
      var sl = within.slope;
      ctx.strokeStyle = '#3DE0D0'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(X(-xmax), Y(-xmax * sl)); ctx.lineTo(X(xmax), Y(xmax * sl)); ctx.stroke();
      ctx.fillStyle = '#e6edf6'; ctx.font = 'bold 12px ui-monospace';
      ctx.fillText('within r = ' + fmtR(within.r), w - 168, 26);
    }
    $('scatterLeg').innerHTML = 'Each point = one patient-night, centered on that patient\u2019s own mean (removes between-patient glycemic class). '
      + '<span class="chip" style="background:' + GCOL.normal + '"></span>normal &nbsp;<span class="chip" style="background:' + GCOL.preDM + '"></span>pre-DM &nbsp;<span class="chip" style="background:' + GCOL.T2D + '"></span>T2D. '
      + 'The negative slope is the within-patient coupling: heavier nights run higher glucose and lower rMSSD.';
  }

  // shared-driver bars: |r| for within coupling raw vs partial|AHI, and the two driver legs
  function drawDriver(within, partWin, rgA, rmA, yvar) {
    var cv = $('driver'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height; clearC(ctx, w, h);
    var glab = yvar === 'gCV' ? 'CV' : 'gluc';
    var bars = [
      { lab: 'rMSSD↔' + glab + ' (within)', r: within ? within.r : null, col: '#3DE0D0' },
      { lab: 'rMSSD↔' + glab + ' | AHI', r: partWin, col: '#58A6FF' },
      { lab: glab + ' ↔ AHI', r: rgA ? rgA.r : null, col: '#FFB84D' },
      { lab: 'rMSSD ↔ AHI', r: rmA ? rmA.r : null, col: '#B98AFF' },
    ];
    var P = 132, top = 22, rowH = 50, x0 = P, x1 = w - 54, span = x1 - x0;
    for (var t = 0; t <= 5; t++) { var gx = x0 + span * t / 5; ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(gx, top - 6); ctx.lineTo(gx, top + rowH * bars.length - 12); ctx.stroke(); ctx.fillStyle = '#6f8096'; ctx.font = '10px ui-monospace'; ctx.fillText((t / 5).toFixed(1), gx - 7, top + rowH * bars.length + 2); }
    bars.forEach(function (b, i) {
      var y = top + i * rowH, bh = 22;
      ctx.fillStyle = '#cdd9e8'; ctx.font = '11px ui-monospace'; ctx.textAlign = 'right'; ctx.fillText(b.lab, P - 8, y + 15); ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.07)'; rrect(ctx, x0, y, span, bh, 5); ctx.fill();
      if (b.r != null) {
        var mag = Math.min(1, Math.abs(b.r));
        ctx.fillStyle = b.col; rrect(ctx, x0, y, span * mag, bh, 5); ctx.fill();
        ctx.fillStyle = '#0b0e13'; ctx.font = 'bold 11px ui-monospace'; ctx.fillText(fmtR(b.r), x0 + 7, y + 15);
      } else { ctx.fillStyle = '#6f8096'; ctx.font = '11px ui-monospace'; ctx.fillText('—', x0 + 7, y + 15); }
    });
    ctx.fillStyle = '#9fb0c4'; ctx.font = '11px ui-monospace'; ctx.fillText('| r |  ·  the coupling (top) collapses once apnea burden is partialled out', 10, top + rowH * bars.length + 2);
  }

  // the two driver legs as scatter — AHI vs nocturnal glucose, and AHI vs rMSSD —
  // the mechanism the partial-correlation collapse quantifies. Well-powered (all nights).
  function drawDrivers(yvar) {
    var cv = $('hypo'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height; clearC(ctx, w, h);
    var gap = 40, pw = (w - gap) / 2;
    var glab = yvar === 'gCV' ? 'nocturnal CGM-CV (%)' : 'nocturnal mean glucose (mg/dL)';
    panel(ctx, 0, pw, h, ROWS.map(function (r) { return { x: r.ahi, y: r[yvar], c: GCOL[r.glyc] || '#9fb0c4' }; }),
      'apnea burden (AHI, events/h) →', glab, '#FFB84D');
    panel(ctx, pw + gap, pw, h, ROWS.map(function (r) { return { x: r.ahi, y: r.rmssd, c: GCOL[r.glyc] || '#9fb0c4' }; }),
      'apnea burden (AHI, events/h) →', 'rMSSD (ms)', '#B98AFF');
    $('hypoLeg').innerHTML = 'The two legs of the shared driver, each a real-detector readout over all ' + ROWS.length + ' nights. '
      + 'Apnea burden raises nocturnal glucose (left, GlucoDex) and suppresses rMSSD (right, PulseDex) — opposite signs, '
      + 'so the two metrics correlate negatively with no direct link. Color = glycemic class '
      + '(<span class="chip" style="background:' + GCOL.normal + '"></span>normal '
      + '<span class="chip" style="background:' + GCOL.preDM + '"></span>pre-DM '
      + '<span class="chip" style="background:' + GCOL.T2D + '"></span>T2D), which shifts glucose level but not the AHI slope.';
  }
  function panel(ctx, ox, pw, h, pts, xlab, ylab, lineCol) {
    var P = 56, top = 16;
    if (!pts.length) { ctx.fillStyle = '#6f8096'; ctx.font = '12px ui-monospace'; ctx.fillText('run to populate', ox + 20, 40); return; }
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var xmax = Math.max.apply(null, xs) * 1.05, ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    var ylo = ymin - (ymax - ymin) * 0.08, yhi = ymax + (ymax - ymin) * 0.08;
    var X = function (v) { return ox + P + (pw - P - 16) * v / (xmax || 1); };
    var Y = function (v) { return (h - P) - (h - P - top - 4) * (v - ylo) / ((yhi - ylo) || 1); };
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox + P, top); ctx.lineTo(ox + P, h - P); ctx.lineTo(ox + pw - 16, h - P); ctx.stroke();
    ctx.fillStyle = '#6f8096'; ctx.font = '10px ui-monospace';
    for (var g = 0; g <= 4; g++) { var yv = ylo + (yhi - ylo) * g / 4; ctx.fillText(Math.round(yv), ox + 18, Y(yv) + 4); ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(ox + P, Y(yv)); ctx.lineTo(ox + pw - 16, Y(yv)); ctx.stroke(); }
    ctx.fillStyle = '#9fb0c4'; ctx.font = '11px ui-monospace'; ctx.fillText(xlab, ox + P, h - P + 22);
    ctx.save(); ctx.translate(ox + 14, h / 2 + ylab.length * 3); ctx.rotate(-Math.PI / 2); ctx.fillText(ylab, 0, 0); ctx.restore();
    pts.forEach(function (p) { ctx.fillStyle = p.c + 'a0'; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.4, 0, 7); ctx.fill(); });
    // OLS line
    var pr = pearson(xs, ys);
    if (pr) {
      var b = pr.slope, a = pr.my - b * pr.mx;
      ctx.strokeStyle = lineCol; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(0), Y(a)); ctx.lineTo(X(xmax), Y(a + b * xmax)); ctx.stroke();
      ctx.fillStyle = '#e6edf6'; ctx.font = 'bold 12px ui-monospace'; ctx.fillText('r = ' + fmtR(pr.r), ox + pw - 96, top + 12);
    }
  }

  // ── exports ──
  function dl(name, text, mime) { var b = new Blob([text], { type: mime || 'text/plain' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  $('dlCsv').onclick = function () {
    var rows = [['seed', 'age', 'glycemic', 'arc', 'night', 'ahi', 'gluc_kind', 'cpap', 'rmssd', 'noct_gMean', 'noct_gCV', 'nHypo', 'nHypoWin', 'dawnSurge']];
    ROWS.forEach(function (r) { rows.push([r.seed, r.age, r.glyc, r.arc, r.night, r.ahi, r.gluc, r.cpap, r.rmssd, r.gMean, r.gCV, r.nHypo, r.nHypoWin, r.dawn == null ? '' : r.dawn]); });
    dl('cgm-hrv-coupling-results.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
  };
  $('dlStats').onclick = function () { dl('cgm-hrv-coupling-stats.json', JSON.stringify(RESULT, null, 2), 'application/json'); };
  $('dlFig').onclick = function () {
    var a = $('scatter'), b = $('driver'), c = $('hypo'), gap = 16;
    var W = Math.max(a.width + b.width + gap, c.width) + gap * 2, H = Math.max(a.height, b.height) + c.height + gap * 3;
    var out = document.createElement('canvas'); out.width = W; out.height = H; var ctx = out.getContext('2d');
    ctx.fillStyle = '#0c0f14'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(a, gap, gap); ctx.drawImage(b, gap * 2 + a.width, gap); ctx.drawImage(c, gap, gap * 2 + Math.max(a.height, b.height));
    out.toBlob(function (bl) { var u = URL.createObjectURL(bl); var an = document.createElement('a'); an.href = u; an.download = 'cgm-hrv-coupling-figures.png'; an.click(); }, 'image/png');
  };
  $('gvar').onchange = function () { if (RESULT) analyze(); };
  var CANCEL = false;
  $('run').onclick = function () { run(); };
  if ($('cancel')) $('cancel').onclick = function () { CANCEL = true; $('cancel').disabled = true; setStatus('cancelling…', 'run'); };
  function updEta() {
    var e = $('eta'); if (!e) return;
    var n = Math.max(10, Math.min(100000, +$('nSubj').value || 40));
    var rate = parseFloat(localStorage.getItem('cgmcpl_ptPerSec'));
    if (rate && isFinite(rate) && rate > 0) e.textContent = '≈ ' + fmtETA(n / rate) + ' on this machine (' + rate.toFixed(0) + ' pt/s · ' + (navigator.hardwareConcurrency || '?') + ' cores)';
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
