/*
 * sensor-trio-worker.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Web-Worker realm for sensor-trio-power-analysis. Runs the trio Monte-Carlo
 * OFF the main thread so a heavy run (many trials) neither freezes the tab nor
 * blocks the UI — the house pool pattern (cohort-worker.js / hrv-confound).
 *
 * The generator + TCH kernel here are byte-identical to the main analysis
 * module; the worker is fed cfg (winSec, ar1) per job and SEEDS PER TRIAL with a
 * deterministic mix, so the sharded result is independent of pool size and bit-
 * reproducible (a trial's draws depend only on regime, N and the trial index).
 *
 * Jobs:
 *   {type:'init'}                                   → {type:'ready'}
 *   {type:'job', kind:'cell', regime, rho, N,
 *      t0, count, winSec, ar1, reqId}               → {type:'done', reqId,
 *        med:{o2[],h10[],verity[]}, negCount, negTot}
 *   {type:'job', kind:'rho', ri, rho, t0, count,
 *      winSec, ar1, reqId}                          → {type:'done', reqId, neg, count}
 */
'use strict';

// ── PRODUCTION detectors: load the REAL PpgDex DSP so the Verity HR corner uses the
//    same validated, gate-tested beat detector the app + papers use (3-LED consensus
//    systolic feet → buildPPI → Malik correctRR), not a hand-rolled approximation.
//    Load order: kernel-constants (DexKernel) → clock (DexClock.parseTimestamp) →
//    ppgdex-dsp. DOM-free by the DSP-purity gate, so it runs in a worker. If it can't
//    load, the compact Pan–Tompkins fallback below still works. ──
var HAVE_PPGDSP = false, HAVE_ECGDSP = false;
if (typeof window === 'undefined') { self.window = self; }   // window→self shim: the production DSP wrapper references `window` at load; a worker has none
try { importScripts('kernel-constants.js', 'clock.js', 'ppgdex-dsp.js', 'ecgdex-dsp.js'); HAVE_ECGDSP = (typeof ECGDSP !== 'undefined' && ECGDSP && typeof ECGDSP.parseECG === 'function' && typeof ECGDSP.bandpass === 'function' && typeof ECGDSP.detectPeaks === 'function'); HAVE_PPGDSP = (typeof PPGDSP !== 'undefined' && PPGDSP && typeof PPGDSP.parsePPG === 'function' && typeof PPGDSP.consensusBeats === 'function' && typeof PPGDSP.detectChannel === 'function' && typeof PPGDSP.buildPPI === 'function' && typeof PPGDSP.correctRR === 'function'); } catch (e) { HAVE_PPGDSP = false; }

// ── RNG (seeded, deterministic — identical to the main module) ─────────────
var _s = 0x9e3779b9 >>> 0;
function seed(v) { _s = (v >>> 0) || 1; }
function rnd() { _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; }
function gauss() { var u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// per-trial seed mix: a trial's randomness depends only on (stream, N, t) so the
// sweep is reproducible regardless of how trials are sharded across workers.
// stream: 1=dynamic, 2=resting, 3+ri=ρ-sweep leg ri.
function trialSeed(stream, N, t) {
  var h = (Math.imul(stream + 1, 0x9E3779B1) ^ Math.imul(N + 1, 0x85EBCA77) ^ Math.imul(t + 1, 0xC2B2AE3D)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D); h ^= h >>> 13; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
  return h >>> 0;
}

// ── stats ──────────────────────────────────────────────────────────────────
function variance(a) { var n = a.length, m = 0, i; for (i = 0; i < n; i++) m += a[i]; m /= n; var s = 0; for (i = 0; i < n; i++) { var d = a[i] - m; s += d * d; } return s / (n - 1); }
function median(a) { var s = Array.prototype.slice.call(a).sort(function (p, q) { return p - q; }), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }

// ── device truth (planted) — identical decomposition to the main module ────
var SD_H_REST = 1.35, SD_H_DYN = 0.30;
var DEV = {
  o2:     { resp: 0.45, sigmaRest: 2.72 },
  h10:    { resp: 1.00, sigmaRest: 1.86 },
  verity: { resp: 1.00, sigmaRest: 1.94 },   // planted at the raw-ECG 10-night broad hat (2.72/1.86/1.94) — MUST match sensor-trio-power-analysis.js DEV
};
for (var _k in DEV) {
  var _d = DEV[_k], _sh = _d.resp * SD_H_REST;
  _d.sigma0 = Math.sqrt(Math.max(0.04, _d.sigmaRest * _d.sigmaRest - _sh * _sh));
  var _sd = _d.resp * SD_H_DYN;
  _d.sigmaDyn = Math.sqrt(_sd * _sd + _d.sigma0 * _d.sigma0);
}
var DKEYS = ['o2', 'h10', 'verity'];

// ── synthetic trio window generator (byte-identical to the main module) ────
function genWindow(regime, rho, ar, n) {
  var dyn = regime === 'dynamic';
  var sdH = dyn ? SD_H_DYN : SD_H_REST * (0.45 + 1.15 * rnd());
  var trend = new Float64Array(n);
  var base = 52 + rnd() * 14, i;
  if (dyn) {
    var peak = 35 + rnd() * 25, tPk = n * (0.3 + rnd() * 0.25), up = tPk, dn = n - tPk;
    for (i = 0; i < n; i++) trend[i] = base + (i < tPk ? peak * (i / up) : peak * Math.exp(-(i - tPk) / (dn * 0.55)));
  } else {
    var d = 0, k = 0.0008;
    for (i = 0; i < n; i++) { d += -k * d + 0.22 * gauss(); trend[i] = base + d; }
  }
  var h = new Float64Array(n), hp = 0;
  for (i = 0; i < n; i++) { hp = ar * hp + Math.sqrt(1 - ar * ar) * gauss(); h[i] = sdH * hp; }
  var c = new Float64Array(n);
  if (rho > 0) { var cp = 0; for (i = 0; i < n; i++) { cp = ar * cp + Math.sqrt(1 - ar * ar) * gauss(); c[i] = cp; } }
  var out = {};
  for (var ki = 0; ki < DKEYS.length; ki++) {
    var key = DKEYS[ki], dd = DEV[key], a = new Float64Array(n), np = 0;
    var corr = (key === 'h10' || key === 'verity') ? rho : 0;
    var sInd = dd.sigma0 * Math.sqrt(1 - corr), sCor = dd.sigma0 * Math.sqrt(corr);
    for (i = 0; i < n; i++) {
      np = ar * np + Math.sqrt(1 - ar * ar) * gauss();
      a[i] = trend[i] + dd.resp * h[i] + sInd * np + sCor * c[i];
    }
    out[key] = a;
  }
  return out;
}

// ── TCH kernel (identical to the method paper / main module) ───────────────
function threeCorneredHat(vAB, vAC, vBC) { return { a: 0.5 * (vAB + vAC - vBC), b: 0.5 * (vAB + vBC - vAC), c: 0.5 * (vAC + vBC - vAB) }; }
function tchSigmas(hh, vv, oo) {
  var dHV = [], dHO = [], dVO = [];
  for (var i = 0; i < hh.length; i++) { dHV.push(hh[i] - vv[i]); dHO.push(hh[i] - oo[i]); dVO.push(vv[i] - oo[i]); }
  var cv = threeCorneredHat(variance(dHV), variance(dHO), variance(dVO));
  return {
    h10: cv.a > 0 ? Math.sqrt(cv.a) : null,
    verity: cv.b > 0 ? Math.sqrt(cv.b) : null,
    o2: cv.c > 0 ? Math.sqrt(cv.c) : null,
    neg: cv.a <= 0 || cv.b <= 0 || cv.c <= 0,
  };
}

// ── job handlers ───────────────────────────────────────────────────────────
function runCell(regime, rho, N, t0, count, ar, n, stream) {
  var med = { o2: [], h10: [], verity: [] },
      negCount = { o2: 0, h10: 0, verity: 0 },
      negTot = { o2: 0, h10: 0, verity: 0 };
  for (var t = 0; t < count; t++) {
    seed(trialSeed(stream, N, t0 + t));
    var per = { o2: [], h10: [], verity: [] };
    for (var w = 0; w < N; w++) {
      var win = genWindow(regime, rho, ar, n);
      var s = tchSigmas(win.h10, win.verity, win.o2);
      for (var ki = 0; ki < DKEYS.length; ki++) {
        var k = DKEYS[ki]; negTot[k]++;
        if (s[k] != null) per[k].push(s[k]); else negCount[k]++;
      }
    }
    for (var kj = 0; kj < DKEYS.length; kj++) { var kk = DKEYS[kj]; if (per[kk].length) med[kk].push(median(per[kk])); }
  }
  return { med: med, negCount: negCount, negTot: negTot };
}

// ════════════════════════════════════════════════════════════════════════
//  REAL-NIGHT ARM (folder ingestion) — parse a night's trio → per-second HR →
//  TCH σ + block-bootstrap CI, entirely in-worker (off the UI). Verity HR from
//  the device _PPI when present, else a compact beat-rate extraction from the
//  raw _PPG waveform. Clock-Contract parsing (regex → floating ms; never
//  new Date(str)); read back with UTC by construction (we only bin to seconds).
// ════════════════════════════════════════════════════════════════════════
var HR_MIN = 30, HR_MAX = 220;
function isoMs(s) { var m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +((m[7] + '00').slice(0, 3)) : 0) : null; }
function o2Ms(s) { var m = /(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(s); return m ? Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1], +m[2], +m[3]) : null; }
function secFloor(t) { return Math.floor(t / 1000); }
function pct(a, p) { return a[Math.max(0, Math.min(a.length - 1, Math.floor(p * (a.length - 1))))]; }
/* Classify WHY a Verity night failed the quality gate — pure, so it is gate-testable (see
   tests/dex-tests.js "Verity gate classifies the FAILURE"). Harmonic doubling is a SCALED COPY of
   truth: the median HR ratio against the paired ECG corner sits near an exact multiple (1.6-2.9 on the
   doubled nights vs 0.99-1.01 clean -- bimodal, no overlap). Lost contact derives HR from noise, which
   lands near no multiple at all. Thresholds are deliberately WIDE of the observed bands: doubling is a
   detector fault we want to catch loudly, and a false "detector" verdict costs a look, whereas a false
   "sensor" verdict cost us 41% of the corpus for weeks. */
function verityFailureClass(hrRatio) {
  if (hrRatio == null || !isFinite(hrRatio)) return 'poor-contact';
  if (hrRatio >= 1.5 && hrRatio <= 3.0) return 'harmonic-double';
  if (hrRatio >= 0.33 && hrRatio <= 0.67) return 'harmonic-half';
  return 'poor-contact';
}
function pearson(x, y) { var n = x.length, mx = 0, my = 0, i; for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n; var sxy = 0, sx = 0, sy = 0; for (i = 0; i < n; i++) { var dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; } return (sx > 0 && sy > 0) ? sxy / Math.sqrt(sx * sy) : null; }
// collapse [sec,val] pairs → Map(sec → median), robust to multi-sample seconds
function medMap(pairs) { var by = new Map(), i; for (i = 0; i < pairs.length; i++) { var s = pairs[i][0], a = by.get(s); if (!a) { a = []; by.set(s, a); } a.push(pairs[i][1]); } var out = new Map(); by.forEach(function (a, s) { a.sort(function (p, q) { return p - q; }); out.set(s, a[a.length >> 1]); }); return out; }
function o2PulseMap(text) { var L = text.split(/\r?\n/), p = [], i; for (i = 1; i < L.length; i++) { if (!L[i]) continue; var c = L[i].split(','); var t = o2Ms(c[0]); if (t == null) continue; var hr = +c[2]; if (hr >= HR_MIN && hr <= HR_MAX) p.push([secFloor(t), hr]); } return p.length ? medMap(p) : null; }
function h10HrMap(text) { var L = text.split(/\r?\n/), p = [], i; for (i = 1; i < L.length; i++) { if (!L[i]) continue; var c = L[i].split(';'); var t = isoMs(c[0]); if (t == null) continue; var hr = +c[1]; if (hr >= HR_MIN && hr <= HR_MAX) p.push([secFloor(t), hr]); } return p.length ? medMap(p) : null; }
function ppiHrMap(text) { var L = text.split(/\r?\n/), p = [], i; for (i = 1; i < L.length; i++) { if (!L[i]) continue; var c = L[i].split(';'); var t = isoMs(c[0]); if (t == null) continue; var ppi = +c[1], blk = +c[3]; if (!(ppi > 0)) continue; if (isFinite(blk) && blk !== 0) continue; var hr = 60000 / ppi; if (hr >= HR_MIN && hr <= HR_MAX) p.push([secFloor(t), hr]); } return p.length >= 30 ? medMap(p) : null; }
// compact raw-PPG → per-second HR (bandpass + adaptive peak pick → PPI). Decimated
// to ~64 Hz (pulse < 4 Hz, so Nyquist is ample) to bound memory/time on a full night.
function movavg(a, w) { var o = new Float64Array(a.length), s = 0, i; for (i = 0; i < a.length; i++) { s += a[i]; if (i >= w) s -= a[i - w]; o[i] = s / Math.min(i + 1, w); } return o; }
function movrms(a, w) { var o = new Float64Array(a.length), s = 0, i; for (i = 0; i < a.length; i++) { s += a[i] * a[i]; if (i >= w) s -= a[i - w] * a[i - w]; o[i] = Math.sqrt(s / Math.min(i + 1, w)); } return o; }
// ── raw-PPG → per-second HR via a Pan–Tompkins pipeline ADAPTED for PPG ──────
// Best-SNR green channel → band-pass (baseline-wander removal + upstroke smooth)
// → 5-point derivative → squaring → moving-window integration → adaptive DUAL-
// threshold detection (running SPKI/NPKI, refractory, RR-searchback) → per-beat
// amplitude SQI + Malik ectopy rejection → per-second median HR → rolling-median
// spike cleanup. Returns null (skip the night) when quality/coverage is too low
// rather than emitting a noisy series that would inflate the TCH σ.
function ppgHrMap(text) {
  var L = text.split(/\r?\n/); if (L.length < 200) return null;
  var t0 = null, t1 = null, cnt = 0, i;
  for (i = 1; i < L.length && cnt < 400; i++) { if (!L[i]) continue; var t = isoMs(L[i].split(';')[0]); if (t == null) continue; if (t0 == null) t0 = t; t1 = t; cnt++; }
  if (t0 == null || t1 == null || t1 <= t0) return null;
  var fs = cnt / ((t1 - t0) / 1000); if (!(fs > 10 && fs < 1000)) fs = 135;
  var k = Math.max(1, Math.round(fs / 64)), fsD = fs / k;
  // choose the best-SNR green channel (highest pulsatile-band power) on a probe
  var probe = [[], [], []], pc = 0, kk = 0;
  for (i = 1; i < L.length && pc < 4000; i++) { var ln = L[i]; if (!ln) continue; if ((kk++ % k)) continue; var c = ln.split(';'); if (c.length < 5) continue; probe[0].push(+c[2]); probe[1].push(+c[3]); probe[2].push(+c[4]); pc++; }
  function pulsatility(a) { if (a.length < 32) return -1; var b = movavg(a, Math.max(3, Math.round(fsD * 1.2))), m = 0, v = 0, j; for (j = 0; j < a.length; j++) m += a[j] - b[j]; m /= a.length; for (j = 0; j < a.length; j++) { var z = a[j] - b[j] - m; v += z * z; } return v / a.length; }
  var chBest = 0, best = -1; for (var ch = 0; ch < 3; ch++) { var pv = pulsatility(probe[ch]); if (pv > best) { best = pv; chBest = ch; } }
  var col = 2 + chBest;
  var tArr = [], sArr = []; kk = 0;
  for (i = 1; i < L.length; i++) { var ln = L[i]; if (!ln) continue; if ((kk++ % k)) continue; var c = ln.split(';'); if (c.length <= col) continue; var t = isoMs(c[0]); if (t == null) continue; var v = +c[col]; if (!isFinite(v)) continue; tArr.push(t); sArr.push(v); }
  var n = sArr.length; if (n < 128) return null;
  // 1. band-pass: baseline-wander removal (long MA) then upstroke smooth (short MA)
  var base = movavg(sArr, Math.max(3, Math.round(fsD * 1.5))), bp = new Float64Array(n);
  for (i = 0; i < n; i++) bp[i] = sArr[i] - base[i];
  var sm = movavg(bp, Math.max(1, Math.round(fsD * 0.05)));
  // 2. 5-point derivative (upstroke emphasis)  3. square  4. moving-window integrate (~150 ms)
  var der = new Float64Array(n);
  for (i = 2; i < n - 2; i++) der[i] = (2 * sm[i + 1] + sm[i + 2] - sm[i - 2] - 2 * sm[i - 1]) * (fsD / 8);
  var sq = new Float64Array(n); for (i = 0; i < n; i++) sq[i] = der[i] * der[i];
  var mwi = movavg(sq, Math.max(2, Math.round(fsD * 0.15)));
  // 5. adaptive dual-threshold detection with refractory + RR-searchback
  var refr = Math.max(1, Math.round(fsD * 0.30));           // 200 bpm ceiling
  var init = Math.min(n, Math.round(fsD * 2)), mx = 0, mnSum = 0;
  for (i = 0; i < init; i++) { if (mwi[i] > mx) mx = mwi[i]; mnSum += mwi[i]; }
  var SPKI = 0.25 * mx, NPKI = 0.5 * (mnSum / Math.max(1, init)), THR1 = NPKI + 0.25 * (SPKI - NPKI);
  var peaks = [], rrAvg = Math.round(fsD * 0.9), lastPk = -refr;
  function localMax(j) { return mwi[j] >= mwi[j - 1] && mwi[j] > mwi[j + 1]; }
  for (i = 1; i < n - 1; i++) {
    if (localMax(i)) {
      var peak = mwi[i];
      if (peak > THR1 && (i - lastPk) >= refr) {
        peaks.push(i); SPKI = 0.125 * peak + 0.875 * SPKI; lastPk = i;
        if (peaks.length >= 2) { var rr = peaks[peaks.length - 1] - peaks[peaks.length - 2]; if (rr > 0.5 * fsD && rr < 2.5 * fsD) rrAvg = Math.round(0.75 * rrAvg + 0.25 * rr); }
      } else NPKI = 0.125 * peak + 0.875 * NPKI;
      THR1 = NPKI + 0.25 * (SPKI - NPKI);
    }
    // searchback: overdue beat (>1.66×RR) → rescan the gap at half threshold
    if (peaks.length >= 1 && (i - lastPk) > Math.round(1.66 * rrAvg)) {
      var THR2 = 0.5 * THR1, bi = -1, bv = THR2;
      for (var j = lastPk + refr; j < i; j++) { if (j > 1 && j < n - 1 && localMax(j) && mwi[j] > bv) { bv = mwi[j]; bi = j; } }
      if (bi > 0) { peaks.push(bi); SPKI = 0.25 * mwi[bi] + 0.75 * SPKI; lastPk = bi; }
    }
  }
  if (peaks.length < 20) return null;
  // 6. per-beat systolic amplitude (peak-to-trough of the band-passed signal) → SQI
  var sysAmp = [];
  for (var p = 0; p < peaks.length; p++) { var cc = peaks[p], a0 = Math.max(0, cc - refr), a1 = Math.min(n - 1, cc + refr), hi = -1e18, lo = 1e18, j; for (j = a0; j <= a1; j++) { if (sm[j] > hi) hi = sm[j]; if (sm[j] < lo) lo = sm[j]; } sysAmp.push(hi - lo); }
  var ampMed = median(sysAmp.slice()) || 1;
  // 7. PPI series with amplitude-SQI + Malik ectopy rejection → per-second HR
  var accepted = [], pairsSec = [];
  for (p = 1; p < peaks.length; p++) {
    var dtMs = tArr[peaks[p]] - tArr[peaks[p - 1]]; if (dtMs <= 0) continue;
    var hr = 60000 / dtMs; if (!(hr >= HR_MIN && hr <= HR_MAX)) continue;
    var aq = sysAmp[p] / ampMed; if (aq < 0.35 || aq > 3.0) continue;                 // motion/artifact beat
    if (accepted.length >= 3) { var lm = median(accepted.slice(-8)); if (Math.abs(dtMs - lm) / lm > 0.30) continue; }  // Malik ectopy
    accepted.push(dtMs); pairsSec.push([secFloor(tArr[peaks[p]]), hr]);
  }
  if (pairsSec.length < 30) return null;
  var perSec = medMap(pairsSec);
  // 8. rolling-median (±2 s) spike cleanup — drop any second > 25 bpm off its local median
  var secs = Array.from(perSec.keys()).sort(function (a, b) { return a - b; }), vals = secs.map(function (s) { return perSec.get(s); }), out = new Map();
  for (var idx = 0; idx < secs.length; idx++) { var w = vals.slice(Math.max(0, idx - 2), Math.min(vals.length, idx + 3)).sort(function (a, b) { return a - b; }), med = w[w.length >> 1]; if (Math.abs(vals[idx] - med) <= 25) out.set(secs[idx], vals[idx]); }
  return out.size >= 30 ? out : null;
}
// within-window block bootstrap CI of one real window's σ̂ (30-sample blocks)
function blockCI(hh, vv, oo, B) {
  var n = hh.length, bl = Math.min(n, 30), nb = Math.ceil(n / bl), acc = { h10: [], verity: [], o2: [] }, b, kk, j;
  for (b = 0; b < B; b++) { var H = [], V = [], O = []; for (kk = 0; kk < nb; kk++) { var st = Math.floor(rnd() * (n - bl + 1)); for (j = 0; j < bl; j++) { H.push(hh[st + j]); V.push(vv[st + j]); O.push(oo[st + j]); } } var s = tchSigmas(H, V, O); for (var di = 0; di < DKEYS.length; di++) { var d = DKEYS[di]; if (s[d] != null) acc[d].push(s[d]); } }
  var out = {}; for (var di = 0; di < DKEYS.length; di++) { var d = DKEYS[di]; var a = acc[d].sort(function (p, q) { return p - q; }); out[d] = a.length >= 20 ? { lo: pct(a, 0.025), hi: pct(a, 0.975) } : null; } return out;
}
// PRODUCTION Verity HR — raw PPG → real PpgDex detector (parsePPG → 3-LED consensus
// feet → buildPPI → Malik correctRR) → per-second HR on the absolute floating-ms grid.
// PRODUCTION H10 HR — raw ECG → ECGDSP Pan–Tompkins QRS (parseECG → bandpass → detectPeaks)
// → RR → per-second HR on the absolute floating-ms grid. The paper's "gold leg" (the H10
// corner the whole three-cornered-hat method rests on) — not the device onboard HR.
function ecgHrMap(text, onPhase) {
  self.__ecgErr = null;
  try {
    if (onPhase) onPhase('parsing ECG');
    var rec = ECGDSP.parseECG(text);
    if (!rec || !rec.int16 || !rec.int16.length || !rec.fs) { self.__ecgErr = 'parseECG empty'; return null; }
    if (onPhase) onPhase('QRS (Pan–Tompkins)');
    var bp = ECGDSP.bandpass(rec.int16, rec.fs);
    var peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
    if (!peaks || peaks.length < 20) { self.__ecgErr = 'QRS <20 peaks'; return null; }
    var fs = rec.fs, t0 = rec.t0Ms || 0, pairs = [], i;
    for (i = 1; i < peaks.length; i++) { var rr = (peaks[i] - peaks[i - 1]) / fs * 1000; if (!(rr > 250 && rr < 2200)) continue; var hr = 60000 / rr; if (!(hr >= HR_MIN && hr <= HR_MAX)) continue; pairs.push([secFloor(t0 + peaks[i] / fs * 1000), hr]); }
    if (pairs.length < 30) { self.__ecgErr = 'HR beats <30'; return null; }
    var perSec = medMap(pairs);
    var secs = Array.from(perSec.keys()).sort(function (a, b) { return a - b; }), vals = secs.map(function (s) { return perSec.get(s); }), out = new Map();
    for (var j = 0; j < secs.length; j++) { var win = vals.slice(Math.max(0, j - 2), Math.min(vals.length, j + 3)).sort(function (a, b) { return a - b; }), med = win[win.length >> 1]; if (Math.abs(vals[j] - med) <= 20) out.set(secs[j], vals[j]); }
    if (out.size < 30) { self.__ecgErr = 'post-clean <30'; return null; }
    return out;
  } catch (e) { self.__ecgErr = (e && e.message) || ('' + e); return null; }
}
function ppgHrMapReal(text, onPhase) {
  self.__ppgErr = null;
  try {
    if (onPhase) onPhase('parsing PPG');
    var rec = PPGDSP.parsePPG(text);
    if (!rec || !rec.ch || !rec.ch.length || !rec.n) { self.__ppgErr = 'parsePPG empty'; return null; }
    var perCh = [];
    for (var ci = 0; ci < rec.ch.length; ci++) { if (onPhase) onPhase('beat-detect LED ' + (ci + 1) + '/' + rec.ch.length); perCh.push(PPGDSP.detectChannel(rec.ch[ci], rec.fs)); }
    var sel = 0, best = -1;
    for (ci = 0; ci < perCh.length; ci++) { var bpw = perCh[ci] && perCh[ci].bp; if (!bpw || !bpw.length) continue; var st = Math.max(1, Math.floor(bpw.length / 40000)), m = 0, v = 0, cnt = 0, kk; for (kk = 0; kk < bpw.length; kk += st) { m += bpw[kk]; cnt++; } m /= (cnt || 1); for (kk = 0; kk < bpw.length; kk += st) { var z = bpw[kk] - m; v += z * z; } v /= (cnt || 1); if (v > best) { best = v; sel = ci; } }
    if (onPhase) onPhase('3-LED consensus');
    var cons = PPGDSP.consensusBeats(perCh, sel, rec.fs);
    if (!cons || !cons.feet || cons.feet.length < 20) { self.__ppgErr = 'consensus <20 feet'; return null; }
    var n = rec.n, footSec = cons.feet.map(function (f) { var i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), fr = f - i0; return rec.relSec[i0] * (1 - fr) + rec.relSec[i1] * fr; });
    if (onPhase) onPhase('PPI + Malik correction');
    var b = PPGDSP.buildPPI(footSec); if (!b || !b.rr || b.rr.length < 20) { self.__ppgErr = 'buildPPI <20'; return null; }
    var corr = PPGDSP.correctRR(b.rr, b.tt), nn = corr.nn, tt = b.tt, fl = corr.flags || [], t0 = rec.t0Ms || 0, pairs = [], i;
    for (i = 0; i < nn.length; i++) { if (fl[i]) continue; var hr = 60000 / nn[i]; if (!(hr >= HR_MIN && hr <= HR_MAX)) continue; pairs.push([secFloor(t0 + tt[i] * 1000), hr]); }
    if (pairs.length < 30) { self.__ppgErr = 'HR beats <30'; return null; }
    var perSec = medMap(pairs);
    // rolling-median (\u00b12 s) spike cleanup \u2014 drop any second > 20 bpm off its local median (motion/artifact)
    var secs = Array.from(perSec.keys()).sort(function (a, b) { return a - b; }), vals = secs.map(function (s) { return perSec.get(s); }), out = new Map();
    for (var j = 0; j < secs.length; j++) { var win = vals.slice(Math.max(0, j - 2), Math.min(vals.length, j + 3)).sort(function (a, b) { return a - b; }), med = win[win.length >> 1]; if (Math.abs(vals[j] - med) <= 20) out.set(secs[j], vals[j]); }
    if (out.size < 30) { self.__ppgErr = 'post-clean <30'; return null; }
    return out;
  } catch (e) { self.__ppgErr = (e && e.message) || ('' + e); return null; }
}
async function runRealNight(m) {
  var pg = function (ph) { self.postMessage({ type: 'progress', reqId: m.reqId, label: m.label, phase: ph }); };
  try {
    var f = m.files;
    pg('reading device files');
    var O = o2PulseMap(await f.o2.text());
    var H = null, hsrc = null;
    if (f.h10ecg && HAVE_ECGDSP) { H = ecgHrMap(await f.h10ecg.text(), pg); if (H) hsrc = 'ecg·PanTompkins'; }
    if (!H && f.h10) { H = h10HrMap(await f.h10.text()); if (H) hsrc = 'device-hr'; }
    var V = null, src = null;
    if (f.verityPPI) { V = ppiHrMap(await f.verityPPI.text()); if (V) src = 'ppi'; }
    if (!V && f.verityPPG) { var _tx = await f.verityPPG.text(); if (HAVE_PPGDSP) { V = ppgHrMapReal(_tx, pg); if (V) src = 'ppg·PPGDSP'; } if (!V) { pg('PT fallback'); V = ppgHrMap(_tx); if (V) src = 'ppg·PT' + (HAVE_PPGDSP ? '[' + (self.__ppgErr || '?') + ']' : ''); } }
    if (!V && f.verityHR) { V = h10HrMap(await f.verityHR.text()); if (V) src = 'device-hr'; }
    if (!O || !H || !V) return { skip: true, reason: 'no ' + (!O ? 'O2 ' : '') + (!H ? 'H10 ' : '') + (!V ? 'Verity-HR' : '') };
    pg('aligning + solving TCH');
    var ks = []; H.forEach(function (_, s) { if (O.has(s) && V.has(s)) ks.push(s); }); ks.sort(function (a, b) { return a - b; });
    if (ks.length < 1000) return { skip: true, reason: ks.length + ' s overlap < 1000' };
    var hh = [], vv = [], oo = [], i; for (i = 0; i < ks.length; i++) { hh.push(H.get(ks[i])); vv.push(V.get(ks[i])); oo.push(O.get(ks[i])); }
    var s = tchSigmas(hh, vv, oo);
    var rHV = pearson(hh, vv), rHO = pearson(hh, oo), rVO = pearson(vv, oo);
    // Verity quality gate: an optical HR whose recovered σ exceeds ~12 bpm (far past any plausible
    // wrist-PPG error) AND decorrelates from BOTH other corners is failed HR extraction (lost PPG
    // contact / all-night motion), not a real device σ. Skip it honestly rather than let a 20–35 bpm
    // artifact pollute the aggregate. A merely-restful night (low r but small, plausible σ) is kept.
    //
    // -- WHY a failing night is now CLASSIFIED, not merely rejected (PPGDEX-OPTICAL-DETECTOR §2) --
    // This gate used to blame the SENSOR for every failure -- "poor PPG contact". That misdiagnosis was
    // expensive: it discarded 7 of the 17 trio nights, and FIVE of them had perfectly good optical
    // signal. The fault was in OUR detector -- TERMA counted the dicrotic notch as a second beat, so the
    // optical HR read a clean 2x truth. The gate saw a wild sigma, shrugged, and wrote off 41% of the
    // corpus as a hardware problem. Nobody looked at the detector for weeks.
    //
    // The two failures ARE distinguishable, and the discriminator is cheap: harmonic doubling is a
    // SCALED COPY of truth -- the median HR ratio against the paired ECG corner sits near an exact
    // multiple (measured 1.6-2.9 on the doubled nights vs 0.99-1.01 clean: bimodal, no overlap) --
    // whereas lost contact derives HR from noise, which lands near no multiple at all. (The node-local
    // ppiCorr* rates are NOT sufficient alone: 2026-06-25 is CORRECT at 28.8% while 2026-06-29 is WRONG
    // at 30.5% -- they overlap. The cross-node ratio does not.)
    //
    // Both still SKIP -- a doubled HR is not a valid Verity sigma either way, so the published aggregate
    // is UNCHANGED by this. What changes is the VERDICT: a recurrence now says "look at the detector",
    // not "blame the strap".
    var hrRatio = median(hh) > 0 ? median(vv) / median(hh) : null;
    if (s.verity != null && s.verity > 12 && (rHV == null || rHV < 0.4) && (rVO == null || rVO < 0.4)) {
      var _sig = '\u03c3 ' + s.verity.toFixed(0) + ' bpm · rHV ' + (rHV == null ? '\u2014' : rHV.toFixed(2)) + ' · HR\u00d7' + (hrRatio == null ? '\u2014' : hrRatio.toFixed(2));
      var _fail = verityFailureClass(hrRatio);
      var _why = _fail === 'harmonic-double'
        ? 'Verity HR is a HARMONIC of truth (\u00d7' + hrRatio.toFixed(2) + ' vs ECG) \u2014 OUR DETECTOR is counting the dicrotic notch; the sensor is fine'
        : _fail === 'harmonic-half'
          ? 'Verity HR is a SUB-harmonic of truth (\u00d7' + hrRatio.toFixed(2) + ' vs ECG) \u2014 OUR DETECTOR is missing beats; the sensor is fine'
          : 'Verity HR lands near no multiple of truth \u2014 genuinely poor PPG contact / all-night motion';
      return { skip: true, failure: _fail, hrRatio: hrRatio, reason: 'Verity unreliable (' + _sig + ') \u2014 ' + _why };
    }
    seed((m.seed >>> 0) || 0x51F0);
    var ci = m.wantSeries ? null : blockCI(hh, vv, oo, 400);
    var out = { skip: false, n: ks.length, source: src, sigma: { o2: s.o2, h10: s.h10, verity: s.verity }, neg: s.neg, ci: ci, rHV: rHV, rHO: rHO, rVO: rVO, hrRatio: hrRatio };
    if (m.wantSeries) { out.hh = hh; out.vv = vv; out.oo = oo; out.keys = ks; }   // aligned per-second series for the sigma-no-reference tool (BA / control-leg / repeatability)
    return out;
  } catch (e) { return { skip: true, reason: (e && e.message) || String(e) }; }
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === 'init') { self.postMessage({ type: 'ready' }); return; }
  if (m.type === 'job' && m.kind === 'realNight') { runRealNight(m).then(function (res) { self.postMessage({ type: 'done', reqId: m.reqId, real: res }); }); return; }
  if (m.type === 'job') {
    if (m.kind === 'cell' || m.kind === 'dur') {
      var stream = m.seedStream != null ? m.seedStream : (m.regime === 'dynamic' ? 1 : 2);
      var c = runCell(m.regime, m.rho, m.N, m.t0, m.count, m.ar1, m.winSec, stream);
      self.postMessage({ type: 'done', reqId: m.reqId, med: c.med, negCount: c.negCount, negTot: c.negTot });
      return;
    }
    if (m.kind === 'rho') {
      var stream = 3 + m.ri, neg = 0;
      for (var t = 0; t < m.count; t++) {
        seed(trialSeed(stream, 0, m.t0 + t));
        var win = genWindow('resting', m.rho, m.ar1, m.winSec);
        if (tchSigmas(win.h10, win.verity, win.o2).neg) neg++;
      }
      self.postMessage({ type: 'done', reqId: m.reqId, neg: neg, count: m.count });
      return;
    }
  }
};
