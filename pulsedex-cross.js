/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Dex Suite · CROSS-NIGHT ANALYTICS ENGINE  (pulsedex-cross.js)
   ────────────────────────────────────────────────────────────────────────
   ONE pure helper, duplicated locally per app (suite convention). Shared math
   for PpgDex, ECGDex's new multi-recording trends, AND OxyDex's Multi-Night
   Summary card. Computes, across loaded nights, per metric:
     1. central tendency + spread (n, mean, SD, median, IQR, min/max, CV%)
     2. trend — OLS slope vs night-index AND vs real date (uneven gaps),
        R², and a Mann–Kendall non-parametric test (τ, p) for short series
     3. significance — n≥7 first-half vs second-half delta + bootstrap 95% CI
     4. personal baseline + per-night z-scores (|z|≥2 flagged)
     5. coverage-weighting (each night weighted by analyzable %)
     6. consistency / streaks
   Input: series = [{ x:nightIndex, t:t0Ms, v:value, w:coverageWeight }, …]
   opts.good = 'up' | 'down' (which direction is healthy for this metric).
   Exposes window.PulseCross. Math IDENTICAL to ppgdex/ecgdex/oxydex-cross.js
   (suite convention: duplicated locally per app).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
  const r3 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000);

  function wmean(vals, w) {
    let s = 0,
      sw = 0;
    for (let i = 0; i < vals.length; i++) {
      s += vals[i] * w[i];
      sw += w[i];
    }
    return sw ? s / sw : NaN;
  }
  function mean(a) {
    let s = 0;
    for (const v of a) s += v;
    return a.length ? s / a.length : NaN;
  }
  /* Coverage-WEIGHTED sample SD — the companion wmean always needed (DEEP-AUDIT-II §9.1).
     CV% was `100 * sd(vals) / wmean(vals, w)`: an UNWEIGHTED spread over a WEIGHTED centre, so a
     night the envelope had deliberately down-weighted still contributed its full deviation. On
     routine CPAP partial-use that read 74.6 % where the consistent figure is 49.8 %. It also
     breached the spec in writing — CROSSNIGHT-ENVELOPE-SPEC §3: low-quality items are "down-weighted
     in EVERY fit/aggregate via `weight`". `ols(idx, vals, w)` one line below already passed weights;
     only the spread did not.
     Reliability-weight form: V1 = Σw, V2 = Σw²; s² = Σw(x−m_w)² / (V1 − V2/V1).
     With UNIFORM weights V1 = n and V2 = n, so the denominator is exactly n−1 — it reduces to the
     Bessel-corrected sd() below, bit for bit. That is why every existing fixture holds: the whole
     crossnight suite feeds a uniform weight vector, which is also why this was never exercised. */
  function wsd(vals, w) {
    if (vals.length < 2) return 0;
    const m = wmean(vals, w);
    let V1 = 0,
      V2 = 0,
      acc = 0;
    for (let i = 0; i < vals.length; i++) {
      const wi = w[i];
      V1 += wi;
      V2 += wi * wi;
      const d = vals[i] - m;
      acc += wi * d * d;
    }
    const denom = V1 > 0 ? V1 - V2 / V1 : 0;
    return denom > 0 ? Math.sqrt(acc / denom) : 0;
  }
  function sd(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    let s = 0;
    for (const v of a) {
      const d = v - m;
      s += d * d;
    }
    return Math.sqrt(s / (a.length - 1));
  }
  function median(a) {
    if (!a.length) return NaN;
    const b = [...a].sort((x, y) => x - y),
      n = b.length;
    return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }
  function quantile(a, q) {
    if (!a.length) return NaN;
    const b = [...a].sort((x, y) => x - y),
      p = (b.length - 1) * q,
      lo = Math.floor(p),
      hi = Math.ceil(p);
    return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (p - lo);
  }

  // OLS slope/intercept/R² of y vs x (weighted)
  function ols(x, y, w) {
    const n = x.length;
    if (n < 2) return { slope: null, intercept: null, r2: null };
    let sw = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0,
      syy = 0;
    for (let i = 0; i < n; i++) {
      const wi = w ? w[i] : 1;
      sw += wi;
      sx += wi * x[i];
      sy += wi * y[i];
      sxx += wi * x[i] * x[i];
      sxy += wi * x[i] * y[i];
      syy += wi * y[i] * y[i];
    }
    const den = sw * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return { slope: null, intercept: null, r2: null };
    const slope = (sw * sxy - sx * sy) / den,
      intercept = (sy - slope * sx) / sw;
    const num = sw * sxy - sx * sy;
    const r2v = (num * num) / ((sw * sxx - sx * sx) * (sw * syy - sy * sy) || 1e-12);
    return { slope, intercept, r2: Math.max(0, Math.min(1, r2v)) };
  }

  // Mann–Kendall τ + normal-approx two-sided p
  function mannKendall(y) {
    const n = y.length;
    if (n < 3) return { tau: null, p: null, S: 0 };
    let S = 0;
    for (let i = 0; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) {
        const d = y[j] - y[i];
        S += d > 0 ? 1 : d < 0 ? -1 : 0;
      }
    const varS = (n * (n - 1) * (2 * n + 5)) / 18;
    let z = 0;
    if (S > 0) z = (S - 1) / Math.sqrt(varS);
    else if (S < 0) z = (S + 1) / Math.sqrt(varS);
    const p = 2 * (1 - normCdf(Math.abs(z)));
    const tau = S / (0.5 * n * (n - 1));
    return { tau: r2(tau), p: r3(Math.max(0, Math.min(1, p))), S };
  }
  function normCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
  }
  function erf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }

  // bootstrap 95% CI on (second-half mean − first-half mean)
  function bootstrapDeltaCI(vals) {
    const n = vals.length;
    if (n < 7) return { delta: null, ci: null };
    const half = Math.floor(n / 2);
    const A = vals.slice(0, half),
      B = vals.slice(n - half);
    const delta = mean(B) - mean(A);
    const B_iter = 1000,
      deltas = [];
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let b = 0; b < B_iter; b++) {
      const ra = [],
        rb = [];
      for (let i = 0; i < A.length; i++) ra.push(A[Math.floor(rnd() * A.length)]);
      for (let i = 0; i < B.length; i++) rb.push(B[Math.floor(rnd() * B.length)]);
      deltas.push(mean(rb) - mean(ra));
    }
    deltas.sort((a, b) => a - b);
    return { delta: r2(delta), ci: [r2(quantile(deltas, 0.025)), r2(quantile(deltas, 0.975))] };
  }

  function crossNight(series, opts) {
    opts = opts || {};
    const good = opts.good || 'up';
    const pts = series.filter((p) => p.v != null && isFinite(p.v));
    const n = pts.length;
    if (n < 2) return { n, mean: n ? r2(pts[0].v) : null, sd: null, cv: null, slopePerDay: null, tau: null, p: null, zLatest: null, trendLabel: '—' };
    const vals = pts.map((p) => p.v),
      w = pts.map((p) => (p.w != null ? p.w : 1));
    const idx = pts.map((p, i) => i);
    const m = wmean(vals, w),
      s = wsd(vals, w);
    const med = median(vals),
      iqr = quantile(vals, 0.75) - quantile(vals, 0.25);
    const cv = m !== 0 ? Math.abs((100 * s) / m) : null;
    // OLS vs night index (coverage-weighted)
    const byIdx = ols(idx, vals, w);
    // OLS vs real date (days since first) honours uneven gaps
    const haveT = pts.every((p) => p.t != null);
    let slopePerDay = null,
      r2date = null;
    if (haveT) {
      const days = pts.map((p) => (p.t - pts[0].t) / 86400000);
      const od = ols(days, vals, w);
      slopePerDay = r2(od.slope);
      r2date = r2(od.r2);
    } else {
      slopePerDay = byIdx.slope != null ? r2(byIdx.slope) : null;
    }
    const mk = mannKendall(vals);
    // personal baseline = mean±SD of all-but-latest; z of latest
    let zLatest = null;
    let baselineMean = null,
      baselineSd = null;
    if (n >= 3) {
      /* DEEP-AUDIT-II §9.2 — the personal baseline must carry the SAME weights as the centre it is
         compared against. `central.mean` is wmean(vals, w), but the baseline behind zLatest was
         mean(prior) / sd(prior): UNWEIGHTED. A 6 %-coverage night therefore moved the baseline as
         if it were a full night, and a genuine −2.4σ event on the newest night read as ordinary.
         Spec breach in writing (CROSSNIGHT-ENVELOPE-SPEC §3: low-quality items are "down-weighted
         in EVERY fit/aggregate via `weight`"). Same identity as §9.1: uniform weights reproduce the
         old numbers exactly, which is why every committed fixture holds. */
      const prior = vals.slice(0, n - 1);
      const priorW = w.slice(0, n - 1);
      const pm = wmean(prior, priorW),
        psRaw = wsd(prior, priorW);
      baselineMean = r2(pm);
      // Guard a degenerate (near-zero) baseline spread: dividing by ~0 SD explodes z to
      // absurd magnitudes (±1e8 σ) that overflow the trend card. Floor the SD relative to
      // the baseline mean and clamp the result to a sane display range.
      const psFloor = Math.max(psRaw, 1e-6 * Math.max(1, Math.abs(pm)));
      baselineSd = r1(psFloor);
      let z = (vals[n - 1] - pm) / psFloor;
      if (!isFinite(z)) z = 0;
      zLatest = r2(Math.max(-20, Math.min(20, z)));
    }
    // significance
    const boot = bootstrapDeltaCI(vals);
    // trend label by good-direction + Mann-Kendall significance
    let trendLabel = 'stable';
    const rising = (byIdx.slope || 0) > 0;
    const signif = mk.p != null && mk.p < DexKernel.K.SIGNIF_P && Math.abs(mk.tau || 0) > DexKernel.K.SIGNIF_TAU;
    if (signif) {
      const improving = (good === 'up' && rising) || (good === 'down' && !rising);
      trendLabel = improving ? 'improving' : 'declining';
    }
    return {
      n,
      mean: r2(m),
      sd: r1(s),
      median: r2(med),
      iqr: r1(iqr),
      min: r2(Math.min.apply(null, vals)),
      max: r2(Math.max.apply(null, vals)),
      cv: r1(cv),
      slope: byIdx.slope != null ? r3(byIdx.slope) : null,
      slopePerDay,
      r2: byIdx.r2 != null ? r2(byIdx.r2) : null,
      r2date,
      tau: mk.tau,
      p: mk.p,
      zLatest,
      baselineMean,
      baselineSd,
      deltaHalves: boot.delta,
      ci: boot.ci,
      trendLabel
    };
  }

  // ENVELOPE-FOLLOWUPS-V §2: each metric self-describes its `evidence` tier (sourced from
  // pulsedex-registry.js) so the Integrator Longitudinal view BADGES the crossnight trend/coupling
  // cards (evBadge reads metrics{}.evidence; an ungraded metric renders unbadged — a COVERAGE-MANDATE
  // gap). Tiers mirror the registry exactly: rMSSD/SDNN/ln rMSSD/Baevsky SI validated · Pulse HR
  // measured · DFA α1 emerging · Stress/HRV Score experimental.
  // REGISTRY-PROJECTION Phase 2 (array-node residue): hoisted to module scope + exported as PULSE_DEFS
  // below so `registry-defs-parity` can gate it against PULSE_REGISTRY. It was function-local, which is
  // why that gate could only ⊘ SKIP. Read-only here — CrossNightEnvelope.build never mutates it.
  const METRICS = [
    { id: 'rmssd', label: 'rMSSD', unit: 'ms', goodDirection: 'up', evidence: 'validated', get: (s) => s.dispRm },
    { id: 'sdnn', label: 'SDNN', unit: 'ms', goodDirection: 'up', evidence: 'validated', get: (s) => s.dispSd },
    { id: 'lnRMSSD', label: 'ln rMSSD', unit: '', goodDirection: 'up', evidence: 'validated', get: (s) => s.lnrmssd },
    { id: 'hr', label: 'Pulse HR', unit: 'bpm', goodDirection: 'down', evidence: 'measured', get: (s) => s.dispHr },
    { id: 'stress', label: 'Stress', unit: '', goodDirection: 'down', evidence: 'experimental', get: (s) => s.stress },
    { id: 'hrvScore', label: 'HRV Score', unit: '', goodDirection: 'up', evidence: 'experimental', get: (s) => s.hrv },
    { id: 'dfaAlpha1', label: 'DFA α1', unit: '', goodDirection: 'up', evidence: 'emerging', get: (s) => s.dfa1 },
    { id: 'si', label: 'Baevsky SI', unit: '', goodDirection: 'down', evidence: 'validated', get: (s) => s.si }
  ];
  // id-keyed projection of METRICS — the shape `registry-defs-parity` reads (it iterates Object.keys and
  // falls back to REG[defId] when idForLabel misses). Same objects, no second source of truth.
  const PULSE_DEFS = METRICS.reduce((o, m) => {
    o[m.id] = m;
    return o;
  }, {});

  // build the cross-recording EXPORT block from a list of PulseDex result objects.
  // Standardized ganglior.crossnight v1.0 via the shared CrossNightEnvelope.build
  // (shape only) — MATH is PulseDex's local crossNight(). Falls back to a legacy
  // shape if the shared builder isn't bundled. `unit:'recording'` (PulseDex sessions
  // are daily readings / overnight files, not strictly nights).
  function crossNightBlock(list) {
    if (window.CrossNightEnvelope) {
      return window.CrossNightEnvelope.build({
        node: 'PulseDex',
        nodeVersion: '1.0',
        unit: 'recording',
        items: list,
        t0Of: (s) => s.t0Ms,
        weightOf: (s) => Math.max(0.05, (s.coverage != null ? s.coverage : 100) / 100),
        crossNight: crossNight,
        metrics: METRICS
      });
    }
    // ── legacy fallback (pre-envelope shape) ──
    const sorted = [...list].sort((a, b) => (a.t0Ms || 0) - (b.t0Ms || 0));
    const cov = sorted.map((s) => Math.max(0.05, (s.coverage != null ? s.coverage : 100) / 100));
    const out = { doc: 'recording-to-recording robust stats — same crossNight() engine as ECGDex/OxyDex', metrics: {} };
    for (const m of METRICS) {
      const ser = sorted.map((s, i) => ({ x: i, t: s.t0Ms, v: m.get(s), w: cov[i] }));
      out.metrics[m.id] = crossNight(ser, { good: m.goodDirection });
    }
    return out;
  }

  global.PulseCross = { crossNight, crossNightBlock, ols, mannKendall, bootstrapDeltaCI, METRICS, PULSE_DEFS };
})(window);
