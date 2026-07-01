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
  o2:     { resp: 0.45, sigmaRest: 1.7 },
  h10:    { resp: 1.00, sigmaRest: 2.2 },
  verity: { resp: 1.00, sigmaRest: 6.2 },
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

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === 'init') { self.postMessage({ type: 'ready' }); return; }
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
