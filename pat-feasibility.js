/*
 * pat-feasibility.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * PAT feasibility spike (ECGDex-BUILD-BRIEF §6 "Vascular metrics").
 * Question this instrument answers, on ONE real simultaneous night:
 *   Do a Polar H10 raw ECG and a Polar Verity raw PPG, both logged by the SAME phone
 *   (Polar Sensor Logger), land tightly enough on a shared wall-clock that per-beat
 *   PAT (Pulse Arrival Time = PPG foot − ECG R-peak) is a STABLE, physiologically
 *   plausible lag — the precondition for a provisional "Vascular (trend only)" panel.
 *
 * It REUSES the production detectors verbatim — ECGDSP (Pan–Tompkins R-peaks) and
 * PPGDSP (3-LED consensus feet) — so this is a faithful probe, not a re-implementation.
 * It does NOT claim absolute PAT / BP: PAT = PEP + PTT + a constant clock offset, none
 * separable without a cuff. The go/no-go is COUPLING (does every R get a foot at a
 * consistent lag?) + STABILITY (does that lag drift across the night?).
 * 100% local — no network. Runs in the page realm on kernel-constants.js + clock.js +
 * ecgdex-dsp.js + ppgdex-dsp.js (loaded by the shell, in that order).
 */
(function () {
  'use strict';

  // ── tunables (deliberately generous so a real clock offset REVEALS itself) ──
  var LAG_SEARCH_MS = 2000;   // look this far after each R for the paired foot
  var LAG_TOL_MS    = 90;     // a beat "couples" if its R→foot lag is within ±this of the modal lag
  var BIN_MIN       = 5;      // stability: median PAT per this-many-minute bin
  var PHYS_LO       = 150;    // plausible PAT band, ARM/forearm site + foot-vs-R convention offset:
  var PHYS_HI       = 480;    // informational only (never a hard gate). Fingertip PAT is shorter (~200-300).

  var state = { ecg: null, ppg: null, result: null };

  // ─────────────────────────────────────────────────────────────────────────
  //  file plumbing
  // ─────────────────────────────────────────────────────────────────────────
  function readText(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result || '')); };
      r.onerror = function () { rej(new Error('read failed: ' + file.name)); };
      r.readAsText(file);
    });
  }

  function fmtClock(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    var d = new Date(ms);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }
  function fmtDate(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    var d = new Date(ms);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function median(a) {
    if (!a.length) return NaN;
    var b = a.slice().sort(function (x, y) { return x - y; });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function quantile(a, q) {
    if (!a.length) return NaN;
    var b = a.slice().sort(function (x, y) { return x - y; });
    var i = (b.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (i - lo);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  detectors (production DSP, reused verbatim)
  // ─────────────────────────────────────────────────────────────────────────
  function ecgRpeakTimes(text) {
    if (typeof ECGDSP === 'undefined' || !ECGDSP.parseECG) throw new Error('ECGDSP not loaded');
    var rec = ECGDSP.parseECG(text);                        // {int16, fs, t0Ms, durSec}
    if (rec.t0Ms == null) throw new Error('ECG file carried no phone timestamp (need the "Phone timestamp" column).');
    var bp = ECGDSP.bandpass(rec.int16, rec.fs);
    var peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);  // sample indices
    var t = new Float64Array(peaks.length);
    for (var i = 0; i < peaks.length; i++) t[i] = rec.t0Ms + (peaks[i] / rec.fs) * 1000;
    return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, times: t, n: peaks.length };
  }

  function ppgFootTimes(text) {
    if (typeof PPGDSP === 'undefined' || !PPGDSP.parsePPG) throw new Error('PPGDSP not loaded');
    var rec = PPGDSP.parsePPG(text);                        // {ch:[F32×3], fs, t0Ms, relSec, n}
    if (rec.t0Ms == null) throw new Error('PPG file carried no phone timestamp.');
    // detect each optical channel, then keep the 3-LED consensus feet (the honest path)
    var per = rec.ch.map(function (c) { return PPGDSP.detectChannel(c, rec.fs); });
    var refIdx = 0, best = -1;
    per.forEach(function (p, i) { if (p.peaks.length > best) { best = p.peaks.length; refIdx = i; } });
    var cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);  // {feet: sample idx}
    var rel = rec.relSec, fs = rec.fs, t0 = rec.t0Ms;
    var t = new Float64Array(cons.feet.length);
    for (var i = 0; i < cons.feet.length; i++) {
      var idx = cons.feet[i];
      var sec = (rel && rel[idx] != null && isFinite(rel[idx])) ? rel[idx] : idx / fs;
      t[i] = t0 + sec * 1000;
    }
    return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, times: t, n: cons.feet.length,
             refIdx: refIdx, kept33: cons.kept33, kept22: cons.kept22, dropped: cons.nDropped };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  the coupling / PAT computation
  // ─────────────────────────────────────────────────────────────────────────
  function coupledPAT(rTimes, fTimes) {
    // 1. raw nearest-foot-AFTER-each-R lag (no physiological clamp → a real clock offset shows up)
    var lags = [], lagAtR = [];
    var j = 0, nf = fTimes.length;
    for (var i = 0; i < rTimes.length; i++) {
      var r = rTimes[i];
      while (j < nf && fTimes[j] < r) j++;
      // scan the few feet after r for the closest within the search window
      var k = j, bestLag = null;
      while (k < nf && (fTimes[k] - r) <= LAG_SEARCH_MS) {
        var lag = fTimes[k] - r;
        if (lag >= 0) { bestLag = lag; break; }   // first foot after R
        k++;
      }
      if (bestLag != null) { lags.push(bestLag); lagAtR.push({ t: r, lag: bestLag }); }
    }
    if (lags.length < 20) {
      return { ok: false, reason: 'Too few R→foot pairs (' + lags.length + ') — streams likely do not overlap, or detection failed.' };
    }
    // 2. night-wide central lag (reported) + a ±30 s ROLLING-LOCAL baseline. Real PAT wanders
    //    slowly over a night (vasomotion + posture + any residual clock drift), so a beat should
    //    couple to its NEIGHBOURHOOD's lag — matching every beat against one global mode wrongly
    //    penalises a legitimately drifting-but-coherent lag (the original mis-classification).
    var modal = median(lags);
    var LOCAL_WIN_MS = 30000;
    var pat = [], patAtR = [], resid = [], lo = 0, hi = 0;
    for (var m = 0; m < lagAtR.length; m++) {
      var tt0 = lagAtR[m].t;
      while (lo < lagAtR.length && lagAtR[lo].t < tt0 - LOCAL_WIN_MS) lo++;
      while (hi < lagAtR.length && lagAtR[hi].t <= tt0 + LOCAL_WIN_MS) hi++;
      var win = [];
      for (var wI = lo; wI < hi; wI++) win.push(lagAtR[wI].lag);
      var localMed = median(win);
      var d0 = lagAtR[m].lag - localMed;
      if (Math.abs(d0) <= LAG_TOL_MS) { pat.push(lagAtR[m].lag); patAtR.push(lagAtR[m]); resid.push(d0); }
    }
    var matchRate = pat.length / rTimes.length;
    var residIQR = resid.length ? (quantile(resid, 0.75) - quantile(resid, 0.25)) : NaN;
    // 4. stability — median PAT per BIN_MIN bin across the coupled beats
    var t0 = patAtR[0].t, bins = {};
    for (var p = 0; p < patAtR.length; p++) {
      var b = Math.floor((patAtR[p].t - t0) / (BIN_MIN * 60000));
      (bins[b] || (bins[b] = [])).push(patAtR[p].lag);
    }
    var binKeys = Object.keys(bins).map(Number).sort(function (a, b) { return a - b; });
    var binMed = binKeys.map(function (b) { return { min: b * BIN_MIN, med: median(bins[b]) }; });
    var medVals = binMed.map(function (x) { return x.med; });
    var driftRange = medVals.length ? (Math.max.apply(null, medVals) - Math.min.apply(null, medVals)) : NaN;
    // linear slope (ms per hour) via least squares on (min, med)
    var slope = NaN;
    if (binMed.length >= 3) {
      var n = binMed.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      binMed.forEach(function (d) { sx += d.min; sy += d.med; sxx += d.min * d.min; sxy += d.min * d.med; });
      var den = (n * sxx - sx * sx) || 1e-9;
      slope = ((n * sxy - sx * sy) / den) * 60;   // ms per 60 min
    }
    return {
      ok: true,
      modal: modal, patAtR: patAtR, pat: pat,
      med: median(pat), p25: quantile(pat, 0.25), p75: quantile(pat, 0.75),
      matchRate: matchRate, nCoupled: pat.length, residIQR: residIQR,
      binMed: binMed, driftRange: driftRange, slope: slope,
      inPhysPct: pat.filter(function (v) { return v >= PHYS_LO && v <= PHYS_HI; }).length / pat.length
    };
  }

  function overlap(ecg, ppg) {
    var s = Math.max(ecg.t0Ms, ppg.t0Ms);
    var e = Math.min(ecg.t0Ms + ecg.durSec * 1000, ppg.t0Ms + ppg.durSec * 1000);
    return { start: s, end: e, min: (e - s) / 60000 };
  }

  // Whether the two files are ONE simultaneous session on ONE phone clock — decided by HARD
  // evidence (start-time alignment + beat-count parity), NOT the PAT match rate. This is what
  // lets the verdict tell "different phone" apart from "same phone, lag drifts".
  function sharedClock(ecg, ppg) {
    var dT0 = Math.abs(ecg.t0Ms - ppg.t0Ms);
    var beatRatio = Math.abs(ecg.n - ppg.n) / Math.max(ecg.n, ppg.n, 1);
    return { dT0: dT0, beatRatio: beatRatio, ok: dT0 <= 5000 && beatRatio <= 0.12 };
  }

  function verdict(ov, cp, sc) {
    if (ov.min <= 0) return { tier: 'no', label: 'NO OVERLAP', why: 'The two recordings do not share a wall-clock window — pick a simultaneous ECG + PPG night (same phone, same time).' };
    if (!cp.ok) return { tier: 'no', label: 'NOT COUPLED', why: cp.reason };
    // "Same clock?" is decided by start alignment + beat-count parity, NOT the lag match rate.
    if (!sc.ok) {
      return { tier: 'no', label: 'NOT SIMULTANEOUS', why: 'Start times differ by ' + (sc.dT0 / 1000).toFixed(1) + ' s and beat counts by ' + (sc.beatRatio * 100).toFixed(0) + '% — these are not one shared-clock session. Re-capture BOTH sensors in ONE Polar Sensor Logger session.' };
    }
    var tightBeat = isFinite(cp.residIQR) && cp.residIQR <= 60;      // beat-to-beat coupling is coherent
    var goodMatch = cp.matchRate >= 0.55;                            // vs the LOCAL baseline now
    var physical  = cp.med >= 60 && cp.med <= 700;
    var driftMs   = isFinite(cp.driftRange) ? cp.driftRange : Infinity;
    var ppm       = ov.min > 0 ? driftMs / (ov.min * 60000) * 1e6 : NaN;   // inter-device clock drift rate
    var xSignal   = driftMs / Math.max(cp.residIQR || 1, 1);               // drift as a multiple of the beat-to-beat signal
    if (goodMatch && tightBeat && physical && driftMs <= 60) {
      return { tier: 'go', label: 'FEASIBLE — provisional trend', why: 'Shared clock confirmed; beats couple to a tight, near-flat lag (median ' + cp.med.toFixed(0) + ' ms, beat-to-beat IQR ' + cp.residIQR.toFixed(0) + ' ms, drift ' + driftMs.toFixed(0) + ' ms). PAT variation is recoverable — ship as "Vascular (trend only)", experimental tier, never an absolute BP.' };
    }
    // Beats couple locally, but the baseline swing dwarfs the PAT signal → drift, not vasculature.
    if (goodMatch && tightBeat && driftMs > 250) {
      return { tier: 'no', label: 'DRIFT-DOMINATED — needs hardware sync', why: 'Shared session confirmed and beats couple locally (' + (cp.matchRate * 100).toFixed(0) + '%, beat-to-beat IQR ' + cp.residIQR.toFixed(0) + ' ms), BUT the R→foot lag baseline swings ' + driftMs.toFixed(0) + ' ms across the night — ~' + xSignal.toFixed(0) + '× the physiological PAT signal and approaching a full cardiac cycle. That is the two DEVICE clocks drifting ~' + (isFinite(ppm) ? ppm.toFixed(0) : '?') + ' ppm apart: the phone timestamp only pins the START to ~1 s, then each stream rides its own device crystal, and where the drift crosses an RR the pairing slides onto the adjacent beat. Absolute PAT is impossible and even a relative trend is swamped. NOT viable from Polar Sensor Logger phone timestamps — needs hardware sync (Polar SDK device sensor-timestamps, or a periodic tap artifact shared across both ACC streams). See POLAR-SDK-CAPTURE-2026-07-07-BRIEF.' };
    }
    if (tightBeat && physical) {
      return { tier: 'maybe', label: 'PROMISING — drift-limited', why: 'Shared clock confirmed and beats couple coherently (beat-to-beat IQR ' + cp.residIQR.toFixed(0) + ' ms, median lag ' + cp.med.toFixed(0) + ' ms), but the lag baseline wanders ' + driftMs.toFixed(0) + ' ms across the night (~' + (isFinite(ppm) ? ppm.toFixed(0) : '?') + ' ppm inter-device drift). Usable as a LOCAL-baseline relative trend only — and slow clock drift cannot be separated from real vasomotion without a BP cuff. This is the honest ceiling for wearable PAT.' };
    }
    return { tier: 'maybe', label: 'WEAK COUPLING', why: 'Same session/clock, but only ' + (cp.matchRate * 100).toFixed(0) + '% of R-peaks find a coherent foot (beat-to-beat IQR ' + (isFinite(cp.residIQR) ? cp.residIQR.toFixed(0) : '?') + ' ms) — PPG foot detection is too noisy on this night (motion / perfusion). Tighten PPG SQI gating or try a cleaner night before trusting a trend.' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  rendering
  // ─────────────────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function DPR() { return Math.min(2, window.devicePixelRatio || 1); }
  function prep(cv) {
    var d = DPR(), w = cv.clientWidth || cv.width, h = cv.height;
    cv.width = w * d; cv.height = h * d;
    var ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  var C = { bg: '#0f141b', grid: 'rgba(255,255,255,.07)', ink: '#e6edf6', mut: '#6f8096',
            teal: '#3DE0D0', blue: '#58A6FF', amber: '#FFB84D', red: '#FF6B7A', green: '#39D98A' };

  function drawScatter(cp) {
    var cv = el('scatter'); if (!cv) return;
    var g = prep(cv), ctx = g.ctx, w = g.w, h = g.h, pad = 42;
    if (!cp || !cp.ok) { ctx.fillStyle = C.mut; ctx.font = '12px monospace'; ctx.fillText('run to populate', pad, h / 2); return; }
    var pts = cp.patAtR, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var ymin = Math.max(0, cp.med - 200), ymax = cp.med + 200;
    var X = function (t) { return pad + (t - t0) / (t1 - t0 || 1) * (w - pad - 12); };
    var Y = function (v) { return h - pad - (v - ymin) / (ymax - ymin || 1) * (h - pad - 14); };
    // grid + axes
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.mut; ctx.font = '10px monospace'; ctx.lineWidth = 1;
    for (var gy = 0; gy <= 4; gy++) { var v = ymin + (ymax - ymin) * gy / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 12, y); ctx.stroke(); ctx.fillText(v.toFixed(0), 6, y + 3); }
    ctx.fillText('PAT (ms) vs time of night', pad, 12);
    // physiological band
    ctx.fillStyle = 'rgba(57,217,138,.07)'; ctx.fillRect(pad, Y(PHYS_HI), w - pad - 12, Y(PHYS_LO) - Y(PHYS_HI));
    // points
    ctx.fillStyle = 'rgba(88,166,255,.5)';
    for (var i = 0; i < pts.length; i++) { ctx.beginPath(); ctx.arc(X(pts[i].t), Y(pts[i].lag), 1.4, 0, 6.283); ctx.fill(); }
    // binned median line
    ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.beginPath();
    cp.binMed.forEach(function (b, i) { var x = X(t0 + b.min * 60000), y = Y(b.med); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    // median reference
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad, Y(cp.med)); ctx.lineTo(w - 12, Y(cp.med)); ctx.stroke(); ctx.setLineDash([]);
  }

  function drawHist(cp) {
    var cv = el('hist'); if (!cv) return;
    var g = prep(cv), ctx = g.ctx, w = g.w, h = g.h, pad = 30;
    if (!cp || !cp.ok) { ctx.fillStyle = C.mut; ctx.font = '12px monospace'; ctx.fillText('run to populate', pad, h / 2); return; }
    var lo = Math.max(0, cp.med - 200), hi = cp.med + 200, nb = 40, bins = new Array(nb).fill(0);
    cp.pat.forEach(function (v) { var b = Math.floor((v - lo) / (hi - lo) * nb); if (b >= 0 && b < nb) bins[b]++; });
    var mx = Math.max.apply(null, bins) || 1;
    ctx.fillStyle = C.mut; ctx.font = '10px monospace'; ctx.fillText('PAT distribution (ms)', pad, 12);
    var bw = (w - pad - 12) / nb;
    for (var i = 0; i < nb; i++) {
      var bh = bins[i] / mx * (h - pad - 16), x = pad + i * bw, y = h - pad - bh;
      var c = lo + (i + .5) / nb * (hi - lo);
      ctx.fillStyle = (c >= PHYS_LO && c <= PHYS_HI) ? C.green : C.blue;
      ctx.globalAlpha = .8; ctx.fillRect(x, y, bw - 1, bh); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = C.mut; ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - 12, h - pad); ctx.stroke();
    ctx.fillStyle = C.mut; ctx.fillText(lo.toFixed(0), pad, h - pad + 12); ctx.fillText(hi.toFixed(0), w - 40, h - pad + 12);
  }

  function hcard(label, val, unit, sub, tone) {
    return '<div class="hcard"><div class="hl" style="color:' + (tone || C.ink) + '">' + val +
      (unit ? ' <span class="hu">' + unit + '</span>' : '') + '</div><div class="hk">' + label + '</div>' +
      (sub ? '<div class="hs">' + sub + '</div>' : '') + '</div>';
  }

  function render() {
    var r = state.result; if (!r) return;
    var ov = r.ov, cp = r.cp, vd = r.vd, sc = r.sc;
    // verdict banner
    var vc = el('verdict'); var toneMap = { go: C.green, maybe: C.amber, no: C.red };
    vc.className = 'verdict ' + vd.tier;
    vc.innerHTML = '<div class="vlabel" style="color:' + toneMap[vd.tier] + '">' + vd.label + '</div><div class="vwhy">' + vd.why + '</div>';
    // headline cards
    var cards = [];
    cards.push(hcard('wall-clock overlap', ov.min > 0 ? ov.min.toFixed(0) : '0', 'min', fmtClock(ov.start) + ' → ' + fmtClock(ov.end), ov.min > 0 ? C.ink : C.red));
    cards.push(hcard('shared clock', sc.ok ? 'YES' : 'NO', '', 'Δstart ' + (sc.dT0 / 1000).toFixed(1) + ' s · beats ' + (sc.beatRatio * 100).toFixed(1) + '% apart', sc.ok ? C.green : C.red));
    if (cp.ok) {
      cards.push(hcard('beats coupled', (cp.matchRate * 100).toFixed(0), '%', cp.nCoupled + ' of ' + state.ecg.n + ' R-peaks (vs local baseline)', cp.matchRate >= 0.55 ? C.green : C.amber));
      cards.push(hcard('beat-to-beat spread', isFinite(cp.residIQR) ? cp.residIQR.toFixed(0) : '—', 'ms', 'lag IQR vs ±30 s local baseline', (cp.residIQR <= 60 ? C.green : C.amber)));
      cards.push(hcard('median PAT lag', cp.med.toFixed(0), 'ms', 'IQR ' + cp.p25.toFixed(0) + '–' + cp.p75.toFixed(0) + ' ms', C.blue));
      cards.push(hcard('lag drift over night', isFinite(cp.driftRange) ? cp.driftRange.toFixed(0) : '—', 'ms', (isFinite(cp.slope) ? (cp.slope >= 0 ? '+' : '') + cp.slope.toFixed(0) + ' ms/h slope' : ''), (cp.driftRange <= 60 ? C.green : C.amber)));
    }
    el('headline').innerHTML = cards.join('');
    // provenance line
    el('prov').innerHTML =
      'ECG <b>' + fmtDate(state.ecg.t0Ms) + ' ' + fmtClock(state.ecg.t0Ms) + '</b> · ' + state.ecg.n + ' R-peaks @ ' + state.ecg.fs + ' Hz · ' + (state.ecg.durSec / 60).toFixed(0) + ' min' +
      ' &nbsp;|&nbsp; PPG <b>' + fmtDate(state.ppg.t0Ms) + ' ' + fmtClock(state.ppg.t0Ms) + '</b> · ' + state.ppg.n + ' feet (3-LED consensus, ' + state.ppg.kept33 + ' × 3/3) @ ' + state.ppg.fs + ' Hz · ' + (state.ppg.durSec / 60).toFixed(0) + ' min';
    drawScatter(cp); drawHist(cp);
    el('dlBtn').disabled = false;
  }

  function setStatus(txt, cls) { var p = el('status'); p.textContent = txt; p.className = 'pill ' + (cls || 'idle'); }

  function run() {
    if (!state.ecgFile || !state.ppgFile) { setStatus('load both files first', 'idle'); return; }
    setStatus('reading files…', 'run');
    el('dlBtn').disabled = true;
    Promise.all([readText(state.ecgFile), readText(state.ppgFile)]).then(function (texts) {
      setStatus('detecting beats… (this freezes the tab for a few s on a full night)', 'run');
      // yield so the status paints before the heavy synchronous DSP
      setTimeout(function () {
        try {
          state.ecg = ecgRpeakTimes(texts[0]);
          state.ppg = ppgFootTimes(texts[1]);
          var ov = overlap(state.ecg, state.ppg);
          var cp = coupledPAT(state.ecg.times, state.ppg.times);
          var sc = sharedClock(state.ecg, state.ppg);
          var vd = verdict(ov, cp, sc);
          state.result = { ov: ov, cp: cp, vd: vd, sc: sc };
          render();
          setStatus('done · ' + vd.label, vd.tier === 'go' ? 'done' : (vd.tier === 'maybe' ? 'run' : 'idle'));
        } catch (e) {
          setStatus('error: ' + (e && e.message || e), 'idle');
          el('verdict').className = 'verdict no';
          el('verdict').innerHTML = '<div class="vlabel" style="color:' + C.red + '">ERROR</div><div class="vwhy">' + (e && e.message || e) + '</div>';
        }
      }, 30);
    }).catch(function (e) { setStatus('error: ' + (e && e.message || e), 'idle'); });
  }

  function downloadJSON() {
    var r = state.result; if (!r) return;
    var out = {
      generated: new Date().toISOString(),
      ecg: { start: fmtDate(state.ecg.t0Ms) + 'T' + fmtClock(state.ecg.t0Ms), fs: state.ecg.fs, rPeaks: state.ecg.n, durMin: +(state.ecg.durSec / 60).toFixed(1) },
      ppg: { start: fmtDate(state.ppg.t0Ms) + 'T' + fmtClock(state.ppg.t0Ms), fs: state.ppg.fs, feet: state.ppg.n, durMin: +(state.ppg.durSec / 60).toFixed(1) },
      overlapMin: +r.ov.min.toFixed(1),
      sharedClock: { ok: r.sc.ok, startDeltaSec: +(r.sc.dT0 / 1000).toFixed(2), beatCountDiffPct: +(r.sc.beatRatio * 100).toFixed(2) },
      coupling: r.cp.ok ? {
        matchRatePct: +(r.cp.matchRate * 100).toFixed(1), nCoupled: r.cp.nCoupled,
        medianPATms: +r.cp.med.toFixed(1), iqrMs: [+r.cp.p25.toFixed(1), +r.cp.p75.toFixed(1)],
        beatToBeatIQRms: +(+r.cp.residIQR).toFixed(1),
        driftRangeMs: +(+r.cp.driftRange).toFixed(1), slopeMsPerHour: +(+r.cp.slope).toFixed(1),
        inPhysBandPct: +(r.cp.inPhysPct * 100).toFixed(1),
        binMedians: r.cp.binMed.map(function (b) { return { min: b.min, patMs: +b.med.toFixed(1) }; })
      } : { ok: false, reason: r.cp.reason },
      verdict: { tier: r.vd.tier, label: r.vd.label, why: r.vd.why }
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'pat-feasibility-' + fmtDate(state.ecg.t0Ms) + '.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ── wiring ──
  function pick(inputId, labelId, key) {
    var inp = el(inputId);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (f) { state[key] = f; el(labelId).textContent = f.name; el(labelId).classList.add('set'); }
    });
  }
  window.addEventListener('DOMContentLoaded', function () {
    pick('ecgFile', 'ecgName', 'ecgFile');
    pick('ppgFile', 'ppgName', 'ppgFile');
    el('run').addEventListener('click', run);
    el('dlBtn').addEventListener('click', downloadJSON);
    // surface missing-DSP early
    var miss = [];
    if (typeof ECGDSP === 'undefined' || !ECGDSP.parseECG) miss.push('ECGDSP');
    if (typeof PPGDSP === 'undefined' || !PPGDSP.parsePPG) miss.push('PPGDSP');
    if (miss.length) setStatus('modules missing: ' + miss.join(', ') + ' — serve over http://', 'idle');
  });
})();
