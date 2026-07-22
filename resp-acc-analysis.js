/*
 * resp-acc-analysis.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * Figure/table-generating apparatus for three papers:
 *   · papers/cpap-flow-reference.html   — CPAP flow as a home reference standard
 *   · papers/acc-respiratory-rate.html  — respiratory rate from a Polar H10 chest ACC
 *   · papers/effort-typing-null.html    — effort does not type apneas under CPAP
 *
 * THE METHOD
 *   1. REFERENCE. ResMed `*_BRP.edf` `Flow.40ms` (25 Hz, L/s) → inspiratory onsets by
 *      positive-going zero crossings of leak/drift-corrected flow (2nd-order HP 0.05 Hz,
 *      4th-order LP 3 Hz, zero-phase, 1.0 s refractory). Per-epoch rate = 60/median(period)
 *      over a 60 s window with >=4 breaths.
 *   2. VALIDATE THE REFERENCE FIRST. Two independent flow-derived estimators —
 *      60/median(period) vs a plain breath count — are compared to each other. Their
 *      disagreement IS the reference's noise floor (~0.70 br/min on this corpus). No
 *      algorithm scored below it is honestly "better"; it is overfitting or an easier subset.
 *   3. CLOCK. The wearable and the CPAP share no clock. The offset is recovered by
 *      cross-correlating the band-passed ACC against band-passed flow over +/-90 min at 1 s,
 *      three chunks voting. Offsets are then fitted across nights as a LINEAR DRIFT, and each
 *      night's lock is validated against that model — NOT against correlation magnitude. On
 *      this corpus four nights with |r| < 0.25 landed within 3.2 s of prediction; a
 *      correlation gate would have discarded them, non-randomly.
 *   4. ESTIMATOR. Runs the SHIPPED `MOTIONDSP.respiratoryRate` — not a reimplementation, so
 *      this tool regenerates the papers' numbers from the code that actually ships.
 *   5. STATS. Bias/MAE/RMSE/95% LoA/within-2-3 br/min/Pearson r, the error-vs-coverage curve,
 *      and night-level bootstrap CIs. The bias constant is applied LEAVE-ONE-NIGHT-OUT so no
 *      reported figure is fitted on its own test data.
 *
 * 100% local. Nothing is uploaded. Unbundled analysis surface — touches neither gate.
 */
(function (global) {
  'use strict';

  var FS_REF = 25; // Hz — ResMed Flow.40ms
  var EPOCH = 30,
    WIN = 60; // s — scoring grid (matches the estimator's hop/window)
  var FSC = 5; // Hz — common grid for clock cross-correlation

  // ─────────────────────────── EDF / EDF+ ────────────────────────────────
  function s8(buf, off, len) {
    var s = '';
    for (var i = 0; i < len; i++) s += String.fromCharCode(buf[off + i]);
    return s.replace(/\0/g, ' ').trim();
  }

  /* Minimal EDF reader — enough for ResMed BRP/PLD/SA2. Returns physical-scaled signals. */
  function readEDF(bytes, wanted) {
    var nbytesHdr = parseInt(s8(bytes, 184, 8), 10);
    var nrec = parseInt(s8(bytes, 236, 8), 10);
    var recdur = parseFloat(s8(bytes, 244, 8));
    var ns = parseInt(s8(bytes, 252, 4), 10);
    if (!isFinite(ns) || ns <= 0 || !isFinite(nrec)) return null;
    var sd = s8(bytes, 168, 8),
      st = s8(bytes, 176, 8);
    var dp = sd.split('.'),
      tp = st.split('.');
    var yy = parseInt(dp[2], 10);
    var year = yy < 85 ? 2000 + yy : 1900 + yy;
    // Clock Contract §1 — floating wall-clock ms, built with Date.UTC from components as written.
    var startMs = Date.UTC(year, parseInt(dp[1], 10) - 1, parseInt(dp[0], 10), parseInt(tp[0], 10), parseInt(tp[1], 10), parseInt(tp[2], 10));
    var p = 256;
    function take(n) {
      var out = [];
      for (var i = 0; i < ns; i++) out.push(s8(bytes, p + i * n, n));
      p += n * ns;
      return out;
    }
    var labels = take(16);
    take(80);
    var units = take(8);
    var pmin = take(8).map(parseFloat);
    var pmax = take(8).map(parseFloat);
    var dmin = take(8).map(parseFloat);
    var dmax = take(8).map(parseFloat);
    take(80);
    var nsamp = take(8).map(function (v) {
      return parseInt(v, 10);
    });
    var recLen = nsamp.reduce(function (a, b) {
      return a + b;
    }, 0);
    var avail = Math.floor((bytes.length - nbytesHdr) / (recLen * 2));
    if (avail < nrec) nrec = avail; // truncated file — keep whole records only
    var dv = new DataView(bytes.buffer, bytes.byteOffset + nbytesHdr);
    var out = {};
    for (var si = 0; si < ns; si++) {
      if (wanted && wanted.indexOf(labels[si]) < 0) continue;
      var n = nsamp[si],
        off = 0,
        k;
      for (k = 0; k < si; k++) off += nsamp[k];
      var arr = new Float64Array(nrec * n);
      var span = dmax[si] - dmin[si] || 1;
      var gain = (pmax[si] - pmin[si]) / span;
      for (var r = 0; r < nrec; r++) {
        var base = (r * recLen + off) * 2;
        for (k = 0; k < n; k++) arr[r * n + k] = (dv.getInt16(base + k * 2, true) - dmin[si]) * gain + pmin[si];
      }
      out[labels[si]] = { fs: n / recdur, data: arr, unit: units[si] };
    }
    return { startMs: startMs, durSec: nrec * recdur, signals: out, labels: labels };
  }

  /* EDF+ annotation (TAL) parse — the `*_EVE.edf` scored-event list. A plain EDF reader
     divides by a zero record duration and throws, so this is deliberately separate. */
  function readAnnotations(bytes) {
    var nbytesHdr = parseInt(s8(bytes, 184, 8), 10);
    var sd = s8(bytes, 168, 8),
      st = s8(bytes, 176, 8);
    var dp = sd.split('.'),
      tp = st.split('.');
    var yy = parseInt(dp[2], 10);
    var startMs = Date.UTC(yy < 85 ? 2000 + yy : 1900 + yy, parseInt(dp[1], 10) - 1, parseInt(dp[0], 10), parseInt(tp[0], 10), parseInt(tp[1], 10), parseInt(tp[2], 10));
    var txt = '';
    for (var i = nbytesHdr; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]);
    var ev = [],
      re = /([+-]\d+(?:\.\d+)?)(?:\x15(\d+(?:\.\d+)?))?\x14([^\x14\x00]*)/g,
      m;
    while ((m = re.exec(txt)) !== null) {
      var lab = (m[3] || '').trim();
      if (!lab) continue;
      ev.push({ onsetSec: parseFloat(m[1]), durSec: m[2] ? parseFloat(m[2]) : 0, label: lab });
    }
    return { startMs: startMs, events: ev };
  }

  // ───────────────────────── filters (zero-phase) ─────────────────────────
  function butterSOS(order, fc, fs, type) {
    var w = Math.tan((Math.PI * fc) / fs),
      sos = [],
      k;
    for (k = 0; k < order >> 1; k++) {
      var th = (Math.PI * (2 * k + 1)) / (2 * order);
      var sinT = 2 * Math.sin(th) || 1e-9;
      var al = w * sinT,
        d = 1 + al + w * w,
        b0,
        b1,
        b2;
      if (type === 'low') {
        b0 = (w * w) / d;
        b1 = 2 * b0;
        b2 = b0;
      } else {
        b0 = 1 / d;
        b1 = -2 * b0;
        b2 = b0;
      }
      sos.push([b0, b1, b2, 1, (2 * (w * w - 1)) / d, (1 - al + w * w) / d]);
    }
    return sos;
  }
  function sosfilt(x, sos) {
    var n = x.length,
      out = new Float64Array(n),
      i,
      s;
    for (i = 0; i < n; i++) out[i] = x[i];
    for (s = 0; s < sos.length; s++) {
      var b0 = sos[s][0],
        b1 = sos[s][1],
        b2 = sos[s][2],
        a1 = sos[s][4],
        a2 = sos[s][5];
      var z1 = 0,
        z2 = 0;
      for (i = 0; i < n; i++) {
        var xi = out[i],
          y = b0 * xi + z1;
        z1 = b1 * xi - a1 * y + z2;
        z2 = b2 * xi - a2 * y;
        out[i] = y;
      }
    }
    return out;
  }
  function rev(a) {
    var n = a.length,
      o = new Float64Array(n);
    for (var i = 0; i < n; i++) o[i] = a[n - 1 - i];
    return o;
  }
  function filtfilt(x, sos) {
    if (x.length < 8) return Float64Array.from(x);
    return rev(sosfilt(rev(sosfilt(x, sos)), sos));
  }

  // ───────────────────── reference: breaths from CPAP flow ─────────────────
  function detectBreaths(flow, fs) {
    var f = filtfilt(filtfilt(flow, butterSOS(2, 0.05, fs, 'high')), butterSOS(4, 3.0, fs, 'low'));
    var on = [],
      last = -1e9;
    for (var i = 1; i < f.length; i++) {
      if (f[i - 1] <= 0 && f[i] > 0) {
        var t = i / fs;
        if (t - last >= 1.0) {
          on.push(t);
          last = t;
        }
      }
    }
    return on;
  }

  function median(a) {
    if (!a.length) return NaN;
    var b = Array.prototype.slice.call(a).sort(function (x, y) {
      return x - y;
    });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }

  /* Per-epoch reference rate by BOTH estimators. Their disagreement is the noise floor. */
  function referenceEpochs(flow, fs, epoch, win) {
    var on = detectBreaths(flow, fs);
    var per = [],
      mid = [],
      i;
    for (i = 1; i < on.length; i++) {
      per.push(on[i] - on[i - 1]);
      mid.push((on[i] + on[i - 1]) / 2);
    }
    var dur = flow.length / fs,
      nE = Math.floor(dur / epoch);
    var t = [],
      rrMed = [],
      rrCnt = [];
    for (var e = 0; e < nE; e++) {
      var c = (e + 0.5) * epoch,
        a = c - win / 2,
        b = c + win / 2;
      var sel = [];
      for (i = 0; i < mid.length; i++) if (mid[i] >= a && mid[i] < b) sel.push(per[i]);
      t.push(e * epoch);
      if (sel.length >= 4) {
        rrMed.push(60 / median(sel));
        rrCnt.push(sel.length * (60 / win));
      } else {
        rrMed.push(NaN);
        rrCnt.push(NaN);
      }
    }
    return { t: t, rrMedian: rrMed, rrCount: rrCnt, nBreaths: on.length, periods: per };
  }

  /* ───────────────────────── clock: offset + drift ─────────────────────────
     Resample onto an EXACT FSC grid by interpolation — do NOT decimate by an integer
     factor. The CPAP flow is exactly 25 Hz (q=5 → exactly 5 Hz) but the Polar ACC runs
     ~25.35 Hz, so integer decimation would leave it at 5.07 Hz. Over a 22-minute
     correlation chunk that 1.4% rate error accumulates ~18 s of skew, which smears the
     correlation peak and moves the recovered offset by tens of minutes. Measured while
     porting this tool: integer decimation returned locks of −3296/−4718/−4238 s on three
     nights whose true, drift-consistent offsets are −2362/−2365/−2353 s. */
  function toGrid(x, fsIn) {
    var f = filtfilt(x, butterSOS(6, 0.8 * (FSC / 2), fsIn, 'low'));
    var dur = (f.length - 1) / fsIn;
    var n = Math.floor(dur * FSC) + 1;
    var o = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var pos = (i / FSC) * fsIn,
        j = Math.floor(pos),
        u = pos - j;
      if (j >= f.length - 1) {
        o[i] = f[f.length - 1];
        continue;
      }
      o[i] = f[j] * (1 - u) + f[j + 1] * u;
    }
    return o;
  }
  /* Native sample rate — from the Polar SENSOR NANOSECOND counter (`relNs`) when present,
     falling back to the phone millisecond stamp only if it is not.

     This is not a micro-optimisation. The phone stamp is quantised to whole milliseconds, so
     on a 25.34 Hz stream (true spacing 39.47 ms) the median inter-sample interval reads 39 ms
     → 25.64 Hz, a **1.2% rate error**. Cross-correlating a 25-minute chunk against the CPAP
     flow then accumulates ~18 s of skew, which flattens the correlation peak and moves the
     recovered clock offset by tens of minutes. Measured while porting this tool: with the
     tMs-derived rate the locks came back −1592/−3379/+4852 s on three nights whose true,
     drift-consistent offsets are −2362/−2365/−2353 s.

     Never derive the rate from count ÷ duration either — that silently absorbs every dropout. */
  function nativeHz(rows) {
    var d = [],
      i,
      n = Math.min(rows.length, 4000);
    if (rows[0] && rows[0].relNs != null) {
      for (i = 1; i < n; i++) {
        var dn = Number(rows[i].relNs - rows[i - 1].relNs);
        if (dn > 0) d.push(dn);
      }
      if (d.length) return 1e9 / median(d);
    }
    for (i = 1; i < n; i++) {
      var dt = rows[i].tMs - rows[i - 1].tMs;
      if (dt > 0) d.push(dt);
    }
    if (!d.length) return NaN;
    return 1000 / median(d);
  }

  /* Project the three band-passed axes onto their dominant direction (power iteration on
     the 3x3 covariance). Matches the reference implementation's PC1 — a single fixed axis
     under-reads the lock because the respiratory component is spread across axes. */
  function dominantProjection(ch) {
    var n = ch[0].length,
      i,
      a,
      b;
    var mu = [0, 0, 0];
    for (a = 0; a < 3; a++) {
      for (i = 0; i < n; i++) mu[a] += ch[a][i];
      mu[a] /= n;
    }
    var C = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (i = 0; i < n; i++) {
      for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) C[a][b] += (ch[a][i] - mu[a]) * (ch[b][i] - mu[b]);
    }
    for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) C[a][b] /= Math.max(1, n - 1);
    var v = [1, 1, 1];
    for (var it = 0; it < 60; it++) {
      var w = [0, 0, 0];
      for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) w[a] += C[a][b] * v[b];
      var nn = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
      if (nn < 1e-18) break;
      v = [w[0] / nn, w[1] / nn, w[2] / nn];
    }
    var out = new Float64Array(n);
    for (i = 0; i < n; i++) out[i] = (ch[0][i] - mu[0]) * v[0] + (ch[1][i] - mu[1]) * v[1] + (ch[2][i] - mu[2]) * v[2];
    return out;
  }

  /* THE respiratory channel for clock recovery:each axis onto the exact FSC grid, band-passed
     0.13-0.50 Hz zero-phase, then projected onto the dominant direction. One function so the
     tool and any caller cannot disagree about filter order or double-filtering. */
  function respChannel(rows) {
    var hz = nativeHz(rows);
    if (!isFinite(hz) || hz <= 0) return null;
    var lo = butterSOS(4, 0.5, FSC, 'low'),
      hi = butterSOS(4, 0.13, FSC, 'high');
    var keys = ['x', 'y', 'z'],
      ch = [];
    for (var a = 0; a < 3; a++) {
      var v = new Float64Array(rows.length);
      for (var i = 0; i < rows.length; i++) v[i] = rows[i][keys[a]];
      ch.push(filtfilt(filtfilt(toGrid(v, hz), lo), hi));
    }
    return { channel: dominantProjection(ch), hz: hz };
  }
  function flowChannel(flow, fsIn) {
    return filtfilt(filtfilt(toGrid(flow, fsIn), butterSOS(4, 0.5, FSC, 'low')), butterSOS(4, 0.13, FSC, 'high'));
  }

  function zscore(x, i0, n) {
    var mu = 0,
      i;
    for (i = 0; i < n; i++) mu += x[i0 + i];
    mu /= n;
    var sd = 0;
    for (i = 0; i < n; i++) {
      var v = x[i0 + i] - mu;
      sd += v * v;
    }
    sd = Math.sqrt(sd / n);
    if (sd < 1e-12) return null;
    var o = new Float64Array(n);
    for (i = 0; i < n; i++) o[i] = (x[i0 + i] - mu) / sd;
    return o;
  }

  /* Cross-correlate a band-passed ACC channel against band-passed flow. Returns the lag (s)
     to ADD to ACC-relative time to reach CPAP-session time, plus the peak |r| and a sharpness
     ratio (peak / p95) — a true lock is a narrow spike, a spurious one a broad ridge. */
  function recoverOffset(accCh, accT0Sec, flowGrid, searchMin, chunkMin) {
    // INPUT CONTRACT: accCh and flowGrid are ALREADY band-passed onto the FSC grid (use
    // respChannel / flowChannel). Filtering here as well silently double-filters the ACC to
    // an effective 16th order and degrades the lock — measured while porting this tool.
    var acc = accCh;
    var nCh = Math.round(chunkMin * 60 * FSC);
    var votes = [];
    var fracs = [0.25, 0.45, 0.65];
    for (var fi = 0; fi < fracs.length; fi++) {
      var st = Math.floor(acc.length * fracs[fi]);
      if (st + nCh > acc.length) continue;
      var a = zscore(acc, st, nCh);
      if (!a) continue;
      var base = accT0Sec + st / FSC;
      var best = { r: 0, off: null },
        all = [];
      for (var off = -searchMin * 60; off <= searchMin * 60; off += 1) {
        var i0 = Math.round((base + off) * FSC);
        if (i0 < 0 || i0 + nCh > flowGrid.length) continue;
        var b = zscore(flowGrid, i0, nCh);
        if (!b) continue;
        var dot = 0;
        for (var k = 0; k < nCh; k++) dot += a[k] * b[k];
        var r = Math.abs(dot / nCh);
        all.push(r);
        if (r > best.r) {
          best.r = r;
          best.off = off;
        }
      }
      if (best.off !== null && all.length > 20) {
        all.sort(function (x, y) {
          return x - y;
        });
        var p95 = all[Math.floor(0.95 * all.length)] || 1e-9;
        votes.push({ off: best.off, r: best.r, sharp: best.r / p95 });
      }
    }
    if (!votes.length) return null;
    votes.sort(function (x, y) {
      return y.r - x.r;
    });
    return votes[0];
  }

  /* Weighted least-squares drift fit across nights. Validity is |recovered - predicted| < tol,
     NOT |r| > threshold — see the method note at the top of this file. */
  function fitDrift(nights, minR) {
    var X = [],
      Y = [],
      W = [];
    for (var i = 0; i < nights.length; i++) {
      var n = nights[i];
      if (!n.lock || n.lock.r < minR) continue;
      X.push(n.dayNum);
      Y.push(n.lock.off);
      W.push(n.lock.r);
    }
    if (X.length < 3) return null;
    var x0 = 0,
      sw = 0,
      i2;
    for (i2 = 0; i2 < X.length; i2++) {
      x0 += X[i2] * W[i2];
      sw += W[i2];
    }
    x0 /= sw;
    var sxx = 0,
      sxy = 0,
      sy = 0;
    for (i2 = 0; i2 < X.length; i2++) {
      var dx = X[i2] - x0;
      sxx += W[i2] * dx * dx;
      sxy += W[i2] * dx * Y[i2];
      sy += W[i2] * Y[i2];
    }
    var slope = sxx > 0 ? sxy / sxx : 0,
      intercept = sy / sw;
    var resid = [];
    for (i2 = 0; i2 < X.length; i2++) resid.push(Y[i2] - (slope * (X[i2] - x0) + intercept));
    var mu = 0;
    for (i2 = 0; i2 < resid.length; i2++) mu += resid[i2];
    mu /= resid.length;
    var sd = 0,
      mx = 0;
    for (i2 = 0; i2 < resid.length; i2++) {
      sd += (resid[i2] - mu) * (resid[i2] - mu);
      mx = Math.max(mx, Math.abs(resid[i2]));
    }
    return {
      slopePerDay: slope,
      x0: x0,
      intercept: intercept,
      residSD: Math.sqrt(sd / Math.max(1, resid.length - 1)),
      residMax: mx,
      n: X.length,
      predict: function (dayNum) {
        return slope * (dayNum - x0) + intercept;
      }
    };
  }

  // ─────────────────────────────── statistics ──────────────────────────────
  function agreement(pred, ref) {
    var d = [],
      i;
    for (i = 0; i < pred.length; i++) {
      if (isFinite(pred[i]) && isFinite(ref[i])) d.push(pred[i] - ref[i]);
    }
    if (d.length < 10) return null;
    var n = d.length,
      sum = 0;
    for (i = 0; i < n; i++) sum += d[i];
    var bias = sum / n,
      ss = 0,
      abs = 0,
      w1 = 0,
      w2 = 0,
      w3 = 0;
    for (i = 0; i < n; i++) {
      ss += (d[i] - bias) * (d[i] - bias);
      abs += Math.abs(d[i]);
      if (Math.abs(d[i]) <= 1) w1++;
      if (Math.abs(d[i]) <= 2) w2++;
      if (Math.abs(d[i]) <= 3) w3++;
    }
    var sd = Math.sqrt(ss / Math.max(1, n - 1));
    var rmse = 0;
    for (i = 0; i < n; i++) rmse += d[i] * d[i];
    return {
      n: n,
      bias: bias,
      mae: abs / n,
      rmse: Math.sqrt(rmse / n),
      loa: 1.96 * sd,
      within1: w1 / n,
      within2: w2 / n,
      within3: w3 / n
    };
  }

  function pearson(a, b) {
    var xs = [],
      ys = [],
      i;
    for (i = 0; i < a.length; i++) {
      if (isFinite(a[i]) && isFinite(b[i])) {
        xs.push(a[i]);
        ys.push(b[i]);
      }
    }
    if (xs.length < 4) return NaN;
    var mx = 0,
      my = 0,
      n = xs.length;
    for (i = 0; i < n; i++) {
      mx += xs[i];
      my += ys[i];
    }
    mx /= n;
    my /= n;
    var sxy = 0,
      sxx = 0,
      syy = 0;
    for (i = 0; i < n; i++) {
      var dx = xs[i] - mx,
        dy = ys[i] - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  /* Night-level bootstrap CI — resample NIGHTS, not epochs, so the CI reflects
     between-night variability rather than pretending 19k epochs are independent. */
  function bootstrapCI(perNight, stat, iters, seed) {
    var s = seed || 12345;
    function rnd() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    }
    var vals = [],
      K = perNight.length;
    for (var it = 0; it < (iters || 2000); it++) {
      var pool = [];
      for (var k = 0; k < K; k++) pool.push(perNight[Math.floor(rnd() * K)]);
      var v = stat(pool);
      if (isFinite(v)) vals.push(v);
    }
    if (vals.length < 20) return null;
    vals.sort(function (x, y) {
      return x - y;
    });
    return [vals[Math.floor(0.025 * vals.length)], vals[Math.floor(0.975 * vals.length)]];
  }

  /* Leave-one-night-out bias correction — the reported error is never fitted on its own
     test night. This is what makes the papers' MAE honest rather than self-referential. */
  function looBias(perNight) {
    var out = [];
    for (var i = 0; i < perNight.length; i++) {
      var pool = [];
      for (var j = 0; j < perNight.length; j++) {
        if (j === i) continue;
        for (var k = 0; k < perNight[j].pred.length; k++) {
          var p = perNight[j].pred[k],
            r = perNight[j].ref[k];
          if (isFinite(p) && isFinite(r)) pool.push(p - r);
        }
      }
      var b = pool.length ? median(pool) : 0;
      var pred2 = [];
      for (var m = 0; m < perNight[i].pred.length; m++) pred2.push(perNight[i].pred[m] - b);
      out.push({ name: perNight[i].name, pred: pred2, ref: perNight[i].ref, conf: perNight[i].conf, bias: b });
    }
    return out;
  }

  function coverageCurve(perNight, fracs) {
    var all = [];
    for (var i = 0; i < perNight.length; i++) {
      for (var k = 0; k < perNight[i].pred.length; k++) {
        var p = perNight[i].pred[k],
          r = perNight[i].ref[k],
          c = perNight[i].conf[k];
        if (isFinite(p) && isFinite(r)) all.push({ d: p - r, c: c, p: p, r: r });
      }
    }
    all.sort(function (a, b) {
      return b.c - a.c;
    });
    var rows = [];
    for (var f = 0; f < fracs.length; f++) {
      var keep = Math.max(10, Math.floor(fracs[f] * all.length));
      var sub = all.slice(0, keep);
      var pred = sub.map(function (x) {
          return x.p;
        }),
        ref = sub.map(function (x) {
          return x.r;
        });
      var ag = agreement(pred, ref);
      if (ag) rows.push({ coverage: keep / all.length, confMin: sub[keep - 1].c, mae: ag.mae, rmse: ag.rmse, loa: ag.loa, within2: ag.within2, r: pearson(pred, ref) });
    }
    return rows;
  }

  global.RespAccAnalysis = {
    readEDF: readEDF,
    readAnnotations: readAnnotations,
    detectBreaths: detectBreaths,
    referenceEpochs: referenceEpochs,
    recoverOffset: recoverOffset,
    fitDrift: fitDrift,
    toGrid: toGrid,
    nativeHz: nativeHz,
    respChannel: respChannel,
    flowChannel: flowChannel,
    dominantProjection: dominantProjection,
    agreement: agreement,
    pearson: pearson,
    bootstrapCI: bootstrapCI,
    looBias: looBias,
    coverageCurve: coverageCurve,
    median: median,
    butterSOS: butterSOS,
    filtfilt: filtfilt,
    _const: { FS_REF: FS_REF, EPOCH: EPOCH, WIN: WIN, FSC: FSC }
  };
})(typeof window !== 'undefined' ? window : this);
