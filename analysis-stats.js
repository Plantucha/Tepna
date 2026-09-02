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
  /* ── PAIRWISE-ρ three-cornered hat (TCH-REFERENCE-VALIDATION R2) ──────────────────────────────────
     Classic TCH assumes the three corners' errors are MUTUALLY INDEPENDENT:
         Var(x_i − x_j) = σ²_i + σ²_j
     That assumption is measurably false for a respiration triplet: ECG-RSA and PPG-RSA are not
     independent looks at breathing — they read the same modulation — and the reference measured
     ρ(ECG,PPG) = 0.42. Under a violated assumption the solve does not fail loudly; it MOVES VARIANCE
     between corners, which is how a chest strap acquires an implausible σ.

     `integrator-tch.js` already has a correlated path, but it applies ONE COMMON-MODE ρ to all three
     pairs equally. That cannot express the actual structure — "ECG and PPG are coupled, the CPAP is
     independent" — and inflates every corner instead of the two that are really coupled (the brief's
     §4: common-mode ρ=0.42 moves CPAP 2.07 → 2.71, which is the wrong direction for the corner that
     is not part of the correlated pair).

     The honest model keeps a ρ PER PAIR:
         Var(x_i − x_j) = σ²_i + σ²_j − 2·ρ_ij·σ_i·σ_j
     Three equations, three unknowns — but NONLINEAR, so there is no closed form like the classic
     half-sum. Solved by Newton on (σ_a, σ_b, σ_c) with an analytic Jacobian, seeded from the classic
     ρ=0 solution (the right seed: it is the exact answer when every ρ is 0, so the correlated solve
     starts on the answer it is correcting).

     REFUSAL, not a fabricated number. Returns `{ok:false, reason}` when the seed is unusable, when
     Newton fails to converge, or when the solution is not physical (a negative variance). A ρ triple
     can be jointly impossible; producing a σ anyway is exactly the failure this generalisation exists
     to stop. */
  /* ── DISTANCE TO THE SINGULARITY (TCH-CORRELATED-SOLVE-KNIFE-EDGE §3) ────────────────────────────
     A correlated σ is not interpretable without it. On the real CPAP/ECG/PPG triplet the measured
     ρ(ECG,PPG) = 0.42 sits within 0.5 % of ρ_crit ≈ 0.422 — the correlation at which σ(CPAP) reaches
     zero and past which the model has no solution at all. The 0.19 bpm it returns there is the
     non-negativity boundary seen from the inside, not a quiet sensor. Crucially this happens at a
     POSITIVE σ, so the classic hat's negative-variance check (which `tch-multinight` already uses to
     exclude nights) never fires.

     COMPUTED BY BISECTING THE SOLVER, deliberately — not by a closed form. A second derivation of the
     boundary would be a second implementation of the model, free to disagree with the one that produces
     the σ being qualified; the sensor-trio power tool shipped exactly that duplication and needed a
     parity gate to bind it back. Bisection asks the real solver where it fails, so the answer cannot
     drift from the thing it describes.

     Reported for EVERY pair, including ones at ρ = 0: "how far is independence from collapse" is
     information even when no correlation was measured. `nearest` is the smallest move in any single ρ
     that breaks the solve. */
  function tchRhoCrit(vAB, vAC, vBC, rho) {
    var base = { ab: (rho && rho.ab) || 0, ac: (rho && rho.ac) || 0, bc: (rho && rho.bc) || 0 };
    var solves = function (pair, val) {
      /* _noCrit MUST ride along: without it each probe starts its own bisection and the recursion is
         unbounded (it blew the stack on the first run). The guard belongs on the object actually
         passed, not on the caller's. */
      var r = { ab: base.ab, ac: base.ac, bc: base.bc, _noCrit: true };
      r[pair] = val;
      var out = tchSigmasPairwiseFromVars(vAB, vAC, vBC, r);
      return !!(out && out.ok);
    };
    var LIM = 0.999;
    var per = {},
      nearest = null;
    ['ab', 'ac', 'bc'].forEach(function (pair) {
      if (!solves(pair, base[pair])) {
        per[pair] = null;
        return;
      }
      var dirs = {};
      [1, -1].forEach(function (sign) {
        // walk out until it breaks — coarse, then bisect the bracket
        var lo = base[pair],
          hi = null;
        for (var step = 0.05; step <= 2.0; step += 0.05) {
          var v = base[pair] + sign * step;
          if (Math.abs(v) > LIM) {
            v = sign * LIM;
            if (solves(pair, v)) break; // never breaks inside the admissible range
            hi = v;
            break;
          }
          if (!solves(pair, v)) {
            hi = v;
            break;
          }
          lo = v;
        }
        if (hi === null) return; // no singularity in this direction
        for (var i = 0; i < 40; i++) {
          var mid = 0.5 * (lo + hi);
          if (solves(pair, mid)) lo = mid;
          else hi = mid;
        }
        dirs[sign > 0 ? 'up' : 'down'] = { at: hi, margin: Math.abs(hi - base[pair]) };
      });
      per[pair] = Object.keys(dirs).length ? dirs : null;
      Object.keys(dirs).forEach(function (d) {
        if (nearest === null || dirs[d].margin < nearest.margin) nearest = { pair: pair, dir: d, at: dirs[d].at, margin: dirs[d].margin };
      });
    });
    /* ── SENSITIVITY, NOT A REFUSAL THRESHOLD (KNIFE-EDGE §2) ────────────────────────────────────
       §2 asked to "refuse inside a margin of ρ_crit, picked from the data". Measured, there is no
       margin to pick: σ's sensitivity to ρ rises SMOOTHLY all the way to the boundary, with no regime
       change to threshold on —

         distance from ρ_crit   0.200   0.100   0.050   0.020   0.010   0.005   0.002
         σ(collapsing corner)   1.618   1.227   0.902   0.584   0.417   0.296   0.188
         dσ per 0.01 of ρ      −0.030  −0.051  −0.080  −0.133  −0.183  −0.242  −0.324

       That is EDR-THRESHOLD-MARGIN-FOLLOWUPS §3's rule applying again: state a margin only where the
       regimes separate; where they do not, publish the sensitivity. So the useful question is not "how
       close to ρ_crit is too close" but "HOW PRECISELY IS ρ KNOWN?" — and that is arithmetic the caller
       can do, because only the caller knows its ρ's uncertainty. `rhoFor0p1` is the ρ precision needed
       to pin σ to ±0.1 bpm; if the ρ estimate is looser than that, the σ is not identifiable, however
       far from the boundary it sits. */
    if (nearest) {
      var h = 0.005;
      var probe = function (v) {
        var r = { ab: base.ab, ac: base.ac, bc: base.bc, _noCrit: true };
        r[nearest.pair] = v;
        var o = tchSigmasPairwiseFromVars(vAB, vAC, vBC, r);
        if (!o || !o.ok) return null;
        // the corner that collapses is the one nearest zero at the operating point
        var m = Math.min(o.a, o.b, o.c);
        return m;
      };
      var atOp = probe(base[nearest.pair]);
      var away = probe(base[nearest.pair] - Math.sign(nearest.at - base[nearest.pair] || 1) * h);
      if (atOp !== null && away !== null && h > 0) {
        var dSigma = (atOp - away) / h; // per unit ρ
        nearest.sigmaPerRho = dSigma * 0.01; // per 0.01 of ρ — the readable unit
        nearest.rhoFor0p1 = Math.abs(dSigma) > 0 ? 0.1 / Math.abs(dSigma) : null;
      }
    }
    return { pairs: per, nearest: nearest };
  }

  function tchSigmasPairwiseFromVars(vAB, vAC, vBC, rho) {
    rho = rho || {};
    var rAB = rho.ab || 0,
      rAC = rho.ac || 0,
      rBC = rho.bc || 0;
    /* SEEDING. The classic ρ=0 solve is the natural seed — it is the exact answer when every ρ is 0.
       But it must NOT be a precondition: a classic solve that returns a negative variance is precisely
       the symptom of correlated corners, i.e. the case this generalisation exists to solve. Refusing
       there would make the pairwise hat useless exactly where it is needed. (Found by this function's
       own self-test: planted σ = 1.5/1.5/5.0 with ρ = 0.6/−0.2/0.3 is a perfectly real triple whose
       classic seed is non-physical.) So fall back to an isotropic seed built from the observed
       variances, which carries no independence assumption at all. */
    var seed = threeCorneredHat(vAB, vAC, vBC);
    var x;
    if (seed.a > 0 && seed.b > 0 && seed.c > 0) {
      x = [Math.sqrt(seed.a), Math.sqrt(seed.b), Math.sqrt(seed.c)];
    } else {
      var iso = Math.sqrt(Math.max((vAB + vAC + vBC) / 6, 1e-9));
      x = [iso, iso, iso];
    }
    // residuals: f0 = σa²+σb²−2ρab·σa·σb − vAB, and the AC / BC siblings
    function F(v) {
      return [v[0] * v[0] + v[1] * v[1] - 2 * rAB * v[0] * v[1] - vAB, v[0] * v[0] + v[2] * v[2] - 2 * rAC * v[0] * v[2] - vAC, v[1] * v[1] + v[2] * v[2] - 2 * rBC * v[1] * v[2] - vBC];
    }
    /* One damped-Newton descent from a given seed. Returns the converged PHYSICAL root, or a refusal
       tag. Extracted so the multi-root hunt below can descend from many seeds with the identical
       arithmetic — the primary root (from the same seed policy as always) is bit-identical to the
       pre-F15 answer. */
    function solveFrom(x0) {
      var v = [x0[0], x0[1], x0[2]];
      for (var it = 0; it < 100; it++) {
        var f = F(v);
        if (Math.abs(f[0]) < 1e-12 && Math.abs(f[1]) < 1e-12 && Math.abs(f[2]) < 1e-12) break;
        // analytic Jacobian — each equation involves exactly two of the three unknowns
        var J = [
          [2 * v[0] - 2 * rAB * v[1], 2 * v[1] - 2 * rAB * v[0], 0],
          [2 * v[0] - 2 * rAC * v[2], 0, 2 * v[2] - 2 * rAC * v[0]],
          [0, 2 * v[1] - 2 * rBC * v[2], 2 * v[2] - 2 * rBC * v[1]]
        ];
        var d = _solve3(J, [-f[0], -f[1], -f[2]]);
        if (!d) return { fail: 'singular', it: it };
        // damped step: a full Newton step can overshoot a σ straight through zero
        var damp = 1;
        for (var k = 0; k < 3; k++) if (v[k] + damp * d[k] <= 0) damp = Math.min(damp, (0.5 * v[k]) / Math.abs(d[k] || 1e-12));
        v = [v[0] + damp * d[0], v[1] + damp * d[1], v[2] + damp * d[2]];
      }
      var fin0 = F(v);
      var w = Math.max(Math.abs(fin0[0]), Math.abs(fin0[1]), Math.abs(fin0[2]));
      if (!(w < 1e-6)) return { fail: 'no-converge', residual: w };
      if (!(v[0] > 0 && v[1] > 0 && v[2] > 0) || !isFinite(v[0] + v[1] + v[2])) return { fail: 'non-physical' };
      return { x: v, residual: w };
    }
    var primary = solveFrom(x);
    if (primary.fail === 'singular') return { ok: false, reason: 'Jacobian singular at iteration ' + primary.it + ' — no locally unique solution for this (variance, ρ) combination' };
    if (primary.fail === 'no-converge')
      return { ok: false, reason: 'Newton did not converge (residual ' + primary.residual.toExponential(2) + ') — this (variance, ρ) combination admits no consistent σ triple' };
    if (primary.fail === 'non-physical') return { ok: false, reason: 'solution is not physical (a σ is ≤ 0 or non-finite)' };
    x = primary.x;
    var worst = primary.residual;
    /* ── MULTI-ROOT HUNT (DEEP-AUDIT-VI F15) ──────────────────────────────────────────────────────
       With any ρ ≠ 0 this quadratic system frequently admits MORE THAN ONE positive triple that
       reproduces the observed variances exactly (measured on the production single-ρ shape: 12 of 53
       planted physical systems; in 4 the seed's basin held a NON-planted root — one corner off 76 %,
       another 4×). Newton reports whichever root its seed reaches, so "the σ" was a property of the
       seed, not of the data — and a tiny ρ perturbation could jump it discontinuously. The kernel's
       doctrine is REFUSAL, not a fabricated number: descend from a deterministic spread of seeds, and
       if a DISTINCT admissible root exists, refuse and quote both. Skipped on internal probe calls
       (`_noCrit`: tchRhoCrit's ~120-step bisection and the sensitivity probe ask a different question
       — "does a solution exist HERE" — and their known answers must not move). */
    if (!(rho && rho._noCrit) && (rAB || rAC || rBC)) {
      var scale = Math.max(x[0], x[1], x[2]);
      var roots = [x];
      var SCALES = [0.25, 4];
      var seeds = [];
      for (var sc = 0; sc < SCALES.length; sc++) {
        seeds.push([x[0] * SCALES[sc], x[1] * SCALES[sc], x[2] * SCALES[sc]]);
        for (var ci = 0; ci < 3; ci++) {
          var s2 = [x[0], x[1], x[2]];
          s2[ci] *= SCALES[sc];
          seeds.push(s2);
        }
      }
      for (var si = 0; si < seeds.length; si++) {
        var alt = solveFrom(seeds[si]);
        if (alt.fail) continue;
        var isNew = true;
        for (var ri = 0; ri < roots.length && isNew; ri++) {
          var dd = Math.max(Math.abs(alt.x[0] - roots[ri][0]), Math.abs(alt.x[1] - roots[ri][1]), Math.abs(alt.x[2] - roots[ri][2]));
          if (dd <= 1e-4 * (1 + scale)) isNew = false;
        }
        if (isNew) roots.push(alt.x);
      }
      if (roots.length > 1) {
        var quoted = roots
          .map(function (r) {
            return (
              '(' +
              r
                .map(function (q) {
                  return q.toFixed(4);
                })
                .join('/') +
              ')'
            );
          })
          .join(' vs ');
        return {
          ok: false,
          reason: 'multiple admissible sigma triples — ' + roots.length + ' distinct positive roots reproduce these variances under this ρ, so the data do not identify σ: ' + quoted,
          roots: roots.map(function (r) {
            return { a: r[0], b: r[1], c: r[2] };
          })
        };
      }
    }
    /* ADDITIVE — a new field, so every existing caller is byte-unchanged. `_noCrit` breaks the
       recursion: tchRhoCrit calls this function ~120 times while bisecting, and each of those must not
       start its own bisection. */
    var crit = rho && rho._noCrit ? null : tchRhoCrit(vAB, vAC, vBC, { ab: rAB, ac: rAC, bc: rBC, _noCrit: true });
    return {
      ok: true,
      a: x[0],
      b: x[1],
      c: x[2],
      rhoCrit: crit,
      rho: { ab: rAB, ac: rAC, bc: rBC },
      classic: seed.a > 0 && seed.b > 0 && seed.c > 0 ? { a: Math.sqrt(seed.a), b: Math.sqrt(seed.b), c: Math.sqrt(seed.c) } : null,
      classicWasNonPhysical: !(seed.a > 0 && seed.b > 0 && seed.c > 0),
      residual: worst
    };
  }
  // 3×3 solve by Gaussian elimination with partial pivoting; null when singular.
  function _solve3(M, r) {
    var A = [M[0].slice(), M[1].slice(), M[2].slice()],
      b = r.slice(),
      i,
      j,
      k;
    for (i = 0; i < 3; i++) {
      var p = i;
      for (j = i + 1; j < 3; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      if (Math.abs(A[p][i]) < 1e-14) return null;
      if (p !== i) {
        var t = A[p];
        A[p] = A[i];
        A[i] = t;
        var tb = b[p];
        b[p] = b[i];
        b[i] = tb;
      }
      for (j = i + 1; j < 3; j++) {
        var m = A[j][i] / A[i][i];
        for (k = i; k < 3; k++) A[j][k] -= m * A[i][k];
        b[j] -= m * b[i];
      }
    }
    var x = [0, 0, 0];
    for (i = 2; i >= 0; i--) {
      var s = b[i];
      for (j = i + 1; j < 3; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }
  // Series-level sibling of `tchSigmas`, taking a per-PAIR ρ instead of assuming independence.
  function tchSigmasPairwise(hh, vv, oo, rho) {
    var dHV = [],
      dHO = [],
      dVO = [];
    for (var i = 0; i < hh.length; i++) {
      dHV.push(hh[i] - vv[i]);
      dHO.push(hh[i] - oo[i]);
      dVO.push(vv[i] - oo[i]);
    }
    return tchSigmasPairwiseFromVars(variance(dHV), variance(dHO), variance(dVO), rho);
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
    /* DEEP-AUDIT-II §12.4 — tied scores must advance the curve as ONE block.
       Stepping one point at a time drew a staircase through each tie, so the area depended on
       whether positives or negatives happened to be ordered first WITHIN the tied group. `sort` is
       stable, so that is just input order — and the papers layer feeds it from workers, making the
       published AUC run-to-run nondeterministic. It also falsified hrv-confound-analysis.js's own
       order-invariance comment.
       The damage is not subtle: on 4 tied scores with mixed labels, permuting only the tied labels
       moves AUC between 1.0000 ("perfect discrimination") and 0.5556 ("barely above chance"), when
       the true value is 0.7778. NEITHER endpoint was correct.
       Advancing tp/fp across the whole tied block and drawing a single trapezoid over it is the
       diagonal through the tie — exactly the half-credit Mann–Whitney assigns — so `roc().auc` now
       equals `mannWhitneyAUC` identically, which is the gate. */
    var bi = 0;
    while (bi < pairs.length) {
      var bj = bi;
      while (bj < pairs.length && pairs[bj].s === pairs[bi].s) {
        if (pairs[bj].y) tp++;
        else fp++;
        bj++;
      }
      var tpr = tp / P,
        fpr = fp / N;
      auc += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;
      pts.push({ x: fpr, y: tpr });
      prevFpr = fpr;
      prevTpr = tpr;
      bi = bj;
    }
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
    tchSigmasPairwise: tchSigmasPairwise,
    tchSigmasPairwiseFromVars: tchSigmasPairwiseFromVars,
    tchRhoCrit: tchRhoCrit,
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
