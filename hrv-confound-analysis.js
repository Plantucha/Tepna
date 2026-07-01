/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   hrv-confound-analysis.js — runs the age×apnea HRV-confound simulation.
   Generates N synthetic patients, measures rMSSD per night via the REAL PulseDex
   harness (cohort-harness.html?node=pulsedex), then quantifies the age confound
   in a single-metric HRV screen and the recovery from an age-adjustment.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var PTS = [];                 // {age, ahi, rmssd, sev, cpap}
  var harness = null, pend = new Map(), seq = 1;

  function $(id) { return document.getElementById(id); }
  function setStatus(t, c) { var e = $('status'); e.textContent = t; e.className = 'pill ' + (c || 'idle'); }
  function setProg(f) { $('progBar').style.width = (f * 100).toFixed(1) + '%'; }

  // ── PulseDex WORKER POOL: K real Web Workers (cohort-worker.js, kind 'rrgluco').
  //   Each worker GENERATES and SCORES its patient off the main thread (cohort-gen + real
  //   pulsedex-dsp), so this is TRUE multicore — wall-clock ≈ serial / cores. (A same-origin
  //   iframe pool does NOT help: same-origin iframes share the one main thread.) Results are
  //   order-invariant (regression / ROC over the full set) → identical to serial; only PTS
  //   push order differs. Worker 'done' messages route by reqId through the shared pend map.
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
        w.postMessage({ type: 'init', kind: 'pulse' });
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

  // ── stats helpers ──
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function sd(a) { if (a.length < 2) return null; var m = mean(a), s = 0; a.forEach(function (v) { s += (v - m) * (v - m); }); return Math.sqrt(s / (a.length - 1)); }
  function ols(xs, ys) {
    var n = xs.length; if (n < 2) return null;
    var mx = mean(xs), my = mean(ys), sxx = 0, sxy = 0, syy = 0;
    for (var i = 0; i < n; i++) { var dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (!sxx) return null;
    var slope = sxy / sxx; return { slope: slope, intercept: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0, n: n };
  }
  // ── matrix OLS with full inference (β, SE, t, p, 95% CI) ──
  function invMat(A) {                 // Gauss-Jordan inverse of n×n
    var n = A.length, M = A.map(function (row, i) {
      var aug = row.slice(); for (var j = 0; j < n; j++) aug.push(i === j ? 1 : 0); return aug;
    });
    for (var col = 0; col < n; col++) {
      var piv = col; for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      var d = M[col][col]; for (var j = 0; j < 2 * n; j++) M[col][j] /= d;
      for (var r2 = 0; r2 < n; r2++) { if (r2 === col) continue; var f = M[r2][col]; for (var j2 = 0; j2 < 2 * n; j2++) M[r2][j2] -= f * M[col][j2]; }
    }
    return M.map(function (row) { return row.slice(n); });
  }
  function erf(x) {                     // Abramowitz-Stegun 7.1.26
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var a1 = .254829592, a2 = -.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, pp = .3275911;
    var t = 1 / (1 + pp * x), y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return s * y;
  }
  function normP(z) { return 2 * (0.5 * (1 - erf(Math.abs(z) / Math.SQRT2))); }   // two-sided
  function pearson(a, b) {
    var n = a.length, ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) { var da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return (saa && sbb) ? sab / Math.sqrt(saa * sbb) : 0;
  }
  // multiple OLS: y ~ design rows (incl. intercept col). Returns coefficients + inference.
  function olsFit(y, Xrows) {
    var n = Xrows.length, p = Xrows[0].length; if (n <= p + 1) return null;
    var XtX = [], Xty = new Array(p).fill(0), a, b2, i;
    for (a = 0; a < p; a++) { XtX.push(new Array(p).fill(0)); }
    for (i = 0; i < n; i++) {
      var xi = Xrows[i], yi = y[i];
      for (a = 0; a < p; a++) { Xty[a] += xi[a] * yi; for (b2 = 0; b2 < p; b2++) XtX[a][b2] += xi[a] * xi[b2]; }
    }
    var inv = invMat(XtX); if (!inv) return null;
    var beta = new Array(p).fill(0);
    for (a = 0; a < p; a++) { var s = 0; for (b2 = 0; b2 < p; b2++) s += inv[a][b2] * Xty[b2]; beta[a] = s; }
    var my = mean(y), ssTot = 0, sse = 0;
    for (i = 0; i < n; i++) { var pred = 0, xj = Xrows[i]; for (a = 0; a < p; a++) pred += beta[a] * xj[a]; var e = y[i] - pred; sse += e * e; ssTot += (y[i] - my) * (y[i] - my); }
    var df = n - p, sigma2 = sse / df, se = [], t = [], pv = [], ci = [];
    for (a = 0; a < p; a++) { var s2 = Math.sqrt(sigma2 * inv[a][a]); se.push(s2); t.push(beta[a] / s2); pv.push(normP(beta[a] / s2)); ci.push([beta[a] - 1.96 * s2, beta[a] + 1.96 * s2]); }
    var r2 = ssTot ? 1 - sse / ssTot : 0;
    return { beta: beta, se: se, t: t, p: pv, ci: ci, r2: r2, adjR2: 1 - (1 - r2) * (n - 1) / df, n: n, df: df, sigma: Math.sqrt(sigma2) };
  }
  // ROC from scores where HIGHER score = more suspicious; label = positive class bool
  function roc(scores, labels) {
    var pairs = scores.map(function (s, i) { return { s: s, y: labels[i] }; }).sort(function (a, b) { return b.s - a.s; });
    var P = labels.filter(Boolean).length, N = labels.length - P;
    if (!P || !N) return { auc: null, pts: [] };
    var tp = 0, fp = 0, pts = [{ x: 0, y: 0 }], auc = 0, prevFpr = 0, prevTpr = 0;
    pairs.forEach(function (p) {
      if (p.y) tp++; else fp++;
      var tpr = tp / P, fpr = fp / N;
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
      pts.push({ x: fpr, y: tpr }); prevFpr = fpr; prevTpr = tpr;
    });
    return { auc: auc, pts: pts };
  }

  // ── durable checkpoint (IndexedDB) ──────────────────────────────────────────
  //   A long run lives in page memory; ANY preview refresh (incl. a file write that
  //   reloads the tab) wipes it. We persist {ver,N,nextSeed,pts} every ~256 patients,
  //   and AUTO-RESUME on load if a recent compatible checkpoint exists — so an accidental
  //   reload continues instead of restarting from zero. (Mirrors cohort-runner's IDB resume.)
  function idbOpen() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('hrvconf_ckpt', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('s'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  async function ckptSave(o) { try { var db = await idbOpen(); await new Promise(function (res, rej) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(o, 'run'); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); db.close(); } catch (e) {} }
  async function ckptLoad() { try { var db = await idbOpen(); var o = await new Promise(function (res, rej) { var tx = db.transaction('s', 'readonly'); var rq = tx.objectStore('s').get('run'); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); db.close(); return o; } catch (e) { return null; } }
  async function ckptClear() { try { var db = await idbOpen(); await new Promise(function (res) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').delete('run'); tx.oncomplete = res; }); db.close(); } catch (e) {} }
  function genVer() { return (window.CohortGen && CohortGen.VERSION) || '?'; }

  // ── single-instance lock (localStorage heartbeat) ───────────────────────────
  //   Several page instances can exist at once (agent preview + user tab + a reload).
  //   Without a lock, each would auto-resume the SAME checkpoint → duplicate competing
  //   runs. A heartbeat lock lets exactly ONE instance run; others defer and retry once
  //   the holder's heartbeat goes stale (e.g. its tab was closed/refreshed).
  var RUN_ID = Math.random().toString(36).slice(2);
  function lockFresh() { try { var l = JSON.parse(localStorage.getItem('hrvconf_lock') || 'null'); return (l && (Date.now() - l.ts) < 6000) ? l : null; } catch (e) { return null; } }
  function lockHeldByOther() { var l = lockFresh(); return !!(l && l.id !== RUN_ID); }
  function lockBeat() { try { localStorage.setItem('hrvconf_lock', JSON.stringify({ id: RUN_ID, ts: Date.now() })); } catch (e) {} }
  function lockRelease() { try { var l = lockFresh(); if (l && l.id === RUN_ID) localStorage.removeItem('hrvconf_lock'); } catch (e) {} }

  // ── run ──
  async function run(resumeCk) {
    if (lockHeldByOther()) { setStatus('another tab/instance is running this cohort — not duplicating', 'idle'); $('run').disabled = false; return; }
    lockBeat(); var _hb = setInterval(lockBeat, 2000);
    $('run').disabled = true; CANCEL = false;
    if ($('cancel')) { $('cancel').style.display = ''; $('cancel').disabled = false; }
    var K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    setStatus('booting ' + K + '× worker realms…', 'run'); setProg(0);
    if (!pool.length) await bootPool(K);
    var rdy = pool.filter(function (r) { return r.ready; });
    if (!rdy.length) { setStatus('worker boot failed', 'idle'); $('run').disabled = false; return; }
    var ver = genVer();
    var N = Math.max(50, Math.min(100000, +$('nIn').value || 250));
    // resume from a compatible checkpoint, else start fresh
    var startSeed = 0;
    if (resumeCk && resumeCk.ver === ver && resumeCk.N === N && resumeCk.nextSeed < N && Array.isArray(resumeCk.pts)) {
      PTS = resumeCk.pts; startSeed = resumeCk.nextSeed;
      setStatus('resuming ' + startSeed + '/' + N + ' (' + PTS.length + ' nights so far)…', 'run');
    } else {
      PTS = []; await ckptClear();
    }
    // PARALLEL: each worker generates + scores a whole patient off the main thread; K lanes
    // pull seeds. Per-night {age, ahi, rmssd, cpap} is joined from result.meta + result.pulse.
    var nextSeed = startSeed, pdone = 0, t0 = performance.now(), lastRate = 0;
    function fmtETA(sec) { if (!isFinite(sec) || sec < 0) return '—'; var m = Math.floor(sec / 60), s = Math.round(sec % 60); return m ? (m + 'm' + (s < 10 ? '0' : '') + s + 's') : (s + 's'); }
    async function lane(rec) {
      while (!CANCEL) {
        var seed = nextSeed++; if (seed >= N) return;
        var m = await runSeed(rec, seed);
        pdone++;
        if (m && m.result) {
          var res = m.result, prof = res.meta && res.meta.profile, age = prof ? prof.age : null;
          var gtN = {}; ((res.meta && res.meta.groundTruth && res.meta.groundTruth.nights) || []).forEach(function (gn) { gtN[gn.n] = gn; });
          (res.pulse || []).forEach(function (pp) {
            var ps = pp.score || pp;
            if (!ps || ps.rmssd == null || !isFinite(ps.rmssd)) return;
            var gn = gtN[ps.n]; if (!gn) return;
            PTS.push({ age: age, ahi: gn.ahiTruth, rmssd: ps.rmssd, sev: sevOf(gn.ahiTruth), cpap: !!gn.cpap });
          });
        }
        var totalDone = startSeed + pdone;
        if (pdone % 8 === 0 || totalDone === N) {
          var el = (performance.now() - t0) / 1000; lastRate = pdone / el;
          setProg(totalDone / N);
          setStatus('patient ' + totalDone + '/' + N + ' · ' + rdy.length + '× · ' + lastRate.toFixed(0) + ' pt/s · ETA ' + fmtETA((N - totalDone) / (lastRate || 1)), 'run');
          await new Promise(function (r) { setTimeout(r, 0); });
        }
        // periodic durable checkpoint (fire-and-forget; throttled)
        if (pdone % 256 === 0) ckptSave({ ver: ver, N: N, nextSeed: nextSeed, pts: PTS, savedAt: Date.now() });
      }
    }
    await Promise.all(rdy.map(lane));
    clearInterval(_hb); lockRelease();
    var elapsed = (performance.now() - t0) / 1000;
    if (!CANCEL) await ckptClear();
    else ckptSave({ ver: ver, N: N, nextSeed: nextSeed, pts: PTS, savedAt: Date.now() });
    try { localStorage.setItem('hrvconf_ptPerSec', String(pdone / Math.max(0.001, elapsed))); } catch (e) {}
    setProg(1);
    if ($('cancel')) $('cancel').style.display = 'none';
    setStatus((CANCEL ? 'cancelled — partial · ' : 'done · ') + PTS.length + ' nights · ' + (startSeed + pdone) + ' pt in ' + fmtETA(elapsed) + ' (' + (pdone / Math.max(0.001, elapsed)).toFixed(0) + ' pt/s)', CANCEL ? 'idle' : 'done');
    try { updEta(); } catch (e) {}
    if (PTS.length >= 8) analyze();
    $('run').disabled = false;
    ['dlCsv', 'dlStats', 'dlFig'].forEach(function (id) { $(id).disabled = PTS.length < 8; });
  }
  // auto-resume a recent (<20 min) compatible checkpoint after an accidental reload.
  // Honors the single-instance lock: if another instance is actively running, defer and
  // re-check, so a refresh that spawns two instances still ends up with exactly one runner.
  (function () {
    async function tryResume() {
      try {
        var ck = await ckptLoad();
        if (!(ck && ck.ver === genVer() && ck.nextSeed < ck.N && (Date.now() - (ck.savedAt || 0)) < 20 * 60000)) return;
        if (lockHeldByOther()) { setStatus('another instance running ' + ck.nextSeed + '/' + ck.N + '… (watching)', 'run'); setTimeout(tryResume, 5000 + Math.random() * 2000); return; }
        if ($('nIn')) $('nIn').value = ck.N;
        setStatus('resuming previous run ' + ck.nextSeed + '/' + ck.N + '…', 'run');
        run(ck);
      } catch (e) {}
    }
    tryResume();
  })();
  function sevOf(a) { return a < 5 ? 'none' : a < 15 ? 'mild' : a < 30 ? 'mod' : 'severe'; }

  function fmtP(p) { return p == null ? '—' : (p < 0.001 ? '<0.001' : p.toFixed(3)); }
  function star(p) { return p == null ? '' : (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : 'n.s.'); }
  var RESULT = null;
  function analyze() {
    var n = PTS.length; $('hN').textContent = n; if (!n) return;
    var ages = PTS.map(function (p) { return p.age; }),
        ahis = PTS.map(function (p) { return p.ahi; }),
        ys   = PTS.map(function (p) { return p.rmssd; });
    var mAge = mean(ages), mAhi = mean(ahis);

    // FULL-COHORT interaction model: rMSSD ~ b0 + b1·age + b2·AHI + b3·(age×AHI).
    // Predictors mean-centred so the interaction is low-collinearity and the main
    // effects read at the cohort mean. This keeps all N — the effect-modification
    // question is answered by ONE coefficient (b3), not fragile age-stratified subgroups.
    var X = PTS.map(function (p) { var a = p.age - mAge, b = p.ahi - mAhi; return [1, a, b, a * b]; });
    var fit = olsFit(ys, X);
    var rAA = pearson(ages, ahis);

    var perDecade  = fit ? fit.beta[1] * 10  : null;   // ms / decade of age
    var per10      = fit ? fit.beta[2] * 10  : null;   // ms / 10 AHI
    var interScale = fit ? fit.beta[3] * 100 : null;   // Δ(per-10-AHI apnea slope) per decade
    var interP     = fit ? fit.p[3]          : null;

    $('hAge').textContent = perDecade != null ? perDecade.toFixed(1) + ' ms' : '—';
    $('hAhi').textContent = per10 != null     ? per10.toFixed(1) + ' ms'     : '—';
    var hI = $('hInter');
    hI.textContent = interP != null ? star(interP) : '—';
    hI.style.color = (interP != null && interP < 0.05) ? 'var(--amber)' : 'var(--green)';

    if (fit) {
      var labels4 = ['Intercept — rMSSD at mean age & AHI',
                     'age — per year (at mean AHI)',
                     'AHI — per event/h (at mean age)',
                     'age × AHI — effect modification'];
      var html = '<table><thead><tr><th>Term</th><th class="num">β</th><th class="num">95% CI</th><th class="num">t</th><th class="num">p</th></tr></thead><tbody>';
      for (var j = 0; j < 4; j++) {
        html += '<tr' + (j === 3 ? ' style="color:var(--amber)"' : '') + '><td>' + labels4[j] + '</td>'
              + '<td class="num">' + fit.beta[j].toFixed(3) + '</td>'
              + '<td class="num">[' + fit.ci[j][0].toFixed(3) + ', ' + fit.ci[j][1].toFixed(3) + ']</td>'
              + '<td class="num">' + fit.t[j].toFixed(2) + '</td>'
              + '<td class="num">' + fmtP(fit.p[j]) + ' ' + star(fit.p[j]) + '</td></tr>';
      }
      html += '</tbody></table>';
      var verdict = interP < 0.05
        ? 'Interaction <b>significant</b>: apnea’s HRV suppression <b>changes with age</b> — a single adjustment is insufficient and age-stratified thresholds are warranted.'
        : 'Interaction <b>not significant</b>: apnea suppresses rMSSD by the same amount at every age (an <b>additive</b> confound). A single linear age-adjustment de-confounds the entire cohort — <b>no age-stratified subgroups required</b>, so full N is retained and small-cell fragility is avoided.';
      html += '<div class="muted" style="margin-top:10px;font-size:11.5px;line-height:1.65">'
            + 'Full cohort, n = ' + fit.n + ' nights · R² = ' + fit.r2.toFixed(3) + ' (adj ' + fit.adjR2.toFixed(3) + ') · residual df = ' + fit.df + ' · 95% CI normal approx.<br>'
            + 'Mean-centred predictors; r(age, AHI) = ' + rAA.toFixed(2) + ' (both retained — partial, not marginal, effects).<br>'
            + 'Scaled: <span style="color:var(--blue)">' + perDecade.toFixed(1) + ' ms / decade</span> · '
            + '<span style="color:var(--red)">' + per10.toFixed(1) + ' ms / 10 AHI</span> · '
            + 'interaction <span style="color:var(--amber)">' + (interScale >= 0 ? '+' : '') + interScale.toFixed(1) + ' ms / (decade × 10 AHI), p = ' + fmtP(interP) + '</span>.<br>'
            + verdict + '</div>';
      $('regOut').innerHTML = html;
    } else $('regOut').textContent = 'insufficient data';

    // healthy (AHI<5) age reference for the age-adjusted screen
    var healthy = PTS.filter(function (p) { return p.ahi < 5; });
    var ref = ols(healthy.map(function (p) { return p.age; }), healthy.map(function (p) { return p.rmssd; }));
    var expectedFor = function (age) { return ref ? ref.slope * age + ref.intercept : mean(ys); };

    // ROC — full-N threshold sweep (NOT subgroups): raw rMSSD vs age-adjusted residual
    var pos = PTS.map(function (p) { return p.ahi >= 15; });
    var rawScore = PTS.map(function (p) { return -p.rmssd; });
    var adjScore = PTS.map(function (p) { return -(p.rmssd - expectedFor(p.age)); });
    var rRaw = roc(rawScore, pos), rAdj = roc(adjScore, pos);
    $('hAuc').textContent = (rRaw.auc != null ? rRaw.auc.toFixed(2) : '—') + ' → ' + (rAdj.auc != null ? rAdj.auc.toFixed(2) : '—');
    $('rocTag').textContent = 'AUC ' + (rRaw.auc != null ? rRaw.auc.toFixed(2) : '—') + '→' + (rAdj.auc != null ? rAdj.auc.toFixed(2) : '—');

    // secondary (export only): raw-screen quartile misattribution — a full-sample quantity
    var sorted = PTS.slice().sort(function (a, b) { return a.rmssd - b.rmssd; });
    var flagged = sorted.slice(0, Math.round(n * 0.25));
    var falseOld = flagged.filter(function (p) { return p.ahi < 5; });
    var misattr = flagged.length ? falseOld.length / flagged.length : null;

    RESULT = { n: n,
      model: fit ? { terms: ['intercept', 'age', 'ahi', 'age_x_ahi'], beta: fit.beta, se: fit.se, t: fit.t, p: fit.p, ci: fit.ci, r2: fit.r2, adjR2: fit.adjR2, df: fit.df, centered: { age: mAge, ahi: mAhi } } : null,
      corr_age_ahi: rAA, perDecadeAge: perDecade, per10AHI: per10,
      interaction_ms_per_decade_per10AHI: interScale, interaction_p: interP,
      ref: ref, aucRaw: rRaw.auc, aucAdj: rAdj.auc,
      misattrFrac: misattr, flaggedN: flagged.length, falseOldN: falseOld.length };

    drawVsAge(ref); drawVsAhi(); drawRoc(rRaw, rAdj);
  }

  // ── figures ──
  var SEV_COLOR = { none: '#39D98A', mild: '#3DE0D0', mod: '#FFB84D', severe: '#FF6B7A' };
  function ageColor(a) { var t = Math.max(0, Math.min(1, (a - 20) / 65)); return 'hsl(' + Math.round(200 - t * 200) + ',70%,60%)'; }
  function clearC(ctx, w, h) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0f141b'; ctx.fillRect(0, 0, w, h); }
  function frame(ctx, P, w, h, xmin, xmax, ymin, ymax, xlab, ylab) {
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.fillStyle = '#6f8096'; ctx.font = '11px ui-monospace,monospace';
    ctx.beginPath(); ctx.moveTo(P, 10); ctx.lineTo(P, h - P); ctx.lineTo(w - 12, h - P); ctx.stroke();
    // tick labels: 1 decimal when the axis span is small (e.g. a 0–1 ROC axis), else integer
    var fmtX = function (v) { return (xmax - xmin) <= 5 ? v.toFixed(1) : String(Math.round(v)); };
    var fmtY = function (v) { return (ymax - ymin) <= 5 ? v.toFixed(1) : String(Math.round(v)); };
    for (var i = 0; i <= 5; i++) {
      var xv = xmin + (xmax - xmin) * i / 5, yv = ymin + (ymax - ymin) * i / 5;
      var px = P + (w - P - 12) * i / 5, py = (h - P) - (h - P - 10) * i / 5;
      ctx.fillText(fmtX(xv), px - 8, h - P + 16); ctx.fillText(fmtY(yv), 6, py + 4);
      ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(P, py); ctx.lineTo(w - 12, py); ctx.stroke();
    }
    ctx.fillStyle = '#aab8cc'; ctx.fillText(xlab, w / 2 - 30, h - 6);
    ctx.save(); ctx.translate(12, h / 2 + 30); ctx.rotate(-Math.PI / 2); ctx.fillText(ylab, 0, 0); ctx.restore();
  }
  function drawVsAge(ref) {
    var cv = $('vsAge'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 44; clearC(ctx, w, h);
    var ymax = 80; frame(ctx, P, w, h, 20, 85, 0, ymax, 'age (years)', 'measured rMSSD (ms)');
    var X = function (a) { return P + (w - P - 12) * (a - 20) / 65; }, Y = function (v) { return (h - P) - (h - P - 10) * v / ymax; };
    PTS.forEach(function (p) { ctx.fillStyle = SEV_COLOR[p.sev]; ctx.globalAlpha = .5; ctx.beginPath(); ctx.arc(X(p.age), Y(p.rmssd), 2.4, 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1;
    if (ref) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(20), Y(ref.slope * 20 + ref.intercept)); ctx.lineTo(X(85), Y(ref.slope * 85 + ref.intercept)); ctx.stroke(); ctx.setLineDash([]); }
    $('ageLegend').innerHTML = 'Dashed = healthy (AHI&lt;5) age reference. <span class="chip" style="background:#39D98A"></span>none <span class="chip" style="background:#3DE0D0"></span>mild <span class="chip" style="background:#FFB84D"></span>mod <span class="chip" style="background:#FF6B7A"></span>severe. Apneic dots sit below the healthy age line at every age.';
  }
  function drawVsAhi() {
    var cv = $('vsAhi'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 44; clearC(ctx, w, h);
    var xmax = Math.max(30, Math.ceil(Math.max.apply(null, PTS.map(function (p) { return p.ahi; })) / 10) * 10), ymax = 80;
    frame(ctx, P, w, h, 0, xmax, 0, ymax, 'true AHI (events/h)', 'measured rMSSD (ms)');
    var X = function (a) { return P + (w - P - 12) * a / xmax; }, Y = function (v) { return (h - P) - (h - P - 10) * v / ymax; };
    PTS.forEach(function (p) { ctx.fillStyle = ageColor(p.age); ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(X(p.ahi), Y(p.rmssd), 2.4, 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1;
    $('ahiLegend').innerHTML = 'Colour = age (blue young → red old). At any AHI the age spread is wide — a young severe-OSA patient can out-score an old healthy one.';
  }
  function drawRoc(rRaw, rAdj) {
    var cv = $('roc'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 44; clearC(ctx, w, h);
    frame(ctx, P, w, h, 0, 1, 0, 1, 'false-positive rate', 'true-positive rate');
    var X = function (v) { return P + (w - P - 12) * v; }, Y = function (v) { return (h - P) - (h - P - 10) * v; };
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke(); ctx.setLineDash([]);
    function curve(r, color) { if (!r.pts.length) return; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); r.pts.forEach(function (pt, i) { if (i === 0) ctx.moveTo(X(pt.x), Y(pt.y)); else ctx.lineTo(X(pt.x), Y(pt.y)); }); ctx.stroke(); }
    curve(rRaw, '#FFB84D'); curve(rAdj, '#3DE0D0');
    ctx.font = '12px ui-monospace'; ctx.fillStyle = '#FFB84D'; ctx.fillText('raw rMSSD  AUC ' + (rRaw.auc != null ? rRaw.auc.toFixed(3) : '—'), X(0.42), Y(0.18));
    ctx.fillStyle = '#3DE0D0'; ctx.fillText('age-adjusted  AUC ' + (rAdj.auc != null ? rAdj.auc.toFixed(3) : '—'), X(0.42), Y(0.10));
    $('rocLegend').innerHTML = 'Detecting moderate+ OSA (AHI≥15). Age-adjustment (residual vs expected-for-age) lifts the curve — the same sensor, de-confounded.';
  }

  // ── exports ──
  function dl(name, text, mime) { var b = new Blob([text], { type: mime || 'text/plain' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  $('dlCsv').onclick = function () {
    var rows = [['age', 'ahi', 'rmssd_measured', 'severity', 'cpap']];
    PTS.forEach(function (p) { rows.push([p.age, p.ahi, p.rmssd, p.sev, p.cpap ? 1 : 0]); });
    dl('hrv-confound-results.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
  };
  $('dlStats').onclick = function () {
    dl('hrv-confound-stats.json', JSON.stringify(Object.assign({ generated: new Date().toISOString(),
      framing: 'SIMULATION. age→HRV and apnea→HRV couplings are generator inputs (literature-anchored, planted ADDITIVELY → interaction≈0), editable. Full-cohort model rMSSD~age×AHI fitted with SE/t/p/95%CI; the interaction term tests effect modification on the FULL N (no age-stratified subgroups). rMSSD measured by real PulseDex. Quantifies screening error + single age-adjustment recovery; NOT clinical validation.' }, RESULT), null, 2), 'application/json');
  };
  $('dlFig').onclick = function () {
    var ids = ['vsAge', 'vsAhi', 'roc'], gap = 16; var c0 = $('vsAge');
    var W = c0.width * 2 + gap * 3, H = c0.height * 2 + gap * 3;
    var out = document.createElement('canvas'); out.width = W; out.height = H; var ctx = out.getContext('2d');
    ctx.fillStyle = '#0c0f14'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage($('vsAge'), gap, gap); ctx.drawImage($('vsAhi'), gap * 2 + c0.width, gap); ctx.drawImage($('roc'), gap, gap * 2 + c0.height);
    out.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'hrv-confound-figures.png'; a.click(); }, 'image/png');
  };

  var CANCEL = false;
  function updEta() {
    var e = $('eta'); if (!e) return;
    var N = Math.max(50, Math.min(100000, +$('nIn').value || 250));
    var rate = parseFloat(localStorage.getItem('hrvconf_ptPerSec'));
    if (rate && isFinite(rate) && rate > 0) {
      var sec = N / rate, mm = Math.floor(sec / 60), ss = Math.round(sec % 60);
      e.textContent = '\u2248 ' + (mm ? mm + 'm' + (ss < 10 ? '0' : '') + ss + 's' : ss + 's') + ' on this machine (' + rate.toFixed(0) + ' pt/s \u00b7 ' + (navigator.hardwareConcurrency || '?') + ' cores)';
    } else {
      e.textContent = '\u2191 first run calibrates a per-machine time estimate (real detectors, ' + (navigator.hardwareConcurrency || '?') + ' cores)';
    }
  }
  $('run').onclick = function () { run(); };
  if ($('nIn')) $('nIn').addEventListener('input', updEta);
  updEta();
  if ($('cancel')) $('cancel').onclick = function () { CANCEL = true; $('cancel').disabled = true; setStatus('cancelling…', 'run'); };
})();
