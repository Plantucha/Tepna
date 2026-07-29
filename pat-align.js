/*
 * pat-align.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ANCHOR-BASED INTER-DEVICE ALIGNMENT — extracted from pat-feasibility-worker.js
 * (PAT-FEASIBILITY-2026-07-08 `estimateDriftACC`) so it can be tested, and reused.
 *
 * WHY ANCHORS. Two devices worn on one body see the same movements at the same true instant —
 * mechanically, with no pulse delay. But correlating their whole signals does NOT recover the
 * offset: as the original put it, "fixed windows drown a shared whole-body turn in decorrelated
 * background". Most of a night is each sensor's own local noise, so a whole-series correlation is
 * broad and flat. Measured while trying exactly that on the reference corpus, a respiration pairing
 * produced a best-lag margin of 0.02 over the runner-up and scattered across ±105 min.
 *
 * The fix is to spend the correlation only where there is information: detect STRONG ISOLATED
 * movements on one device, and cross-correlate a tight window around each against the other. Each
 * such anchor is an independent estimate of the offset AT THAT MOMENT, so a handful of them both
 * pins the offset and traces its drift — with no user taps and no reference clock.
 *
 * Everything here is pure: arrays in, numbers out. No DOM, no workers, no I/O.
 *
 * Exposes: window.PATAlign = { envelope, findAnchors, lagAtAnchor, alignByAnchors, DEFAULTS }
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    dtMs: 50, // envelope bin — 20 Hz is ample for body movement
    emaAlpha: 0.02, // baseline tracker; the envelope is |g - baseline|
    anchorSigma: 4, // a movement must exceed mean + 4σ to be an anchor
    anchorLocalBins: 12, // …and be the local maximum within ±this many bins
    anchorMinGapMs: 3000, // …and be ≥3 s from the previous anchor
    windowHalfMs: 1600, // half-width of the correlation window around an anchor
    maxLagMs: 1600, // ± search range around the anchor
    minCorr: 0.6, // an anchor is only used if its best correlation clears this
    minOverlapFrac: 0.85, // a lag is only scored if this much of the window is in range
    minAnchors: 2
  };

  /* Motion envelope on a fixed grid: per bin, the largest deviation of |acc| from its slow EMA
     baseline. Deviation, not raw magnitude, because gravity dominates |acc| and is posture-dependent
     — two devices on different body segments never agree on it, but they do agree on the DISTURBANCE.
     `samples` is [{tMs, x, y, z}] or [{tMs, v}] (v = an already-scalar activity measure). */
  function envelope(samples, t0, t1, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var alpha = opts.emaAlpha != null ? opts.emaAlpha : DEFAULTS.emaAlpha;
    if (!samples || samples.length < 20 || !(t1 > t0)) return null;
    var ng = Math.max(1, Math.floor((t1 - t0) / dt) + 1);
    var grid = new Float32Array(ng);
    var ema = null;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!s || s.tMs == null || !isFinite(s.tMs)) continue;
      var g = s.v != null ? s.v : Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      if (!isFinite(g)) continue;
      ema = ema == null ? g : ema + alpha * (g - ema);
      var b = Math.floor((s.tMs - t0) / dt);
      var d = Math.abs(g - ema);
      if (b >= 0 && b < ng && d > grid[b]) grid[b] = d;
    }
    return grid;
  }

  /* Bins carrying a STRONG, ISOLATED movement: above mean + kσ, a local maximum, and separated from
     the previous anchor. All three matter — the threshold alone fires repeatedly across one long
     turn, and every extra hit on the same event is a correlated vote, not an independent one. */
  function findAnchors(env, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var kSigma = opts.anchorSigma != null ? opts.anchorSigma : DEFAULTS.anchorSigma;
    var localBins = opts.anchorLocalBins != null ? opts.anchorLocalBins : DEFAULTS.anchorLocalBins;
    var minGapMs = opts.anchorMinGapMs != null ? opts.anchorMinGapMs : DEFAULTS.anchorMinGapMs;
    var half = Math.round((opts.windowHalfMs != null ? opts.windowHalfMs : DEFAULTS.windowHalfMs) / dt);
    var out = [];
    if (!env || !env.length) return out;
    var ng = env.length,
      m = 0;
    for (var i = 0; i < ng; i++) m += env[i];
    m /= ng;
    var v = 0;
    for (var i2 = 0; i2 < ng; i2++) {
      var d = env[i2] - m;
      v += d * d;
    }
    var sd = Math.sqrt(v / ng) || 1;
    var thr = m + kSigma * sd,
      last = -1e9;
    for (var c = half; c + half < ng; c++) {
      if (env[c] < thr) continue;
      var isMax = true;
      for (var k = c - localBins; k <= c + localBins; k++) {
        if (k >= 0 && k < ng && env[k] > env[c]) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      if ((c - last) * dt < minGapMs) continue;
      out.push(c);
      last = c;
    }
    return out;
  }

  /* Normalized cross-correlation of B against A over one window, with PARABOLIC sub-bin refinement:
     the true offset rarely lands on a bin centre, and fitting the three points around the peak
     recovers the fraction — which is what turns a 50 ms grid into a sub-10 ms estimate. Returns null
     when the best correlation does not clear `minCorr`, so a window without a genuinely shared event
     contributes nothing rather than a confident wrong number. */
  function lagAtAnchor(A, B, centre, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var half = Math.round((opts.windowHalfMs != null ? opts.windowHalfMs : DEFAULTS.windowHalfMs) / dt);
    var maxLag = Math.round((opts.maxLagMs != null ? opts.maxLagMs : DEFAULTS.maxLagMs) / dt);
    var lagBias = Math.round((opts.lagBiasMs != null ? opts.lagBiasMs : 0) / dt); // centre of the search
    var minCorr = opts.minCorr != null ? opts.minCorr : DEFAULTS.minCorr;
    var minOv = opts.minOverlapFrac != null ? opts.minOverlapFrac : DEFAULTS.minOverlapFrac;
    if (!A || !B) return null;
    var ng = B.length,
      s = centre - half,
      e = centre + half;
    if (s < 0 || e > A.length) return null;
    var aMean = 0;
    for (var i = s; i < e; i++) aMean += A[i];
    aMean /= e - s;
    var corrs = new Float64Array(2 * maxLag + 1);
    var best = -2,
      bestK = 0;
    for (var lag = -maxLag; lag <= maxLag; lag++) {
      var shift = lag + lagBias;
      var bMean = 0,
        cnt = 0;
      for (var i2 = s; i2 < e; i2++) {
        var j = i2 + shift;
        if (j < 0 || j >= ng) continue;
        bMean += B[j];
        cnt++;
      }
      if (cnt < (e - s) * minOv) {
        corrs[lag + maxLag] = -2;
        continue;
      }
      bMean /= cnt;
      var sa = 0,
        sb = 0,
        sab = 0;
      for (var i3 = s; i3 < e; i3++) {
        var j2 = i3 + shift;
        if (j2 < 0 || j2 >= ng) continue;
        var da = A[i3] - aMean,
          db = B[j2] - bMean;
        sa += da * da;
        sb += db * db;
        sab += da * db;
      }
      var corr = sab / (Math.sqrt(sa * sb) || 1e-9);
      corrs[lag + maxLag] = corr;
      if (corr > best) {
        best = corr;
        bestK = lag + maxLag;
      }
    }
    if (!(best > minCorr)) return null;
    var lagRef = bestK - maxLag;
    if (bestK > 0 && bestK < 2 * maxLag) {
      var y1 = corrs[bestK - 1],
        y2 = corrs[bestK],
        y3 = corrs[bestK + 1],
        den = y1 - 2 * y2 + y3;
      if (den < 0 && y1 > -2 && y3 > -2) {
        var frac = (0.5 * (y1 - y3)) / den;
        if (frac > -1 && frac < 1) lagRef += frac;
      }
    }
    return { offsetMs: (lagRef + lagBias) * dt, corr: best };
  }

  /* Full pass: envelope A's anchors → a per-anchor offset against B. The anchors ARE the result —
     their spread is the drift, their median the standing offset. */
  function alignByAnchors(envA, envB, t0, opts) {
    opts = opts || {};
    var dt = opts.dtMs != null ? opts.dtMs : DEFAULTS.dtMs;
    var minAnchors = opts.minAnchors != null ? opts.minAnchors : DEFAULTS.minAnchors;
    var minGapMs = opts.anchorMinGapMs != null ? opts.anchorMinGapMs : DEFAULTS.anchorMinGapMs;
    if (!envA || !envB) return { ok: false, reason: 'missing envelope', anchors: [] };
    /* Candidate scan and correlation run in ONE pass, and the spacing counter advances only when an
       anchor is ACCEPTED — matching the original inline implementation exactly. A candidate whose
       correlation fails therefore does not block the next one 3 s later, which is the behaviour the
       PAT feasibility numbers were validated against. (Separating the two loops looks cleaner and is
       a different algorithm: it changed the anchor count on a real 7.1 h night. An extraction has to
       preserve behaviour; improving it is a separate, deliberate change.) */
    var cand = findAnchors(envA, Object.assign({}, opts, { anchorMinGapMs: 0 })),
      anchors = [],
      lastAccepted = -1e9;
    for (var i = 0; i < cand.length; i++) {
      var c = cand[i];
      if ((c - lastAccepted) * dt < minGapMs) continue;
      var r = lagAtAnchor(envA, envB, c, opts);
      if (!r) continue;
      anchors.push({ tMs: t0 + c * dt, offsetMs: r.offsetMs, corr: r.corr });
      lastAccepted = c;
    }
    if (anchors.length < minAnchors) return { ok: false, reason: 'too few clean shared movements (' + anchors.length + ')', anchors: anchors, candidates: cand.length };
    var offs = anchors
      .map(function (a) {
        return a.offsetMs;
      })
      .sort(function (a, b) {
        return a - b;
      });
    var med = offs.length % 2 ? offs[offs.length >> 1] : (offs[(offs.length >> 1) - 1] + offs[offs.length >> 1]) / 2;
    return {
      ok: true,
      anchors: anchors,
      candidates: cand.length,
      medianOffsetMs: med,
      offsetRangeMs: offs[offs.length - 1] - offs[0],
      minOffsetMs: offs[0],
      maxOffsetMs: offs[offs.length - 1]
    };
  }

  var api = { envelope: envelope, findAnchors: findAnchors, lagAtAnchor: lagAtAnchor, alignByAnchors: alignByAnchors, DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PATAlign = api;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null);
