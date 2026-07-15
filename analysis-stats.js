/*
 * analysis-stats.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE analysis-page statistics kernels — single-sourced so the paper-figure math
 * gets a regression net (TEST-COVERAGE-ANALYSIS, 2026-07-15).
 *
 * BACKGROUND: the standalone `*-analysis.html` research tools each carried their OWN
 * private copies of the reliability / agreement / correlation / change-point kernels
 * that produce the numbers cited in the σ + validation papers. Those copies were
 * covered ONLY by the static "Analysis tools are self-contained" gate (no external
 * <script src>, no file worker) — NOTHING executed the math. A sign error in the
 * three-cornered-hat solve or a between/within swap in the ICC would have shipped a
 * plausible-but-wrong figure with every gate green.
 *
 * This module lifts those kernels VERBATIM into one place, exposes them on
 * `window.AnalysisStats`, and is exercised by the known-answer group in
 * `tests/dex-tests.js` ('Analysis-page statistics kernels — known-answer'). The
 * analysis pages now DELEGATE to it (each aliases the kernel it needs under the same
 * local name, so call sites are untouched and behavior is preserved by construction).
 *
 * INVARIANTS honored:
 *   · Pure / no-deps / no-network / no-DOM — a plain kernel library, file://-safe,
 *     inlined into each tool by tools/build-analysis.mjs like any other sibling.
 *   · Each kernel is a BYTE-FAITHFUL copy of the page variant it replaces. Where two
 *     pages genuinely differed (bare-r `pearson` vs the Fisher-CI `pearsonCI`), BOTH
 *     variants are exposed under distinct names — never silently merged.
 *   · Deterministic only. The stochastic bootstrap-CI helpers (Math.random) stay in
 *     sigma-no-reference-analysis.js; there is no known-answer for a random resample.
 */
(function (root) {
  'use strict';

  /* ── shared low-level helpers (self-contained; identical to the page variants on
        every non-empty input the kernels below ever receive) ───────────────────── */
  function mean(a) {
    return a.length
      ? a.reduce(function (x, y) {
          return x + y;
        }, 0) / a.length
      : 0;
  }
  function variance(a) {
    var m = mean(a);
    return (
      a.reduce(function (s, x) {
        return s + (x - m) * (x - m);
      }, 0) /
      (a.length - 1)
    );
  }
  function sd(a) {
    return Math.sqrt(variance(a));
  }
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) {
      return x - y;
    });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function sse(a) {
    if (a.length < 1) return 0;
    var m = mean(a),
      s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return s;
  }

  /* ══ RELIABILITY — nights-icc-analysis.js ═════════════════════════════════════ */
  // ANOVA one-way random-effects ICC(1,1) over ragged subjects.
  function iccOneWay(groups) {
    // groups: array of arrays (each subject's repeated measurements); keep subjects with ≥2 obs
    var g = groups.filter(function (a) {
      return a.length >= 2;
    });
    var k = g.length;
    if (k < 2) return null;
    var all = [];
    g.forEach(function (a) {
      a.forEach(function (v) {
        all.push(v);
      });
    });
    var N = all.length,
      grand = mean(all);
    var ssb = 0,
      ssw = 0,
      sumN2 = 0;
    g.forEach(function (a) {
      var mi = mean(a),
        ni = a.length;
      sumN2 += ni * ni;
      ssb += ni * (mi - grand) * (mi - grand);
      a.forEach(function (v) {
        ssw += (v - mi) * (v - mi);
      });
    });
    var dfb = k - 1,
      dfw = N - k;
    if (dfw <= 0) return null;
    var msb = ssb / dfb,
      msw = ssw / dfw;
    var n0 = (N - sumN2 / N) / dfb; // average group size (balanced → n per subject)
    var icc = (msb - msw) / (msb + (n0 - 1) * msw);
    icc = Math.max(0, Math.min(0.999, icc));
    var varB = Math.max(0, (msb - msw) / n0),
      varW = Math.max(0, msw);
    return {
      icc: icc,
      k: k,
      N: N,
      n0: n0,
      msb: msb,
      msw: msw,
      varB: varB,
      varW: varW,
      grand: grand,
      withinSD: Math.sqrt(varW),
      withinCVpct: grand ? (100 * Math.sqrt(varW)) / Math.abs(grand) : null,
      medianOcc: median(
        g.map(function (a) {
          return a.length;
        })
      )
    };
  }
  // Spearman–Brown: reliability of an average of m occasions.
  function spearmanBrown(icc, m) {
    return icc <= 0 ? 0 : (m * icc) / (1 + (m - 1) * icc);
  }
  // minimum occasions to reach target reliability (inverse Spearman–Brown).
  // The −1e-9 before ceil absorbs IEEE-754 rounding noise: when the true answer sits EXACTLY on an
  // integer boundary the operands (built via 1−target etc., not clean literals) round the ratio to,
  // e.g., 4.0000000000000009, which bare ceil would round up to 5. The epsilon (≫ float noise ~1e-15,
  // ≪ any real fractional occasion) restores the mathematical value without ever masking a genuine
  // fractional need — a ratio truly at 4.0000001 (needs 5) survives the subtraction. See
  // TEST-COVERAGE-ANALYSIS 2026-07-15.
  function minOccForReliability(icc, target) {
    if (icc <= 0) return Infinity;
    if (icc >= target) return 1;
    return Math.ceil((target * (1 - icc)) / ((1 - target) * icc) - 1e-9);
  }

  /* ══ REFERENCE-FREE AGREEMENT — sigma-no-reference-analysis.js ═════════════════ */
  // Generic three-cornered hat (returns per-device variance; neg = broken assumption).
  function threeCorneredHat(vAB, vAC, vBC) {
    return { a: 0.5 * (vAB + vAC - vBC), b: 0.5 * (vAB + vBC - vAC), c: 0.5 * (vAC + vBC - vAB) };
  }
  // Per-triple three-cornered-hat σ kernel. A=H10(ECG), B=Verity(PPG), C=O2Ring(pulse).
  function tchSigmas(hh, vv, oo) {
    var dHV = [],
      dHO = [],
      dVO = [];
    for (var i = 0; i < hh.length; i++) {
      dHV.push(hh[i] - vv[i]);
      dHO.push(hh[i] - oo[i]);
      dVO.push(vv[i] - oo[i]);
    }
    var cv = threeCorneredHat(variance(dHV), variance(dHO), variance(dVO));
    return {
      h10: cv.a > 0 ? Math.sqrt(cv.a) : null,
      verity: cv.b > 0 ? Math.sqrt(cv.b) : null,
      o2: cv.c > 0 ? Math.sqrt(cv.c) : null,
      negVar: { h10: cv.a <= 0 ? cv.a : null, verity: cv.b <= 0 ? cv.b : null, o2: cv.c <= 0 ? cv.c : null },
      neg: cv.a <= 0 || cv.b <= 0 || cv.c <= 0,
      dHV: dHV,
      dHO: dHO,
      dVO: dVO
    };
  }
  // ── fused-weight hat (TCH-FUSED-ROBUST-HAT-2026-07-14) ────────────────────────
  // Per-second, per-corner confidence (cH/cV/cO from the DSP: density × SQI, AF-safe) weights each
  // difference series in a WEIGHTED-variance TCH — a corner's flagged seconds leave ITS differences
  // but not the others, so an artifact-inflated corner collapses to its true σ with no bias to the
  // clean ones. A GENTLE cross-sensor consensus (Tukey C=30 on the per-second spread vs the record's
  // own typical spread) is a soft secondary net for artifacts the DSP can't self-see. O(n); missing
  // confidences default to 1 ⇒ this reduces to (near-)classic variance. Same shape as tchSigmas.
  // Single-sourced HERE (sigma-no-reference-analysis.js delegates, like tchSigmas; the CPU/GPU
  // sensor-trio worker keeps its own Worker-local mirror). TCH-FUSED test-coverage pass 2026-07-15.
  function _wvar(d, w) {
    var sw = 0,
      swd = 0,
      i;
    for (i = 0; i < d.length; i++) {
      sw += w[i];
      swd += w[i] * d[i];
    }
    if (sw <= 0) return 0;
    var mu = swd / sw,
      s = 0;
    for (i = 0; i < d.length; i++) s += w[i] * (d[i] - mu) * (d[i] - mu);
    return s / sw;
  }
  function _consensusTrust(hh, vv, oo, C) {
    var n = hh.length,
      range = new Array(n),
      i;
    for (i = 0; i < n; i++) range[i] = Math.max(hh[i], vv[i], oo[i]) - Math.min(hh[i], vv[i], oo[i]);
    var srt = range.slice().sort(function (a, b) {
        return a - b;
      }),
      rMed = srt[srt.length >> 1] || 0;
    var ad = range
        .map(function (x) {
          return Math.abs(x - rMed);
        })
        .sort(function (a, b) {
          return a - b;
        }),
      rMad = 1.4826 * (ad[ad.length >> 1] || 0) || 1e-9;
    var w = new Array(n);
    for (i = 0; i < n; i++) {
      var z = (range[i] - rMed) / rMad;
      w[i] = z <= 0 ? 1 : z >= C ? 0 : (1 - (z / C) * (z / C)) * (1 - (z / C) * (z / C));
    }
    return w;
  }
  function tchSigmasFused(hh, vv, oo, cH, cV, cO) {
    var n = hh.length,
      dHV = [],
      dHO = [],
      dVO = [],
      wHV = [],
      wHO = [],
      wVO = [],
      i;
    var ct = _consensusTrust(hh, vv, oo, 30); // very-gentle floor; the per-corner DSP confidence is primary
    for (i = 0; i < n; i++) {
      dHV.push(hh[i] - vv[i]);
      dHO.push(hh[i] - oo[i]);
      dVO.push(vv[i] - oo[i]);
      var h = cH ? cH[i] : 1,
        v = cV ? cV[i] : 1,
        o = cO ? cO[i] : 1,
        t = ct[i];
      wHV.push(t * h * v);
      wHO.push(t * h * o);
      wVO.push(t * v * o);
    }
    var cv = threeCorneredHat(_wvar(dHV, wHV), _wvar(dHO, wHO), _wvar(dVO, wVO));
    return {
      h10: cv.a > 0 ? Math.sqrt(cv.a) : null,
      verity: cv.b > 0 ? Math.sqrt(cv.b) : null,
      o2: cv.c > 0 ? Math.sqrt(cv.c) : null,
      negVar: { h10: cv.a <= 0 ? cv.a : null, verity: cv.b <= 0 ? cv.b : null, o2: cv.c <= 0 ? cv.c : null },
      neg: cv.a <= 0 || cv.b <= 0 || cv.c <= 0,
      dHV: dHV,
      dHO: dHO,
      dVO: dVO
    };
  }
  // Bland–Altman summary of a difference series: bias, SD, 95% LoA half-width, Arms.
  function blandAltman(d) {
    var b = mean(d),
      s = sd(d);
    return { n: d.length, bias: b, sd: s, loa: 1.96 * s, arms: Math.sqrt(b * b + s * s) };
  }
  // Bare Pearson r (no guard/clamp) — the pairwise-control leg in the σ tool.
  function pearson(x, y) {
    var mx = mean(x),
      my = mean(y),
      sxy = 0,
      sx = 0,
      sy = 0;
    for (var i = 0; i < x.length; i++) {
      var dx = x[i] - mx,
        dy = y[i] - my;
      sxy += dx * dy;
      sx += dx * dx;
      sy += dy * dy;
    }
    return sxy / Math.sqrt(sx * sy);
  }

  /* ══ CORRELATION DECOMPOSITION — cgm-hrv-coupling-analysis.js ══════════════════ */
  // Pearson r with n, Fisher-z 95% CI, and the regression slope.
  function pearsonCI(xs, ys) {
    var n = xs.length;
    if (n < 3) return null;
    var mx = mean(xs),
      my = mean(ys),
      sxy = 0,
      sxx = 0,
      syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = xs[i] - mx,
        dy = ys[i] - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    if (sxx <= 0 || syy <= 0) return null;
    var r = sxy / Math.sqrt(sxx * syy);
    r = Math.max(-0.9999, Math.min(0.9999, r));
    // Fisher-z 95% CI
    var z = Math.atanh(r),
      se = 1 / Math.sqrt(Math.max(1, n - 3));
    return { r: r, n: n, lo: Math.tanh(z - 1.96 * se), hi: Math.tanh(z + 1.96 * se), slope: sxy / sxx, mx: mx, my: my };
  }
  // Partial correlation r(x,y | z) from the three pairwise r's.
  function partialCorr(rxy, rxz, ryz) {
    var d = Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
    return d > 0 ? (rxy - rxz * ryz) / d : null;
  }

  /* ══ SIMPLE OLS — odi-bias-analysis.js / hrv-confound-analysis.js ══════════════ */
  // Slope/intercept/r² of y on x. The two pages' copies are algebraically identical;
  // this is the single canonical form.
  function ols(xs, ys) {
    var n = xs.length;
    if (n < 2) return null;
    var mx = mean(xs),
      my = mean(ys),
      sxx = 0,
      sxy = 0,
      syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = xs[i] - mx,
        dy = ys[i] - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    if (!sxx) return null;
    var slope = sxy / sxx;
    return { slope: slope, intercept: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0, n: n };
  }

  /* ══ MULTIPLE OLS WITH INFERENCE — hrv-confound-analysis.js ════════════════════ */
  function invMat(A) {
    // Gauss-Jordan inverse of n×n
    var n = A.length,
      M = A.map(function (row, i) {
        var aug = row.slice();
        for (var j = 0; j < n; j++) aug.push(i === j ? 1 : 0);
        return aug;
      });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      var tmp = M[col];
      M[col] = M[piv];
      M[piv] = tmp;
      var d = M[col][col];
      for (var j = 0; j < 2 * n; j++) M[col][j] /= d;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var f = M[r2][col];
        for (var j2 = 0; j2 < 2 * n; j2++) M[r2][j2] -= f * M[col][j2];
      }
    }
    return M.map(function (row) {
      return row.slice(n);
    });
  }
  function erf(x) {
    // Abramowitz-Stegun 7.1.26
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var a1 = 0.254829592,
      a2 = -0.284496736,
      a3 = 1.421413741,
      a4 = -1.453152027,
      a5 = 1.061405429,
      pp = 0.3275911;
    var t = 1 / (1 + pp * x),
      y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return s * y;
  }
  function normP(z) {
    return 2 * (0.5 * (1 - erf(Math.abs(z) / Math.SQRT2)));
  } // two-sided
  // multiple OLS: y ~ design rows (incl. intercept col). Returns coefficients + inference.
  function olsFit(y, Xrows) {
    var n = Xrows.length,
      p = Xrows[0].length;
    if (n <= p + 1) return null;
    var XtX = [],
      Xty = new Array(p).fill(0),
      a,
      b2,
      i;
    for (a = 0; a < p; a++) {
      XtX.push(new Array(p).fill(0));
    }
    for (i = 0; i < n; i++) {
      var xi = Xrows[i],
        yi = y[i];
      for (a = 0; a < p; a++) {
        Xty[a] += xi[a] * yi;
        for (b2 = 0; b2 < p; b2++) XtX[a][b2] += xi[a] * xi[b2];
      }
    }
    var inv = invMat(XtX);
    if (!inv) return null;
    var beta = new Array(p).fill(0);
    for (a = 0; a < p; a++) {
      var s = 0;
      for (b2 = 0; b2 < p; b2++) s += inv[a][b2] * Xty[b2];
      beta[a] = s;
    }
    var my = mean(y),
      ssTot = 0,
      sseR = 0;
    for (i = 0; i < n; i++) {
      var pred = 0,
        xj = Xrows[i];
      for (a = 0; a < p; a++) pred += beta[a] * xj[a];
      var e = y[i] - pred;
      sseR += e * e;
      ssTot += (y[i] - my) * (y[i] - my);
    }
    var df = n - p,
      sigma2 = sseR / df,
      se = [],
      t = [],
      pv = [],
      ci = [];
    for (a = 0; a < p; a++) {
      var s2 = Math.sqrt(sigma2 * inv[a][a]);
      se.push(s2);
      t.push(beta[a] / s2);
      pv.push(normP(beta[a] / s2));
      ci.push([beta[a] - 1.96 * s2, beta[a] + 1.96 * s2]);
    }
    var r2 = ssTot ? 1 - sseR / ssTot : 0;
    return { beta: beta, se: se, t: t, p: pv, ci: ci, r2: r2, adjR2: 1 - ((1 - r2) * (n - 1)) / df, n: n, df: df, sigma: Math.sqrt(sigma2) };
  }
  // ROC from scores where HIGHER score = more suspicious; label = positive class bool.
  function roc(scores, labels) {
    var pairs = scores
      .map(function (s, i) {
        return { s: s, y: labels[i] };
      })
      .sort(function (a, b) {
        return b.s - a.s;
      });
    var P = labels.filter(Boolean).length,
      N = labels.length - P;
    if (!P || !N) return { auc: null, pts: [] };
    var tp = 0,
      fp = 0,
      pts = [{ x: 0, y: 0 }],
      auc = 0,
      prevFpr = 0,
      prevTpr = 0;
    pairs.forEach(function (p) {
      if (p.y) tp++;
      else fp++;
      var tpr = tp / P,
        fpr = fp / N;
      auc += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;
      pts.push({ x: fpr, y: tpr });
      prevFpr = fpr;
      prevTpr = tpr;
    });
    return { auc: auc, pts: pts };
  }

  /* ══ CHANGE-POINT + AUC — treatment-response-analysis.js ═══════════════════════ */
  // Single change-point: minimise within-segment SSE; k = first index of RIGHT segment.
  // requires ≥2 points each side. returns { k, r2, meanL, meanR } or null.
  function bestSplit(x) {
    var m = x.length;
    if (m < 4) return null;
    var total = sse(x),
      best = null;
    for (var k = 2; k <= m - 2; k++) {
      var L = x.slice(0, k),
        R = x.slice(k);
      var s = sse(L) + sse(R);
      if (!best || s < best.s) best = { k: k, s: s, meanL: mean(L), meanR: mean(R) };
    }
    if (!best) return null;
    best.r2 = total > 0 ? Math.max(0, 1 - best.s / total) : 0;
    return best;
  }
  // Mann–Whitney AUC of pos vs neg.
  function mannWhitneyAUC(pos, neg) {
    if (!pos.length || !neg.length) return null;
    var c = 0;
    for (var i = 0; i < pos.length; i++)
      for (var j = 0; j < neg.length; j++) {
        if (pos[i] > neg[j]) c++;
        else if (pos[i] === neg[j]) c += 0.5;
      }
    return c / (pos.length * neg.length);
  }

  var AnalysisStats = {
    // helpers
    mean: mean,
    variance: variance,
    sd: sd,
    median: median,
    sse: sse,
    // reliability
    iccOneWay: iccOneWay,
    spearmanBrown: spearmanBrown,
    minOccForReliability: minOccForReliability,
    // reference-free agreement
    threeCorneredHat: threeCorneredHat,
    tchSigmas: tchSigmas,
    tchSigmasFused: tchSigmasFused,
    blandAltman: blandAltman,
    pearson: pearson,
    // correlation decomposition
    pearsonCI: pearsonCI,
    partialCorr: partialCorr,
    // regression
    ols: ols,
    olsFit: olsFit,
    invMat: invMat,
    roc: roc,
    // change-point
    bestSplit: bestSplit,
    mannWhitneyAUC: mannWhitneyAUC
  };

  root.AnalysisStats = AnalysisStats;
  if (typeof module !== 'undefined' && module.exports) module.exports = AnalysisStats;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
