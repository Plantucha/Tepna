/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * integrator-tch.js — Three-Cornered Hat (reference-free per-sensor error)
 *
 * PURE. NO DOM. Loaded as a plain global script (shares page scope) and by the
 * Node/browser test runners via env.IntegratorTCH. Deterministic — no Date.now,
 * no RNG, no I/O.
 *
 * WHAT — given THREE estimators of the SAME latent quantity (e.g. instantaneous
 * HR from ECGDex / PpgDex / OxyDex, or RMSSD from ECGDex / PpgDex / HRVDex),
 * recover EACH sensor's OWN error variance with NO gold-standard reference, from
 * the three pairwise-difference variances (Gray & Allan 1974):
 *
 *     V_AB = Var(A−B) = σ²_A + σ²_B − 2·Cov(n_A,n_B)
 *     σ²_A = ½(V_AB + V_AC − V_BC)      (classic — assumes Cov = 0)
 *     σ²_B = ½(V_AB + V_BC − V_AC)
 *     σ²_C = ½(V_AC + V_BC − V_AB)
 *
 * WHY NOT inside one PPG module — the three LEDs are co-located, so motion is
 * COMMON-MODE and TCH cancels common-mode by construction → false confidence.
 * The well-posed application is CROSS-NODE (chest/wrist/finger), where the noise
 * is largely independent. See INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md.
 *
 * CAVEAT (must be surfaced by the consumer): TCH measures PRECISION / instability,
 * NOT trueness — a bias shared by all three is invisible to it. That is fine for
 * the RMSSD-inflation problem, which IS excess variance. A further limit: POSITIVE
 * common-mode noise biases the classic estimate WITHOUT driving any variance
 * negative, so it cannot be detected reference-free — pass opts.rho (an externally
 * estimated common-mode correlation, e.g. from co-motion) to remove it; the auto
 * min-rho search only engages on the negative-variance failure mode.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var EPS = 1e-9;

  /* ── basic stats (null/NaN-safe) ─────────────────────────────────────── */
  function _finite(v) { return typeof v === 'number' && isFinite(v); }
  function mean(a) {
    var s = 0, n = 0;
    for (var i = 0; i < a.length; i++) if (_finite(a[i])) { s += a[i]; n++; }
    return n ? s / n : null;
  }
  // population variance (÷N) — TCH difference-variances are consistent under ÷N
  function variance(a) {
    var m = mean(a); if (m == null) return null;
    var s = 0, n = 0;
    for (var i = 0; i < a.length; i++) if (_finite(a[i])) { var d = a[i] - m; s += d * d; n++; }
    return n ? s / n : null;
  }

  /* Variance of the paired difference (A−B), over indices where BOTH are finite. */
  function pairDiffVar(a, b) {
    var d = [];
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) if (_finite(a[i]) && _finite(b[i])) d.push(a[i] - b[i]);
    if (d.length < 2) return null;
    return { v: variance(d), n: d.length };
  }

  /* ── Allan deviation vs averaging time τ (INTEGRATOR-THREE-CORNERED-HAT §3) ──
     Overlapping Allan variance/deviation of ONE evenly-spaced series at averaging
     factors `taus` (integers ≥1, in SAMPLES). For frequency-type data yᵢ (per-epoch
     HR / RMSSD levels): with m-sample overlapping averages ȳᵢ = mean(y[i..i+m-1]),
         AVAR(m) = 1/(2·K) · Σ (ȳ_{i+m} − ȳᵢ)²,   K = #{ i : i+2m ≤ N }
     Returns [{ m, avar, adev, n }] index-aligned to `taus`; avar/adev = null when the
     series is too short (N < 2m+1) or carries a non-finite sample. Assumes a REGULAR
     grid — index adjacency is treated as one step, so a gappy aligned epoch grid is
     approximated (fine for an indicative τ-curve, not a metrology claim). */
  function allanDeviation(series, taus) {
    var x = series || [], N = x.length, ok = true;
    for (var i = 0; i < N; i++) if (!_finite(x[i])) { ok = false; break; }
    var pre = null;
    if (ok) { pre = new Array(N + 1); pre[0] = 0; for (var j = 0; j < N; j++) pre[j + 1] = pre[j] + x[j]; }
    return (taus || []).map(function (mRaw) {
      var m = Math.max(1, Math.round(mRaw));
      if (!ok || N < 2 * m + 1) return { m: m, avar: null, adev: null, n: 0 };
      var sum = 0, cnt = 0;
      for (var i = 0; i + 2 * m <= N; i++) {
        var d = (pre[i + 2 * m] - pre[i + m]) / m - (pre[i + m] - pre[i]) / m;
        sum += d * d; cnt++;
      }
      if (cnt < 1) return { m: m, avar: null, adev: null, n: 0 };
      var avar = sum / (2 * cnt);
      return { m: m, avar: avar, adev: Math.sqrt(avar), n: cnt };
    });
  }

  /* Per-sensor Allan-deviation-vs-τ via three-cornered hat in the ALLAN-VARIANCE
     domain — the ORIGINAL Gray–Allan use. The latent truth cancels in every pairwise
     difference, so AVAR(A−B, τ) reflects only sensor A+B noise at that averaging time;
     the classic TCH split then isolates each sensor's Allan variance:
         σ²ᵢ(τ) = ½( AVAR(i−j,τ) + AVAR(i−k,τ) − AVAR(j−k,τ) )  →  σᵢ(τ) = √σ²ᵢ(τ)
     seriesA/B/C: index-aligned plain-number arrays (alignTriplet output). opts.taus =
     averaging factors in samples (default [1,2,4,8]); opts.labels = node names. A τ whose
     series is too short yields null for that point; a slightly-negative split (the
     non-negativity artifact when a small-variance member is swamped by sampling noise)
     clamps to 0 — "error below the reference-free resolution at this τ", consistent with
     the classic σ-bar path. Classic (ρ=0) — indicative precision-vs-timescale that
     complements the ρ-aware whole-window σ bars. Returns { taus, adev:{label:[…|null]}, n:[…] } | null. */
  function allanTriplet(seriesA, seriesB, seriesC, opts) {
    opts = opts || {};
    var labels = opts.labels || ['A', 'B', 'C'];
    var taus = opts.taus || [1, 2, 4, 8];
    if (!seriesA || !seriesB || !seriesC) return null;
    function diff(a, b) {
      var d = [], n = Math.min(a.length, b.length);
      for (var i = 0; i < n; i++) d.push(_finite(a[i]) && _finite(b[i]) ? a[i] - b[i] : NaN);
      return d;
    }
    var avAB = allanDeviation(diff(seriesA, seriesB), taus),
        avAC = allanDeviation(diff(seriesA, seriesC), taus),
        avBC = allanDeviation(diff(seriesB, seriesC), taus);
    var adev = {}, ns = [];
    adev[labels[0]] = []; adev[labels[1]] = []; adev[labels[2]] = [];
    for (var i = 0; i < taus.length; i++) {
      var Vab = avAB[i].avar, Vac = avAC[i].avar, Vbc = avBC[i].avar;
      if (Vab == null || Vac == null || Vbc == null) {
        adev[labels[0]].push(null); adev[labels[1]].push(null); adev[labels[2]].push(null); ns.push(0);
        continue;
      }
      var cl = classic(Vab, Vac, Vbc);   // non-negativity projection: clamp a slightly
      // negative split (small-variance member swamped by sampling noise) to 0 — same as the
      // classic σ-bar path (threeCorneredHat's Math.max(cl.x,0)).
      adev[labels[0]].push(Math.sqrt(Math.max(cl.a, 0)));
      adev[labels[1]].push(Math.sqrt(Math.max(cl.b, 0)));
      adev[labels[2]].push(Math.sqrt(Math.max(cl.c, 0)));
      ns.push(Math.min(avAB[i].n, avAC[i].n, avBC[i].n));
    }
    return { taus: taus.slice(), adev: adev, n: ns };
  }

  /* ── classic Gray–Allan closed form (assumes uncorrelated noise) ──────── */
  function classic(Vab, Vac, Vbc) {
    return {
      a: 0.5 * (Vab + Vac - Vbc),
      b: 0.5 * (Vab + Vbc - Vac),
      c: 0.5 * (Vac + Vbc - Vab)
    };
  }

  /* ── 3×3 linear solve (Cramer) — for the correlated Newton step ───────── */
  function solve3(M, y) {
    function det3(m) {
      return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
           - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
           + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    }
    var D = det3(M);
    if (Math.abs(D) < 1e-14) return null;
    var out = [];
    for (var col = 0; col < 3; col++) {
      var Mc = [M[0].slice(), M[1].slice(), M[2].slice()];
      for (var r = 0; r < 3; r++) Mc[r][col] = y[r];
      out[col] = det3(Mc) / D;
    }
    return out;
  }

  /* Solve the correlated system for a FIXED common-mode correlation rho.
     Model: Cov(n_i,n_j) = rho·s_i·s_j, so with s_i = √σ²_i:
        V_ij = s_i² + s_j² − 2·rho·s_i·s_j
     3 nonlinear eqs in (s_a,s_b,s_c). DAMPED Newton (backtracking line search on
     ‖f‖) with s clamped ≥ 0 — the raw system is nonlinear with multiple roots, so a
     bare Newton step from one start is unreliable. */
  function _residual(s, rho, Vab, Vac, Vbc) {
    return [
      s[0]*s[0] + s[1]*s[1] - 2*rho*s[0]*s[1] - Vab,
      s[0]*s[0] + s[2]*s[2] - 2*rho*s[0]*s[2] - Vac,
      s[1]*s[1] + s[2]*s[2] - 2*rho*s[1]*s[2] - Vbc
    ];
  }
  function _norm(f) { return Math.abs(f[0]) + Math.abs(f[1]) + Math.abs(f[2]); }
  function solveFixedRho(Vab, Vac, Vbc, rho, start) {
    var s = [Math.max(start[0], 1e-6), Math.max(start[1], 1e-6), Math.max(start[2], 1e-6)];
    for (var it = 0; it < 60; it++) {
      var f = _residual(s, rho, Vab, Vac, Vbc);
      if (_norm(f) < 1e-11) break;
      var sa = s[0], sb = s[1], sc = s[2];
      var J = [
        [2 * sa - 2 * rho * sb, 2 * sb - 2 * rho * sa, 0],
        [2 * sa - 2 * rho * sc, 0, 2 * sc - 2 * rho * sa],
        [0, 2 * sb - 2 * rho * sc, 2 * sc - 2 * rho * sb]
      ];
      var step = solve3(J, f);
      if (!step) return null;
      var lam = 1, cur = _norm(f), tried;
      for (var bt = 0; bt < 24; bt++) {
        tried = [Math.max(s[0] - lam*step[0], 0), Math.max(s[1] - lam*step[1], 0), Math.max(s[2] - lam*step[2], 0)];
        if (_norm(_residual(tried, rho, Vab, Vac, Vbc)) < cur) break;
        lam *= 0.5;
      }
      if (!(_finite(tried[0]) && _finite(tried[1]) && _finite(tried[2]))) return null;
      s = tried;
    }
    if (_norm(_residual(s, rho, Vab, Vac, Vbc)) > 1e-5) return null;
    return { a: s[0] * s[0], b: s[1] * s[1], c: s[2] * s[2] };
  }

  /* Multi-start wrapper: the fixed-rho system has multiple roots, so try several
     starts and keep the lowest-residual non-negative solution. */
  function _solveMulti(Vab, Vac, Vbc, rho) {
    var cl = classic(Vab, Vac, Vbc);
    var mV = (Vab + Vac + Vbc) / 3;
    var sq = function (x) { return Math.sqrt(Math.max(x, 1e-6)); };
    var starts = [
      [sq(cl.a), sq(cl.b), sq(cl.c)],
      [sq(mV/2), sq(mV/2), sq(mV/2)],
      [sq(Vab), sq(Vbc), sq(Vac)],
      [sq(Vab/2)*0.5, sq(Vab/2), sq(Vac/2)],
      [0.3, sq(Vab), sq(Vbc)],
      [sq(Vab), 0.3, sq(Vbc)]
    ];
    var best = null, bestRes = Infinity;
    for (var i = 0; i < starts.length; i++) {
      var sol = solveFixedRho(Vab, Vac, Vbc, rho, starts[i]);
      if (!sol || sol.a < -1e-6 || sol.b < -1e-6 || sol.c < -1e-6) continue;
      var res = _norm(_residual([sq(sol.a), sq(sol.b), sq(sol.c)], rho, Vab, Vac, Vbc));
      if (res < bestRes) { bestRes = res; best = { a: Math.max(sol.a,0), b: Math.max(sol.b,0), c: Math.max(sol.c,0) }; }
    }
    return best;
  }

  /* Generalized / correlated TCH (Premoli–Tavella / Ekström–Koppang spirit):
     the classic system is under-determined once noises correlate. We close it
     with a SINGLE common-mode rho (co-timed arousals hit all sites at once) and
     report the MINIMUM |rho| that restores a non-negative solution — i.e. "the
     smallest correlation you must assume to make the data consistent", which is
     exactly the honest quantity to surface. */
  function correlated(Vab, Vac, Vbc, opts) {
    opts = opts || {};
    var rhoMax = opts.rhoMax != null ? opts.rhoMax : 0.95;
    var rhoStep = opts.rhoStep != null ? opts.rhoStep : 0.01;
    for (var rho = 0; rho <= rhoMax + EPS; rho += rhoStep) {
      var sol = _solveMulti(Vab, Vac, Vbc, rho);
      if (sol && sol.a >= -1e-6 && sol.b >= -1e-6 && sol.c >= -1e-6) {
        return {
          a: Math.max(sol.a, 0), b: Math.max(sol.b, 0), c: Math.max(sol.c, 0),
          rho: +rho.toFixed(4)
        };
      }
    }
    return null;
  }

  /* ── main entry ───────────────────────────────────────────────────────
     seriesA/B/C: arrays of the SAME quantity, index-aligned (use alignTriplet
     first for {tMin,v} epoch objects). labels: node names in A/B/C order.
     Returns per-sensor σ²/σ, the method used, the assumed rho, inverse-variance
     weights, the culprit (largest σ²), n, and an honest reason string. */
  function threeCorneredHat(seriesA, seriesB, seriesC, opts) {
    opts = opts || {};
    var labels = opts.labels || ['A', 'B', 'C'];
    var minN = opts.minN != null ? opts.minN : 12;
    if (!seriesA || !seriesB || !seriesC) return { ok: false, reason: 'need three series' };

    var pAB = pairDiffVar(seriesA, seriesB);
    var pAC = pairDiffVar(seriesA, seriesC);
    var pBC = pairDiffVar(seriesB, seriesC);
    if (!pAB || !pAC || !pBC) return { ok: false, reason: 'insufficient paired overlap' };
    var n = Math.min(pAB.n, pAC.n, pBC.n);
    if (n < minN) return { ok: false, reason: 'overlap ' + n + ' < minN ' + minN, n: n };

    var Vab = pAB.v, Vac = pAC.v, Vbc = pBC.v;
    var cl = classic(Vab, Vac, Vbc);
    var method, rho, sig2, negative = false;

    // (0) EXTERNAL common-mode rho supplied by the consumer (e.g. an ACC-derived
    // co-motion estimate, or a prior). Positive common-mode BIASES classic without
    // driving it negative, so it can't be detected reference-free — the honest fix
    // is to remove a correlation the consumer can independently estimate. Solve the
    // correlated system directly at that rho.
    if (opts.rho != null && opts.rho > 0) {
      var solX = _solveMulti(Vab, Vac, Vbc, opts.rho);
      if (solX && solX.a >= -1e-6 && solX.b >= -1e-6 && solX.c >= -1e-6) {
        method = 'correlated-external'; rho = opts.rho; negative = (cl.a < 0 || cl.b < 0 || cl.c < 0);
        sig2 = { a: Math.max(solX.a, 0), b: Math.max(solX.b, 0), c: Math.max(solX.c, 0) };
      }
      // else fall through to the classic / auto path below
    }

    if (sig2) {
      /* set by external-rho path */
    } else if (cl.a >= -1e-9 && cl.b >= -1e-9 && cl.c >= -1e-9) {
      method = 'classic'; rho = 0;
      sig2 = { a: Math.max(cl.a, 0), b: Math.max(cl.b, 0), c: Math.max(cl.c, 0) };
    } else {
      negative = true;
      var corr = correlated(Vab, Vac, Vbc, opts);
      if (corr) {
        method = 'correlated'; rho = corr.rho;
        sig2 = { a: corr.a, b: corr.b, c: corr.c };
      } else {
        // last resort: report the classic solution clamped, flagged not-ok
        method = 'classic-clamped'; rho = null;
        sig2 = { a: Math.max(cl.a, 0), b: Math.max(cl.b, 0), c: Math.max(cl.c, 0) };
        return {
          ok: false, reason: 'negative variance; no non-negative correlated fit ≤ rhoMax',
          negative: true, method: method, n: n,
          sigma2: _bylabel(labels, sig2), diffVar: { AB: Vab, AC: Vac, BC: Vbc }
        };
      }
    }

    var sigma2 = _bylabel(labels, sig2);
    var sigma = {}; Object.keys(sigma2).forEach(function (k) { sigma[k] = Math.sqrt(sigma2[k]); });
    var weights = inverseVarianceWeights(sigma2);
    var culprit = _argmax(sigma2);

    return {
      ok: true, method: method, rho: rho, negative: negative, n: n,
      sigma2: sigma2, sigma: sigma, weights: weights, culprit: culprit,
      diffVar: { AB: Vab, AC: Vac, BC: Vbc },
      caveat: 'TCH estimates precision (instability), not trueness — a bias shared by all three sensors is invisible. Positive common-mode noise also biases classic without going negative; supply opts.rho to remove a co-motion correlation you can estimate externally.'
    };
  }

  function _bylabel(labels, s) { var o = {}; o[labels[0]] = s.a; o[labels[1]] = s.b; o[labels[2]] = s.c; return o; }
  function _argmax(map) {
    var best = null, bv = -Infinity;
    Object.keys(map).forEach(function (k) { if (map[k] > bv) { bv = map[k]; best = k; } });
    return best;
  }

  /* Inverse-variance fusion weights (∝ 1/σ²), normalized to sum 1. A noisier
     sensor contributes less to the single fused value. REGULARIZED: each σ² is
     floored at floorFrac×(max σ²) so a spuriously near-zero estimate — sampling
     noise at short records (~48–96 epochs) can drive one σ²→0 — cannot capture
     ~all the weight and hijack the reconciled value. Floor is inert when the
     variances are well-separated and none is pathologically small. */
  function inverseVarianceWeights(sigma2, opts) {
    opts = opts || {};
    var floorFrac = opts.floorFrac != null ? opts.floorFrac : 0.08;
    var ks = Object.keys(sigma2), maxS2 = 0;
    ks.forEach(function (k) { if (sigma2[k] > maxS2) maxS2 = sigma2[k]; });
    var floorV = Math.max(EPS, floorFrac * maxS2);
    var inv = {}, sum = 0;
    ks.forEach(function (k) { var s2 = Math.max(sigma2[k], floorV); inv[k] = 1 / s2; sum += inv[k]; });
    var w = {}; ks.forEach(function (k) { w[k] = sum ? inv[k] / sum : 1 / ks.length; });
    return w;
  }

  /* Align three arrays of {tMin (or opts.key), v} onto their COMMON keys, in
     ascending key order → { A:[…], B:[…], C:[…], keys:[…] } of plain numbers.
     Epoch grids from node exports (timeseries.epochs[].hr / .rmssd) feed straight in. */
  function alignTriplet(objsA, objsB, objsC, opts) {
    opts = opts || {};
    var key = opts.key || 'tMin', val = opts.val || 'v';
    function toMap(objs) {
      var m = new Map();
      (objs || []).forEach(function (o) {
        if (o && _finite(o[key]) && _finite(o[val])) m.set(o[key], o[val]);
      });
      return m;
    }
    var mA = toMap(objsA), mB = toMap(objsB), mC = toMap(objsC);
    var keys = [];
    mA.forEach(function (_, k) { if (mB.has(k) && mC.has(k)) keys.push(k); });
    keys.sort(function (x, y) { return x - y; });
    return {
      keys: keys,
      A: keys.map(function (k) { return mA.get(k); }),
      B: keys.map(function (k) { return mB.get(k); }),
      C: keys.map(function (k) { return mC.get(k); })
    };
  }

  /* ── Pearson correlation over the common finite indices (null if <3 pairs or a
     degenerate/zero-variance member). Used by the decorrelation quality gate. ── */
  function pearson(a, b) {
    var xs = [], ys = [], n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) if (_finite(a[i]) && _finite(b[i])) { xs.push(a[i]); ys.push(b[i]); }
    if (xs.length < 3) return null;
    var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0;
    for (var j = 0; j < xs.length; j++) { var dx = xs[j] - mx, dy = ys[j] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (sxx < EPS || syy < EPS) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  /* ── Decorrelation quality gate (TRIO-METHODS-REUSE §Do 3) ──────────────────
     TCH assumes all three estimators track the SAME latent quantity. If one node is
     a failed extraction (lost contact / mis-detected beats), its series decorrelates
     from the other two and a 3-way solve folds that garbage into EVERY per-sensor σ
     (its large pairwise-difference variances contaminate the closed form), producing a
     confident-looking but meaningless result. This screen catches that case BEFORE the
     solve: a node is droppable iff BOTH its pairwise correlations fall below `minCorr`
     AND the surviving pair still agrees above `keepMinCorr`. Exactly-one → drop it and
     name the trustworthy pair; zero → proceed with the full triplet; two-or-more mutual
     decorrelations → AMBIGUOUS (can't tell which is truth) → don't drop, don't trust.
     PURE (no solve, no mutation). Consumer decides what to do with `drop`. */
  function screenTriplet(seriesA, seriesB, seriesC, opts) {
    opts = opts || {};
    var labels = opts.labels || ['A', 'B', 'C'];
    var minCorr = opts.minCorr != null ? opts.minCorr : 0.2;
    var keepMinCorr = opts.keepMinCorr != null ? opts.keepMinCorr : 0.4;
    if (!seriesA || !seriesB || !seriesC) return { ok: false, drop: null, reason: 'need three series' };
    var rAB = pearson(seriesA, seriesB), rAC = pearson(seriesA, seriesC), rBC = pearson(seriesB, seriesC);
    var corr = { AB: rAB, AC: rAC, BC: rBC };
    if (rAB == null || rAC == null || rBC == null)
      return { ok: false, drop: null, corr: corr, reason: 'insufficient overlap / degenerate series for the correlation screen' };
    // each node's two correlations, and the correlation of the OTHER pair if it is dropped
    var pairCorr = { A: [rAB, rAC], B: [rAB, rBC], C: [rAC, rBC] };
    var keptIfDropped = { A: rBC, B: rAC, C: rAB };
    var keys = ['A', 'B', 'C'];
    var cand = keys.filter(function (k) { return pairCorr[k][0] < minCorr && pairCorr[k][1] < minCorr; });
    if (cand.length === 0)
      return { ok: true, drop: null, corr: corr, reason: 'every node correlates with ≥one peer above ' + minCorr };
    if (cand.length >= 2)
      return { ok: false, drop: null, ambiguous: true, corr: corr,
               reason: cand.length + ' nodes mutually decorrelate — cannot identify the reliable pair' };
    var k = cand[0], keptR = keptIfDropped[k];
    var lbl = labels[keys.indexOf(k)];
    if (keptR == null || keptR < keepMinCorr)
      return { ok: false, drop: null, corr: corr,
               reason: 'candidate ' + lbl + ' decorrelates but the surviving pair also disagrees (r=' + (keptR == null ? '—' : keptR.toFixed(2)) + ') — not dropped' };
    var keptPair = keys.filter(function (x) { return x !== k; }).map(function (x) { return labels[keys.indexOf(x)]; });
    return { ok: true, drop: lbl, keptPair: keptPair, corr: corr,
             reason: 'node ' + lbl + ' decorrelates from both peers (r<' + minCorr + '); ' + keptPair[0] + '–' + keptPair[1] + ' agree (r=' + keptR.toFixed(2) + ')' };
  }

  var API = {
    threeCorneredHat: threeCorneredHat,
    alignTriplet: alignTriplet,
    screenTriplet: screenTriplet,
    pearson: pearson,
    inverseVarianceWeights: inverseVarianceWeights,
    pairDiffVar: pairDiffVar,
    classic: classic,
    correlated: correlated,
    allanDeviation: allanDeviation,
    allanTriplet: allanTriplet,
    variance: variance, mean: mean,
    VERSION: '1.2.0'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.IntegratorTCH = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
