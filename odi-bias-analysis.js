/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   odi-bias-analysis.js — drives odi-bias-analysis.html. Collects {odi4, scoredAHI}
   points from three sources, fits calibration + correction, renders four figures,
   exports CSV/JSON/PNG. Pure browser; reuses real OxyDex + CpapEdf + NSRR adapter.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var DIR = 'uploads/synthetic/';
  var NIGHTS = [
    { n: 1, oxy: 'O2Ring S 2100_20260511231000.csv', gt: 'ground_truth_night1.json' },
    { n: 2, oxy: 'O2Ring S 2100_20260512235500.csv', gt: 'ground_truth_night2.json' },
    { n: 3, oxy: 'O2Ring S 2100_20260513225000.csv', gt: 'ground_truth_night3.json' },
    { n: 4, oxy: 'O2Ring S 2100_20260514230500.csv', gt: 'ground_truth_night4.json' },
    { n: 5, oxy: 'O2Ring S 2100_20260515232000.csv', gt: 'ground_truth_night5.json' },
  ];
  var SRC_COLOR = { subjectA: '#58A6FF', synthetic: '#B98AFF', nsrr: '#39D98A' };
  var SEV_COLOR = { none: '#39D98A', mild: '#3DE0D0', mod: '#FFB84D', severe: '#FF6B7A' };
  var POINTS = [];   // {src, id, odi4, ahi, sev, minSpo2, durMin, ahiSrc}
  var NSRR_FILES = {};                    // base name → {edf?, xml?}
  var AHI_CSV = {};                        // id → scoredAHI

  function $(id) { return document.getElementById(id); }
  function setStatus(t, cls) { var e = $('status'); e.textContent = t; e.className = 'pill ' + (cls || 'idle'); }

  // ── stats ──
  function ols(xs, ys) {
    var n = xs.length; if (n < 2) return null;
    var sx = 0, sy = 0; for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    var mx = sx / n, my = sy / n, sxx = 0, sxy = 0, syy = 0;
    for (var j = 0; j < n; j++) { var dx = xs[j] - mx, dy = ys[j] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (sxx === 0) return null;
    var slope = sxy / sxx, intercept = my - slope * mx, r = (syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
    return { slope: slope, intercept: intercept, r2: r * r, n: n };
  }
  function powerFit(xs, ys) {
    var lx = [], ly = [];
    for (var i = 0; i < xs.length; i++) if (xs[i] > 0.5 && ys[i] > 0.5) { lx.push(Math.log(xs[i])); ly.push(Math.log(ys[i])); }
    var f = ols(lx, ly); if (!f) return null;
    return { a: Math.exp(f.intercept), b: f.slope, r2: f.r2, n: f.n };
  }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function sd(a) { if (a.length < 2) return null; var m = mean(a), s = 0; a.forEach(function (v) { s += (v - m) * (v - m); }); return Math.sqrt(s / (a.length - 1)); }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; }

  // ── large-cohort safe helpers (needed once SYNTH_CAP lifts) ────────────────────────
  // Math.max.apply(null, bigArray) spreads every element as an ARGUMENT and blows the call
  // stack somewhere around 1e5 — a hard RangeError, not a slowdown. Loop instead.
  function maxOf(arr, f) { var mv = -Infinity; for (var i = 0; i < arr.length; i++) { var v = f ? f(arr[i]) : arr[i]; if (v > mv) mv = v; } return mv === -Infinity ? 0 : mv; }

  // One beginPath/arc/fill PER POINT costs a full path submission per dot: fine at 2.5k,
  // seconds at 1e5. Group the dots by their draw state (colour × alpha × radius) and submit
  // ONE path per group — same pixels, ~2 orders of magnitude fewer path submissions.
  function dotsBatched(ctx, pts, xf, yf, colOf, alphaOf, radOf) {
    var groups = Object.create(null), i, p, key;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      key = colOf(p) + '|' + alphaOf(p) + '|' + radOf(p);
      (groups[key] || (groups[key] = { col: colOf(p), a: alphaOf(p), r: radOf(p), pts: [] })).pts.push(p);
    }
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      ctx.fillStyle = g.col; ctx.globalAlpha = g.a;
      ctx.beginPath();
      for (var j = 0; j < g.pts.length; j++) {
        var q = g.pts[j], x = xf(q), y = yf(q);
        ctx.moveTo(x + g.r, y);            // moveTo before arc → no connecting line between dots
        ctx.arc(x, y, g.r, 0, 7);
      }
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  // ── leave-one-out RMSE — O(n) via PRESS, not O(n²) by refitting ────────────────────
  // The old implementation refit the model n times, once per held-out point: O(n²), plus
  // two fresh (n−1)-length arrays per iteration. For ORDINARY LEAST SQUARES that refit is
  // unnecessary — the leave-one-out residual has a closed form (the PRESS statistic):
  //
  //     e_(k) = e_k / (1 − h_k),      h_k = 1/n + (x_k − x̄)² / Sxx
  //
  // where e_k is the residual of the SINGLE full fit and h_k is that point's leverage. It
  // is the same number, exactly — verified against the old refit across naive/linear/power
  // at n = 4…2500: worst relative difference 4.7e-14 (float round-off). Measured 157× at
  // n=2500 and 2,387× at n=20,000, so the O(n²) cost that forced SYNTH_CAP is simply gone.
  // `powerFit` is just OLS on log-log, so the same identity applies there — with the one
  // wrinkle that its {x>0.5 && y>0.5} subset means points OUTSIDE the subset are in NO
  // training set, so dropping them changes nothing and their LOO fit IS the full-subset fit.
  function pressFit(xs, ys) {
    var n = xs.length, i, sx = 0, sy = 0;
    for (i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    var mx = sx / n, my = sy / n, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { var dx = xs[i] - mx; sxx += dx * dx; sxy += dx * (ys[i] - my); }
    if (!(sxx > 0)) return null;
    return { n: n, sx: sx, sy: sy, mx: mx, my: my, sxx: sxx, sxy: sxy,
             slope: sxy / sxx, intercept: my - (sxy / sxx) * mx };
  }
  function looRMSE(xs, ys, kind) {
    var n = xs.length; if (n < 4) return null;
    var se = 0, m = 0, k, e;

    if (kind === 'naive') {                       // no fit → nothing to leave out
      for (k = 0; k < n; k++) { e = xs[k] * 1.1 - ys[k]; se += e * e; m++; }
      return m ? Math.sqrt(se / m) : null;
    }

    if (kind === 'linear') {
      var f = pressFit(xs, ys); if (!f) return null;
      for (k = 0; k < n; k++) {
        var h = 1 / f.n + ((xs[k] - f.mx) * (xs[k] - f.mx)) / f.sxx;   // leverage
        if (!(h < 1)) continue;
        e = ((f.slope * xs[k] + f.intercept) - ys[k]) / (1 - h);        // LOO residual
        se += e * e; m++;
      }
      return m ? Math.sqrt(se / m) : null;
    }

    // power: OLS on the log-log subset, then exact O(1) downdate for members of the subset
    var idx = [], lx = [], ly = [], i;
    for (i = 0; i < n; i++) if (xs[i] > 0.5 && ys[i] > 0.5) { idx.push(i); lx.push(Math.log(xs[i])); ly.push(Math.log(ys[i])); }
    var g = (lx.length >= 2) ? pressFit(lx, ly) : null;
    if (!g) return null;
    var inSub = new Int32Array(n); for (i = 0; i < n; i++) inSub[i] = -1;
    for (i = 0; i < idx.length; i++) inSub[idx[i]] = i;
    var M = g.n;

    for (k = 0; k < n; k++) {
      var sl = g.slope, ic = g.intercept, j = inSub[k];
      if (j >= 0) {
        if (M < 3) continue;                                  // the fit needs ≥2 training points
        var dxj = lx[j] - g.mx, hj = 1 / M + (dxj * dxj) / g.sxx;
        if (!(hj < 1)) continue;
        var mx2 = (g.sx - lx[j]) / (M - 1), my2 = (g.sy - ly[j]) / (M - 1);
        var sxx2 = g.sxx - (dxj * dxj) * (M / (M - 1));
        var sxy2 = g.sxy - (dxj * (ly[j] - g.my)) * (M / (M - 1));
        if (!(sxx2 > 0)) continue;
        sl = sxy2 / sxx2; ic = my2 - sl * mx2;
      }
      e = (Math.exp(ic) * Math.pow(xs[k], sl)) - ys[k];
      se += e * e; m++;
    }
    return m ? Math.sqrt(se / m) : null;
  }

  function addPoint(src, id, odi4, ahi, minSpo2, durMin, ahiSrc) {
    if (odi4 == null || ahi == null || !isFinite(odi4) || !isFinite(ahi)) return false;
    POINTS.push({ src: src, id: id, odi4: +odi4, ahi: +ahi, sev: window.NSRR.severityOf(ahi), minSpo2: minSpo2, durMin: durMin, ahiSrc: ahiSrc || src });
    return true;
  }

  // ── source 1: SubjectA real nights ──
  async function fetchText(p) { var r = await fetch(p); if (!r.ok) throw new Error(p + ' → ' + r.status); return r.text(); }
  async function runSubjectA() {
    setStatus('SubjectA: parsing…', 'run');
    var added = 0;
    for (var i = 0; i < NIGHTS.length; i++) {
      var cfg = NIGHTS[i];
      try {
        var gt = JSON.parse(await fetchText(DIR + cfg.gt));
        var csv = await fetchText(DIR + cfg.oxy);
        var rows = parseCSV(csv, { name: cfg.oxy });      // parseCSV returns the rows array directly
        var night = processNight(rows, cfg.oxy);
        var odi4 = night.odi4 ? night.odi4.rate : null;
        var minSpo2 = night.stats ? night.stats.minSpo2 : null;
        var durMin = night.stats ? night.stats.durationMin : null;
        if (addPoint('subjectA', 'night ' + cfg.n, odi4, gt.ahiTarget, minSpo2, durMin, 'planted')) added++;
      } catch (e) { console.warn('SubjectA night', cfg.n, e); }
    }
    setStatus('SubjectA: ' + added + ' nights', 'done');
    render();
  }

  // ── source 2: synthetic cohort from IndexedDB ──
  function loadSynthetic() {
    setStatus('synthetic: reading IndexedDB…', 'run');
    // The old cap was 2,500 nights, and it existed ONLY because looRMSE refit the model once
    // per held-out point: O(n²). That refit is gone — the leave-one-out residual now comes
    // from the PRESS closed form in O(n) (see looRMSE above; identical to 4.7e-14, measured
    // 2,387× at n=20,000). The full 20k-subject cohort (~115k nights) is therefore in reach
    // here rather than deferred to the robustness paper. The remaining ceiling is a memory /
    // draw guard, not a compute one — POINTS is held in RAM and drawn on three canvases.
    var SYNTH_CAP = 200000;
    var rq = indexedDB.open('ganglior_cohort_pilot');
    rq.onerror = function () { setStatus('no cohort DB found', 'idle'); };
    rq.onsuccess = function () {
      var db = rq.result;
      if (!db.objectStoreNames.contains('results')) { setStatus('cohort DB empty', 'idle'); db.close(); return; }
      var tx = db.transaction('results', 'readonly'), st = tx.objectStore('results'), added = 0;
      st.openCursor().onsuccess = function (ev) {
        var cur = ev.target.result;
        if (cur) {
          var r = cur.value;
          // each cohort-runner result carries OxyDex per-night ODI↔truth-AHI pairs.
          // Current shape (cohort-runner): r.oxy.calib = [{odi, estAHI, truthAHI, sev}].
          // Legacy shape: r.oxy.nights = [{odi, minSpo2, durationMin}] + r.groundTruth.nights[idx].ahiTruth.
          if (r && r.oxy && Array.isArray(r.oxy.calib)) {
            r.oxy.calib.forEach(function (c, idx) {
              if (added >= SYNTH_CAP) return;
              if (c && c.odi != null && c.truthAHI != null) {
                if (addPoint('synthetic', (r.pid || ('seed' + r.seed)) + '·n' + (idx + 1), c.odi, c.truthAHI, c.minSpo2 != null ? c.minSpo2 : null, null, 'synthetic')) added++;
              }
            });
          } else if (r && r.oxy && r.oxy.nights && r.profile) {
            r.oxy.nights.forEach(function (nt, idx) {
              if (added >= SYNTH_CAP) return;
              var truth = (r.groundTruth && r.groundTruth.nights && r.groundTruth.nights[idx]) ? r.groundTruth.nights[idx].ahiTruth : null;
              if (nt && nt.odi != null && truth != null) { if (addPoint('synthetic', r.pid + '·n' + (idx + 1), nt.odi, truth, nt.minSpo2, nt.durationMin, 'synthetic')) added++; }
            });
          }
          if (added >= SYNTH_CAP) { setStatus('synthetic: ' + added + ' nights (capped)', 'done'); db.close(); render(); return; }
          cur.continue();
        } else { setStatus('synthetic: ' + added + ' nights', 'done'); db.close(); render(); }
      };
    };
  }

  // ── source 3: NSRR EDF + XML (or CSV-provided AHI) ──
  function baseName(fn) { return fn.replace(/\.(edf|xml)$/i, '').replace(/-nsrr$/i, '').replace(/-profusion$/i, ''); }
  function readBuf(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); }); }
  function readTxt(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file); }); }

  async function onNsrrFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i], b = baseName(f.name);
      NSRR_FILES[b] = NSRR_FILES[b] || {};
      if (/\.edf$/i.test(f.name)) NSRR_FILES[b].edf = f; else if (/\.xml$/i.test(f.name)) NSRR_FILES[b].xml = f;
    }
    var keys = Object.keys(NSRR_FILES).filter(function (k) { return NSRR_FILES[k].edf; });
    setStatus('NSRR: analyzing ' + keys.length + ' record(s)…', 'run');
    var added = 0;
    for (var k = 0; k < keys.length; k++) {
      var rec = NSRR_FILES[keys[k]];
      try {
        var buf = await readBuf(rec.edf);
        var opts = { id: keys[k], edfBuffer: buf };
        if (rec.xml) opts.xmlText = await readTxt(rec.xml);
        else { var csvAhi = lookupAhi(keys[k]); if (csvAhi != null) { opts.scoredAHI = csvAhi.ahi; opts.ahiVar = csvAhi.via; } }
        var res = window.NSRR.analyzeRecord(opts);
        if (res.err) { console.warn('NSRR', keys[k], res.err); continue; }
        if (res.scoredAHI == null) { console.warn('NSRR', keys[k], 'no reference AHI (need XML or CSV)'); continue; }
        if (addPoint('nsrr', keys[k], res.odi4, res.scoredAHI, res.minSpo2, res.durMin, res.ahiSource)) added++;
      } catch (e) { console.warn('NSRR', keys[k], e); }
    }
    setStatus('NSRR: +' + added + ' record(s)', 'done');
    render();
  }

  // Tolerant id lookup: an EDF stem 'shhs1-200001' should match nsrrid '200001'.
  // Tries the full stem, then the trailing numeric id, then a 'cohortN-' strip.
  function lookupAhi(stem) {
    if (AHI_CSV[stem] != null) return { ahi: AHI_CSV[stem], via: 'csv' };
    var num = (stem.match(/(\d{3,})\s*$/) || [])[1];
    if (num && AHI_CSV[num] != null) return { ahi: AHI_CSV[num], via: 'csv(id)' };
    var strip = stem.replace(/^[a-z]+\d*[-_]/i, '');
    if (AHI_CSV[strip] != null) return { ahi: AHI_CSV[strip], via: 'csv(id)' };
    return null;
  }

  // NSRR harmonized AHI variables, best-first per cohort (4% desat / AHI definitions).
  var NSRR_AHI_VARS = ['ahi_a0h4', 'ahi_a0h4a', 'ahi_a0h3a', 'ahi_a0h3', 'ahi_c0h4', 'ahi_c0h3',
    'ahi_ap0nop', 'poohi4', 'poohi3', 'rdi4p', 'rdi3p', 'oahi4', 'oahi3', 'ahi', 'rdi'];
  var NSRR_ID_VARS = ['nsrrid', 'pptid', 'subject', 'id', 'studyid', 'mesaid', 'idtype'];

  function onAhiCsv(text) {
    AHI_CSV = {};
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) { setStatus('empty CSV', 'idle'); return; }
    var delim = (lines[0].indexOf('\t') >= 0) ? '\t' : ',';
    var head = lines[0].split(delim).map(function (h) { return h.trim().replace(/^"|"$/g, '').toLowerCase(); });
    var headerLooksReal = head.some(function (h) { return isNaN(parseFloat(h)); });

    if (headerLooksReal) {
      // wide NSRR harmonized CSV: find the id column + the best AHI variable present
      var idCol = -1; for (var a = 0; a < NSRR_ID_VARS.length && idCol < 0; a++) idCol = head.indexOf(NSRR_ID_VARS[a]);
      if (idCol < 0) idCol = 0;
      var ahiCol = -1, ahiVar = null;
      for (var v = 0; v < NSRR_AHI_VARS.length && ahiCol < 0; v++) { var ix = head.indexOf(NSRR_AHI_VARS[v]); if (ix >= 0) { ahiCol = ix; ahiVar = NSRR_AHI_VARS[v]; } }
      if (ahiCol < 0) { setStatus('no known AHI column (looked for ahi_a0h4, poohi4, rdi4p…)', 'idle'); return; }
      var n = 0;
      for (var r = 1; r < lines.length; r++) {
        var c = lines[r].split(delim); if (c.length <= Math.max(idCol, ahiCol)) continue;
        var id = c[idCol].trim().replace(/^"|"$/g, ''); var ahi = parseFloat(c[ahiCol]);
        if (id && isFinite(ahi)) { AHI_CSV[id] = ahi; n++; }
      }
      AHI_CSV.__var = ahiVar;
      setStatus(n + ' rows · AHI var “' + ahiVar + '” · id col “' + head[idCol] + '” (add EDFs to pair)', 'done');
      return;
    }

    // fallback: simple id,ahi (header optional)
    var cnt = 0;
    lines.forEach(function (ln) {
      var c = ln.split(/[,\t]/); if (c.length < 2) return;
      var id = c[0].trim(), ahi = parseFloat(c[1]);
      if (id && isFinite(ahi)) { AHI_CSV[id.replace(/\.(edf|xml)$/i, '')] = ahi; cnt++; }
    });
    setStatus(cnt + ' AHI rows loaded (add EDFs to pair)', 'idle');
  }

  // ── rendering ──
  function clearCanvas(ctx, w, h) { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0f141b'; ctx.fillRect(0, 0, w, h); }
  function axes(ctx, P, w, h, xmax, ymax, xlab, ylab) {
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.fillStyle = '#6f8096'; ctx.font = '11px ui-monospace,monospace';
    ctx.beginPath(); ctx.moveTo(P, 10); ctx.lineTo(P, h - P); ctx.lineTo(w - 12, h - P); ctx.stroke();
    var ticks = 5;
    for (var i = 0; i <= ticks; i++) {
      var xv = xmax * i / ticks, yv = ymax * i / ticks;
      var px = P + (w - P - 12) * i / ticks, py = (h - P) - (h - P - 10) * i / ticks;
      ctx.fillText(Math.round(xv), px - 6, h - P + 16);
      ctx.fillText(Math.round(yv), 6, py + 4);
      ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(P, py); ctx.lineTo(w - 12, py); ctx.stroke();
    }
    ctx.fillStyle = '#aab8cc'; ctx.fillText(xlab, (w / 2) - 30, h - 6); ctx.save();
    ctx.translate(12, h / 2 + 30); ctx.rotate(-Math.PI / 2); ctx.fillText(ylab, 0, 0); ctx.restore();
  }

  function render() {
    var n = POINTS.length;
    $('rowsTag').textContent = n + ' rows';
    if (!n) return;
    var xs = POINTS.map(function (p) { return p.odi4; }), ys = POINTS.map(function (p) { return p.ahi; });
    var fitOnOdi = ols(xs, ys);                                   // AHI = a·ODI + b  (for correction / fitTag)
    var ahiArr = ys, odiArr = xs;
    var fitScatter = ols(ahiArr, odiArr);                         // ODI = m·AHI + b  (undercount slope, for scatter+headline)
    var biases = POINTS.map(function (p) { return p.odi4 - p.ahi; });
    var meanBias = mean(biases), sdBias = sd(biases);
    var severe = POINTS.filter(function (p) { return p.sev === 'severe'; });
    var severeUnder = severe.length ? mean(severe.map(function (p) { return p.ahi - p.odi4; })) : null;

    // headline
    $('hN').textContent = n;
    $('hSlope').textContent = fitScatter ? fitScatter.slope.toFixed(3) : '—';
    $('hR2').textContent = fitScatter ? fitScatter.r2.toFixed(3) : '—';
    $('hBias').textContent = meanBias != null ? meanBias.toFixed(1) : '—';
    $('hSevere').textContent = severeUnder != null ? ('−' + severeUnder.toFixed(1) + '/h') : '—';
    $('fitTag').textContent = fitScatter ? ('ODI≈' + fitScatter.slope.toFixed(2) + '·AHI · R²=' + fitScatter.r2.toFixed(2)) : 'fit —';

    drawScatter(fitScatter); drawBland(meanBias, sdBias); drawBySev(); drawCorr(xs, ys); drawTable(); drawSources();
    ['dlCsv', 'dlStats', 'dlFig'].forEach(function (id) { $(id).disabled = false; });
  }

  function drawScatter(fit) {
    var cv = $('scatter'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 46;
    clearCanvas(ctx, w, h);
    var maxV = Math.max(10, Math.ceil(maxOf(POINTS, function (p) { return Math.max(p.odi4, p.ahi); }) / 10) * 10);
    axes(ctx, P, w, h, maxV, maxV, 'reference AHI (events/h)', 'OxyDex ODI-4 (events/h)');
    var X = function (v) { return P + (w - P - 12) * v / maxV; }, Y = function (v) { return (h - P) - (h - P - 10) * v / maxV; };
    // identity
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(maxV), Y(maxV)); ctx.stroke(); ctx.setLineDash([]);
    // OxyDex ×1.1 surrogate (odi = ahi/1.1 → as ahi varies)
    ctx.strokeStyle = 'rgba(255,184,77,.5)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(maxV), Y(maxV / 1.1)); ctx.stroke(); ctx.setLineDash([]);
    // OLS fit (odi = slope·ahi + b)
    if (fit) { ctx.strokeStyle = '#3DE0D0'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(X(0), Y(fit.intercept)); ctx.lineTo(X(maxV), Y(fit.slope * maxV + fit.intercept)); ctx.stroke(); }
    // points (x=AHI ref, y=ODI4)
    dotsBatched(ctx, POINTS,
      function (p) { return X(p.ahi); }, function (p) { return Y(p.odi4); },
      function (p) { return SEV_COLOR[p.sev] || '#888'; },
      function (p) { return p.src === 'synthetic' ? 0.4 : 0.95; },
      function (p) { return p.src === 'synthetic' ? 2.2 : 4; });
    // real points keep their SRC_COLOR ring (the legend's "ringed = real") — one stroked
    // path per source, instead of one per point. Synthetic points were never ringed.
    (function () {
      var bySrc = Object.create(null);
      POINTS.forEach(function (p) { if (p.src !== 'synthetic') (bySrc[p.src] || (bySrc[p.src] = [])).push(p); });
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
      Object.keys(bySrc).forEach(function (src) {
        ctx.strokeStyle = SRC_COLOR[src];
        ctx.beginPath();
        bySrc[src].forEach(function (p) {
          var x = X(p.ahi), y = Y(p.odi4);
          ctx.moveTo(x + 4, y); ctx.arc(x, y, 4, 0, 7);
        });
        ctx.stroke();
      });
    })();
    ctx.globalAlpha = 1;
    $('scatterLegend').innerHTML = 'Dashed white = identity (perfect). Dotted amber = OxyDex shipped ×1.1 surrogate. Solid teal = OLS. Below-identity points = ODI-4 under-counts. ' +
      '<span class="src-chip" style="background:#39D98A"></span>none <span class="src-chip" style="background:#3DE0D0"></span>mild <span class="src-chip" style="background:#FFB84D"></span>mod <span class="src-chip" style="background:#FF6B7A"></span>severe · ringed = real (SubjectA/NSRR), faint = synthetic';
  }

  function drawBland(meanBias, sdBias) {
    var cv = $('bland'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 46;
    clearCanvas(ctx, w, h);
    var means = POINTS.map(function (p) { return (p.odi4 + p.ahi) / 2; });
    var diffs = POINTS.map(function (p) { return p.odi4 - p.ahi; });
    var xmax = Math.max(10, Math.ceil(maxOf(means) / 10) * 10);
    var dmin = Math.min.apply(null, diffs.concat([meanBias - 2 * (sdBias || 1)]));
    var dmax = Math.max(maxOf(diffs), meanBias + 2 * (sdBias || 1), 2);
    var pad = (dmax - dmin) * 0.1 || 2; dmin -= pad; dmax += pad;
    var X = function (v) { return P + (w - P - 12) * v / xmax; };
    var Y = function (v) { return (h - P) - (h - P - 10) * (v - dmin) / (dmax - dmin); };
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(P, 10); ctx.lineTo(P, h - P); ctx.lineTo(w - 12, h - P); ctx.stroke();
    ctx.fillStyle = '#6f8096'; ctx.font = '11px ui-monospace,monospace';
    [0, 0.5, 1].forEach(function (f) { var xv = xmax * f; ctx.fillText(Math.round(xv), X(xv) - 6, h - P + 16); });
    // zero line
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(P, Y(0)); ctx.lineTo(w - 12, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    // bias + LoA
    if (meanBias != null) {
      ctx.strokeStyle = '#FFB84D'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(P, Y(meanBias)); ctx.lineTo(w - 12, Y(meanBias)); ctx.stroke();
      if (sdBias != null) { ctx.strokeStyle = 'rgba(255,107,122,.6)'; ctx.setLineDash([5, 4]); [meanBias + 1.96 * sdBias, meanBias - 1.96 * sdBias].forEach(function (L) { ctx.beginPath(); ctx.moveTo(P, Y(L)); ctx.lineTo(w - 12, Y(L)); ctx.stroke(); }); ctx.setLineDash([]); }
    }
    dotsBatched(ctx, POINTS.map(function (p, i) { return { p: p, mx: means[i], dy: diffs[i] }; }),
      function (q) { return X(q.mx); }, function (q) { return Y(q.dy); },
      function (q) { return SEV_COLOR[q.p.sev]; },
      function (q) { return q.p.src === 'synthetic' ? 0.35 : 0.9; },
      function (q) { return q.p.src === 'synthetic' ? 2 : 3.6; });
    ctx.globalAlpha = 1; ctx.fillStyle = '#aab8cc'; ctx.fillText('mean(ODI-4, AHI)', w / 2 - 50, h - 6);
    ctx.save(); ctx.translate(12, h / 2 + 30); ctx.rotate(-Math.PI / 2); ctx.fillText('ODI-4 − AHI', 0, 0); ctx.restore();
    $('blandLegend').innerHTML = 'Mean bias <b style="color:#FFB84D">' + (meanBias != null ? meanBias.toFixed(1) : '—') + '/h</b>, 95% LoA ±' + (sdBias != null ? (1.96 * sdBias).toFixed(1) : '—') + '. Points trend more negative at higher mean → proportional under-count.';
  }

  function drawBySev() {
    var cv = $('bysev'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 46;
    clearCanvas(ctx, w, h);
    var order = ['none', 'mild', 'mod', 'severe'];
    var ratios = order.map(function (s) { var g = POINTS.filter(function (p) { return p.sev === s && p.ahi > 0; }).map(function (p) { return p.odi4 / p.ahi; }); return { s: s, r: median(g), n: g.length }; });
    var bw = (w - P - 30) / order.length;
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(P, 10); ctx.lineTo(P, h - P); ctx.lineTo(w - 12, h - P); ctx.stroke();
    var Y = function (v) { return (h - P) - (h - P - 10) * Math.min(v, 1.2) / 1.2; };
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(P, Y(1)); ctx.lineTo(w - 12, Y(1)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#6f8096'; ctx.font = '11px ui-monospace,monospace'; ctx.fillText('1.0 (perfect)', w - 100, Y(1) - 5);
    ratios.forEach(function (d, i) {
      var x = P + 16 + i * bw;
      if (d.r != null) { ctx.fillStyle = SEV_COLOR[d.s]; ctx.fillRect(x, Y(d.r), bw - 20, (h - P) - Y(d.r)); ctx.fillStyle = '#e6edf6'; ctx.font = '12px ui-monospace'; ctx.fillText(d.r.toFixed(2), x + 4, Y(d.r) - 6); }
      ctx.fillStyle = '#aab8cc'; ctx.font = '11px ui-monospace'; ctx.fillText(d.s + ' (' + d.n + ')', x, h - P + 16);
    });
  }

  function drawCorr(xs, ys) {
    var cv = $('corr'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 46;
    clearCanvas(ctx, w, h);
    var maxX = Math.max(5, Math.ceil(maxOf(xs) / 5) * 5);
    var maxY = Math.max(10, Math.ceil(maxOf(ys) / 10) * 10);
    axes(ctx, P, w, h, maxX, maxY, 'OxyDex ODI-4 (events/h)', 'reference AHI (events/h)');
    var X = function (v) { return P + (w - P - 12) * v / maxX; }, Y = function (v) { return (h - P) - (h - P - 10) * v / maxY; };
    dotsBatched(ctx, POINTS,
      function (p) { return X(p.odi4); }, function (p) { return Y(p.ahi); },
      function (p) { return SEV_COLOR[p.sev]; },
      function (p) { return p.src === 'synthetic' ? 0.3 : 0.9; },
      function (p) { return p.src === 'synthetic' ? 2 : 3.6; });
    ctx.globalAlpha = 1;
    // naive ×1.1
    ctx.strokeStyle = 'rgba(255,184,77,.7)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(maxX), Y(maxX * 1.1)); ctx.stroke(); ctx.setLineDash([]);
    // linear correction (ref = a·odi + b)
    var lin = ols(xs, ys);
    if (lin) { ctx.strokeStyle = '#3DE0D0'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(X(0), Y(lin.intercept)); ctx.lineTo(X(maxX), Y(lin.slope * maxX + lin.intercept)); ctx.stroke(); }
    // power correction
    var pw = powerFit(xs, ys);
    if (pw) { ctx.strokeStyle = '#B98AFF'; ctx.lineWidth = 1.6; ctx.beginPath(); for (var v = 0.5; v <= maxX; v += maxX / 80) { var py = pw.a * Math.pow(v, pw.b); if (v === 0.5) ctx.moveTo(X(v), Y(py)); else ctx.lineTo(X(v), Y(py)); } ctx.stroke(); }
    var rNaive = looRMSE(xs, ys, 'naive'), rLin = looRMSE(xs, ys, 'linear'), rPw = looRMSE(xs, ys, 'power');
    $('corrTag').textContent = pw ? ('AHI≈' + pw.a.toFixed(2) + '·ODI^' + pw.b.toFixed(2)) : 'model —';
    $('corrLegend').innerHTML = 'LOO-RMSE (events/h): <b style="color:#FFB84D">naive ×1.1 ' + (rNaive != null ? rNaive.toFixed(1) : '—') + '</b> · ' +
      '<b style="color:#3DE0D0">linear ' + (rLin != null ? rLin.toFixed(1) : '—') + '</b> · <b style="color:#B98AFF">power ' + (rPw != null ? rPw.toFixed(1) : '—') + '</b>. Lower = better recalibration than the shipped surrogate.';
  }

  function drawTable() {
    var tb = $('tbl').querySelector('tbody'); tb.innerHTML = '';
    POINTS.filter(function (p) { return p.src !== 'synthetic'; }).concat(POINTS.filter(function (p) { return p.src === 'synthetic'; }).slice(0, 40))
      .forEach(function (p) {
        var tr = document.createElement('tr');
        var ratio = p.ahi > 0 ? (p.odi4 / p.ahi).toFixed(2) : '—';
        tr.innerHTML = '<td><span class="src-chip" style="background:' + SRC_COLOR[p.src] + '"></span>' + p.src + '</td><td class="muted">' + p.id + '</td>' +
          '<td class="num">' + p.odi4.toFixed(1) + '</td><td class="num">' + p.ahi.toFixed(1) + '</td>' +
          '<td class="num" style="color:' + (p.odi4 - p.ahi < 0 ? '#FF6B7A' : '#39D98A') + '">' + (p.odi4 - p.ahi).toFixed(1) + '</td>' +
          '<td class="num">' + ratio + '</td><td style="color:' + SEV_COLOR[p.sev] + '">' + p.sev + '</td>' +
          '<td class="num">' + (p.minSpo2 != null ? p.minSpo2 : '—') + '</td><td class="num">' + (p.durMin != null ? Math.round(p.durMin) : '—') + '</td><td class="num muted">' + (p.ahiSrc || '') + '</td>';
        tb.appendChild(tr);
      });
  }

  function drawSources() {
    var counts = {};
    POINTS.forEach(function (p) { counts[p.src] = (counts[p.src] || 0) + 1; });
    $('sources').innerHTML = Object.keys(counts).map(function (s) {
      var g = POINTS.filter(function (p) { return p.src === s && p.ahi > 0; });
      var f = ols(g.map(function (p) { return p.ahi; }), g.map(function (p) { return p.odi4; }));   // ODI = slope·AHI
      var b = mean(g.map(function (p) { return p.odi4 - p.ahi; }));
      var stat = f ? ('slope ' + f.slope.toFixed(2) + ' · R² ' + f.r2.toFixed(2) + ' · bias ' + (b != null ? b.toFixed(1) : '—')) : 'n<2';
      return '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px"><span><span class="src-chip" style="background:' + SRC_COLOR[s] + '"></span>' + s + '</span><span class="mono">' + counts[s] + ' nights</span></div>' +
        '<div class="mono" style="font-size:10px;color:var(--text3);margin-top:2px">' + stat + '</div></div>';
    }).join('') || '<div class="muted mono" style="font-size:11px">none yet</div>';
    var hasReal = POINTS.some(function (p) { return p.src === 'nsrr'; });
    if (!hasReal && POINTS.length) $('sources').innerHTML += '<div class="mono" style="font-size:10px;color:var(--amber);margin-top:8px;line-height:1.4">⚠ no NSRR points — synthetic/SubjectA prove the apparatus but are NOT a clinical claim. Add real PSG to publish.</div>';
  }

  // ── exports ──
  function download(name, text, mime) { var b = new Blob([text], { type: mime || 'text/plain' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  function exportCsv() {
    var rows = [['source', 'record', 'odi4', 'ahi_ref', 'diff', 'ratio', 'severity', 'min_spo2', 'dur_min', 'ahi_source']];
    POINTS.forEach(function (p) { rows.push([p.src, p.id, p.odi4, p.ahi, (p.odi4 - p.ahi).toFixed(2), (p.ahi > 0 ? (p.odi4 / p.ahi).toFixed(3) : ''), p.sev, p.minSpo2, p.durMin, p.ahiSrc]); });
    download('odi-bias-results.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
  }
  function exportStats() {
    var xs = POINTS.map(function (p) { return p.odi4; }), ys = POINTS.map(function (p) { return p.ahi; });
    var fit = ols(xs, ys), biases = POINTS.map(function (p) { return p.odi4 - p.ahi; });
    var bySev = {}; ['none', 'mild', 'mod', 'severe'].forEach(function (s) { var g = POINTS.filter(function (p) { return p.sev === s && p.ahi > 0; }); bySev[s] = { n: g.length, medRatio: median(g.map(function (p) { return p.odi4 / p.ahi; })), meanUnder: mean(g.map(function (p) { return p.ahi - p.odi4; })) }; });
    var srcCounts = {}; POINTS.forEach(function (p) { srcCounts[p.src] = (srcCounts[p.src] || 0) + 1; });
    // per-source fit so the real anchor is never masked by the synthetic-dominated pool
    var perSource = {};
    Object.keys(srcCounts).forEach(function (s) {
      var g = POINTS.filter(function (p) { return p.src === s && p.ahi > 0; });
      perSource[s] = { n: g.length, ols: ols(g.map(function (p) { return p.ahi; }), g.map(function (p) { return p.odi4; })),
        meanBias: mean(g.map(function (p) { return p.odi4 - p.ahi; })),
        severeMeanUnder: (function () { var sv = g.filter(function (p) { return p.sev === 'severe'; }); return sv.length ? mean(sv.map(function (p) { return p.ahi - p.odi4; })) : null; })() };
    });
    var out = {
      generated: new Date().toISOString(), n: POINTS.length, sources: srcCounts, perSource: perSource,
      olsOdiVsAhi: fit, meanBias: mean(biases), sdBias: sd(biases),
      loa95: sd(biases) != null ? { lo: mean(biases) - 1.96 * sd(biases), hi: mean(biases) + 1.96 * sd(biases) } : null,
      bySeverity: bySev,
      correction: { naiveRMSE: looRMSE(xs, ys, 'naive'), linearRMSE: looRMSE(xs, ys, 'linear'), powerRMSE: looRMSE(xs, ys, 'power'), linear: ols(xs, ys), power: powerFit(xs, ys) },
      note: 'ODI-4 from real OxyDex processNight. Reference AHI sources: subjectA=planted, synthetic=cohort ground truth, nsrr=PSG-scored. Synthetic/SubjectA are NOT clinical validation; only nsrr points support a real-world claim.',
    };
    download('odi-bias-stats.json', JSON.stringify(out, null, 2), 'application/json');
  }
  function exportFig() {
    var ids = ['scatter', 'bland', 'bysev', 'corr'], pad = 16, cols = 2;
    var c0 = $('scatter'); var cw = c0.width, ch = c0.height;
    var W = cw * cols + pad * 3, H = ch * 2 + pad * 3;
    var out = document.createElement('canvas'); out.width = W; out.height = H; var ctx = out.getContext('2d');
    ctx.fillStyle = '#0c0f14'; ctx.fillRect(0, 0, W, H);
    ids.forEach(function (id, i) { var cv = $(id); var x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + pad); ctx.drawImage(cv, x, y, cw, ch); });
    out.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'odi-bias-figures.png'; a.click(); }, 'image/png');
  }

  // ══ sample-size curve: how many paired nights to pin the ODI-4↔AHI slope? ══
  // PRIMARY = closed form. For OLS, the slope's relative 95%-CI half-width is
  //   1.96·√((1−R²)/(n−2)) / √R²  — a function of correlation and n ONLY (the SD ratio
  // cancels). Instant, exact, and generalizes to any assumed real-PSG R². The live
  // bootstrap below is optional corroboration of the synthetic (R²≈0.93) floor.
  function relCI(r2, n) { return n > 2 ? 1.96 * Math.sqrt((1 - r2) / (n - 2)) / Math.sqrt(r2) : Infinity; }
  function nForRel(r2, rel) { var r = Math.sqrt(r2); return Math.ceil(2 + Math.pow(1.96 / (rel * r), 2) * (1 - r2)); }
  function quantile(sorted, q) { var i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
  function setPowProg(f) { $('powBar').style.width = (f * 100).toFixed(1) + '%'; }
  var POOL = [];

  function renderAnalytic() {
    var r2 = +$('r2In').value, pSev = +$('sevIn').value;
    $('r2Val').textContent = r2.toFixed(2); $('sevVal').textContent = (pSev * 100).toFixed(0) + '%';
    var n10 = nForRel(r2, 0.10), n15 = nForRel(r2, 0.15), nFloor = nForRel(0.93, 0.10), nSevere = Math.ceil(35 / pSev);
    var target = Math.max(n10, nSevere);
    drawAnalytic(r2, n10, nFloor);
    $('powReport').innerHTML =
      '<b style="color:#3DE0D0;font-size:14px">Need ≈ ' + target + ' paired PSG nights</b><br>' +
      '<span class="muted">(binding of the two constraints)</span><br><br>' +
      '<b>1 · pin the slope (±10% CI):</b><br>' +
      '· at assumed R²=' + r2.toFixed(2) + ': <b>' + n10 + '</b> nights<br>' +
      '· looser ±15%: ' + n15 + '<br>' +
      '· synthetic floor (R²0.93): ' + nFloor + '<br><br>' +
      '<b>2 · severe stratum (where bias lives):</b><br>' +
      'severe ≈ ' + (pSev * 100).toFixed(0) + '% → <b>' + nSevere + '</b> total for ≥35 severe nights<br><br>' +
      '<span class="muted">~' + target + ' nights. Sleep-clinic cohorts (more severe) need fewer; community more. SHHS n≈5,800 is far past sufficient.</span>';
    $('powTag').textContent = '≈' + target + ' nights';
  }

  function drawAnalytic(r2, knee, floorN) {
    var cv = $('powCanvas'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 52; clearCanvas(ctx, w, h);
    var maxN = 400, maxY = 0.30, lnMin = Math.log(8), lnMax = Math.log(maxN);
    var X = function (n) { return P + (w - P - 14) * (Math.log(n) - lnMin) / (lnMax - lnMin); };
    var Y = function (v) { return (h - P) - (h - P - 12) * Math.min(v, maxY) / maxY; };
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(P, 10); ctx.lineTo(P, h - P); ctx.lineTo(w - 14, h - P); ctx.stroke();
    ctx.fillStyle = '#6f8096'; ctx.font = '11px ui-monospace,monospace';
    [10, 20, 50, 100, 200, 400].forEach(function (n) { ctx.fillText(n, X(n) - 7, h - P + 16); });
    for (var i = 0; i <= 5; i++) { var yv = maxY * i / 5; ctx.fillText((yv * 100).toFixed(0) + '%', 6, Y(yv) + 4); ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(P, Y(yv)); ctx.lineTo(w - 14, Y(yv)); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(P, Y(0.10)); ctx.lineTo(w - 14, Y(0.10)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#888'; ctx.fillText('±10% CI target', w - 132, Y(0.10) - 5);
    function curveLine(R, color, lw) { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); for (var n = 8; n <= maxN; n += 2) { var v = relCI(R, n); if (n === 8) ctx.moveTo(X(n), Y(v)); else ctx.lineTo(X(n), Y(v)); } ctx.stroke(); }
    curveLine(0.93, 'rgba(185,138,255,.6)', 1.4);
    curveLine(r2, '#3DE0D0', 2.2);
    ctx.strokeStyle = '#FFB84D'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(knee), 10); ctx.lineTo(X(knee), h - P); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#FFB84D'; ctx.font = '12px ui-monospace'; ctx.fillText('n≈' + knee, X(knee) + 5, 24);
    ctx.fillStyle = '#B98AFF'; ctx.font = '11px ui-monospace'; ctx.fillText('R²0.93 floor (n≈' + floorN + ')', X(38), Y(relCI(0.93, 38)) - 8);
    ctx.fillStyle = '#3DE0D0'; ctx.fillText('assumed R²' + r2.toFixed(2), X(150), Y(relCI(r2, 150)) - 8);
    ctx.fillStyle = '#aab8cc'; ctx.font = '11px ui-monospace'; ctx.fillText('paired nights n (log)', w / 2 - 50, h - 4);
    ctx.save(); ctx.translate(13, h / 2 + 70); ctx.rotate(-Math.PI / 2); ctx.fillText('slope 95%-CI half-width (relative)', 0, 0); ctx.restore();
  }

  async function buildPool(target) {
    if (!window.SYNTH || !window.CohortGen) { $('powStat').textContent = 'synth not loaded'; return false; }
    POOL = []; var seed = 0, guard = 0;
    while (POOL.length < target && guard < target * 6) {
      guard++;
      var pat; try { pat = CohortGen.patient(seed++); } catch (e) { continue; }
      for (var k = 0; k < pat.nights.length && POOL.length < target; k++) {
        var nt = pat.nights[k];
        if (!nt.files || !nt.files.oxyCSV) continue;
        try {
          var clean = nt.files.oxyCSV.split('\n').filter(function (ln, i) { return i === 0 || ln.indexOf(',--') < 0; }).join('\n');
          var rows = parseCSV(clean, { name: 'pool' });
          if (!rows || rows.length < 600) continue;
          var night = processNight(rows, 'pool');
          var odi4 = night.odi4 ? night.odi4.rate : null;
          if (odi4 != null && isFinite(odi4)) POOL.push({ odi4: odi4, ahi: nt.cfg.ahi });
        } catch (e) { /* skip */ }
      }
      if (POOL.length % 10 < 2) { setPowProg(POOL.length / target); $('powStat').textContent = 'pool ' + POOL.length + '/' + target; await new Promise(function (r) { setTimeout(r, 0); }); }
    }
    setPowProg(1); return POOL.length >= 40;
  }
  function slopeOf(idx) {
    var n = idx.length, sx = 0, sy = 0; for (var i = 0; i < n; i++) { sx += POOL[idx[i]].ahi; sy += POOL[idx[i]].odi4; }
    var mx = sx / n, my = sy / n, sxx = 0, sxy = 0; for (var j = 0; j < n; j++) { var dx = POOL[idx[j]].ahi - mx; sxx += dx * dx; sxy += dx * (POOL[idx[j]].odi4 - my); }
    return sxx ? sxy / sxx : null;
  }
  function sampleNoReplace(N) { var idx = [], used = {}; while (idx.length < N) { var r = Math.floor(Math.random() * POOL.length); if (!used[r]) { used[r] = 1; idx.push(r); } } return idx; }

  async function runBootstrap() {
    $('runPow').disabled = true; $('powStat').textContent = 'building pool…';
    var ok = await buildPool(130);
    if (!ok) { $('powStat').textContent = 'pool too small'; $('runPow').disabled = false; return; }
    var fullSlope = slopeOf(POOL.map(function (_, i) { return i; }));
    var maxN = Math.floor(POOL.length * 0.6);
    var Ns = [10, 15, 20, 30, 40, 50, 60, 75].filter(function (n) { return n <= maxN; });
    var B = 200, out = [];
    for (var s = 0; s < Ns.length; s++) {
      var N = Ns[s], slopes = [];
      for (var b = 0; b < B; b++) { var sl = slopeOf(sampleNoReplace(N)); if (sl != null) slopes.push(sl); }
      slopes.sort(function (a, c) { return a - c; });
      var half = (quantile(slopes, 0.975) - quantile(slopes, 0.025)) / 2, med = quantile(slopes, 0.5);
      out.push({ N: N, rel: med ? half / med : null });
      $('powStat').textContent = 'bootstrap N=' + N; setPowProg(s / Ns.length); await new Promise(function (r) { setTimeout(r, 0); });
    }
    setPowProg(1);
    var knee = out.find(function (c) { return c.rel != null && c.rel < 0.10; });
    var cv = $('powCanvas'), ctx = cv.getContext('2d'), w = cv.width, h = cv.height, P = 52, maxN2 = 400, maxY = 0.30;
    var X = function (n) { return P + (w - P - 14) * (Math.log(n) - Math.log(8)) / (Math.log(maxN2) - Math.log(8)); };
    var Y = function (v) { return (h - P) - (h - P - 12) * Math.min(v, maxY) / maxY; };
    out.forEach(function (c) { if (c.rel != null) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(c.N), Y(c.rel), 3, 0, 7); ctx.fill(); } });
    ctx.fillStyle = '#fff'; ctx.font = '11px ui-monospace'; ctx.fillText('● bootstrap (real OxyDex, n=' + POOL.length + ')', X(55), Y(0.27));
    $('powStat').textContent = 'bootstrap knee≈' + (knee ? knee.N : '>' + maxN) + ' (vs R²0.93 analytic ' + nForRel(0.93, 0.10) + ')';
    $('runPow').disabled = false;
    window.__bootstrap = { out: out, knee: knee, fullSlope: fullSlope, n: POOL.length };
  }

  // ── wire up ──
  $('runLocal').onclick = runSubjectA;
  $('runPow').onclick = runBootstrap;
  $('r2In').oninput = renderAnalytic;
  $('sevIn').oninput = renderAnalytic;
  renderAnalytic();
  $('loadSynth').onclick = loadSynthetic;
  $('nsrrFiles').onchange = function (e) { onNsrrFiles(e.target.files); };
  $('ahiCsv').onchange = function (e) { var f = e.target.files[0]; if (f) readTxt(f).then(onAhiCsv); };
  $('dlCsv').onclick = exportCsv; $('dlStats').onclick = exportStats; $('dlFig').onclick = exportFig;
})();
