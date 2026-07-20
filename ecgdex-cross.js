/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Dex Suite · CROSS-NIGHT ANALYTICS ENGINE  (ecgdex-cross.js)
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
   Exposes window.ECGCross. Math is IDENTICAL to ppgdex-cross.js (suite convention: duplicated locally, not a shared module).
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
    if (n < 2) return { n, mean: n ? r2(pts[0].v) : null, sd: null, cv: null, slopePerDay: null, slopePerRecording: null, slopeBasis: null, tau: null, p: null, zLatest: null, trendLabel: '—' };
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
      slopePerRecording = null,
      r2date = null;
    if (haveT) {
      const days = pts.map((p) => (p.t - pts[0].t) / 86400000);
      const od = ols(days, vals, w);
      slopePerDay = r2(od.slope);
      r2date = r2(od.r2);
    } else {
      /* DEEP-AUDIT-II §9.4 — an INDEX slope is not a PER-DAY slope, and must not be shipped under the
         per-day name. This branch runs when even ONE item lacks a date, and it used to assign
         `byIdx.slope` — change per RECORDING — straight to `slopePerDay`, which every consumer renders
         with a `/d` suffix. A 12-recording series spanning 90 days then reported its per-recording
         change as a daily one: ~7.5x overstated, and always in the alarming direction, since the same
         delta compressed into a shorter apparent window looks steeper.
         Same rule §8.4 already applied to the footer span: report the real quantity when it is
         knowable, and say what you actually have when it is not — never present one as the other.
         So the per-day figure is null here (honestly unavailable), the index slope keeps its own
         honest name, and `slopeBasis` tells the consumer which it is holding. */
      slopePerDay = null;
      slopePerRecording = byIdx.slope != null ? r2(byIdx.slope) : null;
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
    /* DEEP-AUDIT-II §9.3 — the label's DIRECTION and its SIGNIFICANCE must come from the SAME test.
       `rising` was taken from the OLS slope while `signif` came from Mann–Kendall, so the sentence
       "there is a significant trend, and it is improving" was assembled from two different
       estimators. They disagree exactly where it matters: MK is rank-based and robust, OLS is
       leverage-sensitive, so a single endpoint outlier flips the slope without moving τ — the audit
       measured "improving" printed beside τ = −0.6 on 10.3 % of endpoint-outlier series.
       Direction now comes from τ, the same statistic that decided the trend was real. `slopePerDay`
       is still reported separately as the magnitude — this changes which estimator names the
       DIRECTION, not what OLS is for.
       When the two disagree in sign the series has endpoint leverage worth knowing about, so it is
       reported rather than silently resolved. */
    let trendLabel = 'stable';
    const rising = (mk.tau || 0) > 0; // §9.3 — direction from the significance test, not OLS
    const olsRising = (byIdx.slope || 0) > 0;
    const dirDisagree = !!(mk.tau && byIdx.slope) && rising !== olsRising;
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
      slopePerRecording,
      slopeBasis: haveT ? 'day' : 'recording',
      r2: byIdx.r2 != null ? r2(byIdx.r2) : null,
      r2date,
      tau: mk.tau,
      p: mk.p,
      trendDirDisagree: dirDisagree, // §9.3 — OLS slope and Mann-Kendall τ point opposite ways (endpoint leverage)
      zLatest,
      baselineMean,
      baselineSd,
      deltaHalves: boot.delta,
      ci: boot.ci,
      trendLabel
    };
  }

  // build the export crossNight block from a list of ECGDex result objects
  // Clock Contract — floating tMs displayed via getUTC* (viewer-timezone-independent)
  function _p2(x) {
    return (x < 10 ? '0' : '') + x;
  }
  function fmtDateUTC(ms) {
    if (ms == null) return null;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + _p2(d.getUTCMonth() + 1) + '-' + _p2(d.getUTCDate());
  }
  function fmtDateTimeUTC(ms) {
    if (ms == null) return '—';
    const d = new Date(ms);
    return fmtDateUTC(ms) + ' ' + _p2(d.getUTCHours()) + ':' + _p2(d.getUTCMinutes());
  }
  const qtcOf = (s) => (s.morph && s.morph.delin && s.morph.delin.valid ? s.morph.delin.qtcBazett : null);
  // ENVELOPE-FOLLOWUPS-V §2: each metric self-describes its `evidence` tier (sourced from
  // ecgdex-registry.js) so the Integrator Longitudinal view BADGES the crossnight trend/coupling
  // cards (evBadge reads metrics{}.evidence; an ungraded metric renders unbadged — a COVERAGE-MANDATE
  // gap). Tiers mirror the registry exactly: rMSSD/SDNN/ln rMSSD/QTc validated · Mean HR measured ·
  // DFA α1/CVHR index/Decel. capacity emerging.
  // REGISTRY-PROJECTION Phase 2 (array-node residue): hoisted to module scope + exported as ECG_DEFS
  // below so `registry-defs-parity` can gate it against ECG_REGISTRY. It was function-local, which is
  // why that gate could only ⊘ SKIP. Read-only here — CrossNightEnvelope.build never mutates it.
  const METRICS = [
    { id: 'rmssd', label: 'rMSSD', unit: 'ms', goodDirection: 'up', evidence: 'validated', get: (s) => s.dispRm },
    { id: 'sdnn', label: 'SDNN', unit: 'ms', goodDirection: 'up', evidence: 'validated', get: (s) => s.dispSd },
    { id: 'lnRMSSD', label: 'ln rMSSD', unit: '', goodDirection: 'up', evidence: 'validated', get: (s) => s.lnrmssd },
    { id: 'hr', label: 'Mean HR', unit: 'bpm', goodDirection: 'down', evidence: 'measured', get: (s) => s.dispHr },
    { id: 'dfaAlpha1', label: 'DFA α1', unit: '', goodDirection: 'up', evidence: 'emerging', get: (s) => s.dfa1 },
    { id: 'qtc', label: 'QTc', unit: 'ms', goodDirection: 'down', evidence: 'validated', get: qtcOf },
    { id: 'cvhrIndex', label: 'CVHR index', unit: '/h', goodDirection: 'down', evidence: 'emerging', get: (s) => (s.longRec && !s.ambulatory ? s.cvhr.index : null) },
    { id: 'decelCapacity', label: 'Decel. capacity', unit: 'ms', goodDirection: 'up', evidence: 'emerging', get: (s) => s.dc }
  ];
  // id-keyed projection of METRICS — the shape `registry-defs-parity` reads (it iterates Object.keys and
  // falls back to REG[defId] when idForLabel misses). Same objects, no second source of truth.
  const ECG_DEFS = METRICS.reduce((o, m) => {
    o[m.id] = m;
    return o;
  }, {});

  // build the cross-night EXPORT block from a list of ECGDex result objects.
  // MIGRATED to the standardized ganglior.crossnight v1.0 envelope via the shared
  // CrossNightEnvelope.build (shape only). The MATH is still ECGDex's local
  // crossNight() — injected into the builder — so numbers are unchanged.
  // Falls back to the legacy {doc,metrics,nights} block if the shared builder
  // isn't present (e.g. a partial bundle).
  function crossNightBlock(list) {
    if (global.CrossNightEnvelope) {
      return global.CrossNightEnvelope.build({
        node: 'ECGDex',
        nodeVersion: '1.1',
        unit: 'recording',
        items: list,
        t0Of: (s) => s.t0Ms,
        weightOf: (s) => Math.max(0.05, (s.analyzablePct || 0) / 100),
        crossNight: crossNight,
        metrics: METRICS
      });
    }
    // ── legacy fallback (pre-envelope shape) ──
    const sorted = [...list].sort((a, b) => (a.t0Ms || 0) - (b.t0Ms || 0));
    const cov = sorted.map((s) => Math.max(0.05, (s.analyzablePct || 0) / 100));
    const out = { doc: 'night-to-night robust stats — same crossNight() engine as PpgDex/OxyDex', metrics: {} };
    for (const m of METRICS) {
      const ser = sorted.map((s, i) => ({ x: i, t: s.t0Ms, v: m.get(s), w: cov[i] }));
      out.metrics[m.id] = crossNight(ser, { good: m.goodDirection });
    }
    out.nights = sorted.map((s) => ({ t0Ms: s.t0Ms, date: fmtDateUTC(s.t0Ms), analyzablePct: s.analyzablePct, rmssd: s.dispRm, sdnn: s.dispSd, hr: s.dispHr, dfaAlpha1: s.dfa1, qtc: qtcOf(s) }));
    return out;
  }

  global.ECGCross = { crossNight, crossNightBlock, ols, mannKendall, bootstrapDeltaCI, fmtDateUTC, fmtDateTimeUTC, METRICS, ECG_DEFS };
})(window);
