/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · CROSS-NIGHT ANALYTICS ENGINE  (cpapdex-cross.js)
   ────────────────────────────────────────────────────────────────────────
   ONE pure helper, duplicated locally per app (suite convention — same math as
   oxydex-cross.js / ppgdex-cross.js / ecgdex-cross.js, BYTE-IDENTICAL crossNight
   so the P12 cross-Dex drift gate holds). Computes, across loaded nights, per
   outcome metric:
     1. central tendency + spread (n, mean, SD, median, IQR, min/max, CV%)
     2. trend — OLS slope vs night-index AND vs real date (uneven gaps), R²,
        + a Mann–Kendall non-parametric test (τ, p) for short series
     3. significance — n≥7 first-half vs second-half delta + bootstrap 95% CI
     4. personal baseline + per-night z-scores (|z|≥Z_HEADLINE flagged)
     5. coverage-weighting (each night weighted by therapy-hour completeness)

   CPAP trend metrics are OUTCOMES with a clear good-direction — residual AHI,
   usage hours, large-leak %, central-apnea index, and ODI (only the nights an
   oximeter was attached). Delivered PRESSURE is a therapy SETTING, not an
   outcome, so it is deliberately NOT trended here (a rising pressure is not
   "worse"). Input series = [{ x:nightIdx, t:t0Ms, v:value, w:coverageWeight }].
   Clock Contract: t0Ms is floating; dates rendered via getUTC*.
   Exposes window.CPAPCross.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // Physiology-kernel constants. In a bundle/browser realm kernel-constants.js is already
  // co-loaded and DexKernel is a global. Under CommonJS nothing has loaded it, so pull it
  // in for its side effect — it self-registers on globalThis (it is already dual-realm) —
  // which makes the bare `DexKernel` reads below resolve. Without this, requiring this
  // module threw and buildLongitudinal() silently produced crossNight:null (brief §F5).
  // CrossNightEnvelope stays OPTIONAL: it is behind a truthiness guard and simply absent
  // under CommonJS, which selects the local (non-envelope) code path by design.
  if (typeof DexKernel === 'undefined' && typeof require !== 'undefined') {
    try {
      require('./kernel-constants.js');
    } catch (_e) {
      /* browser/bundle realm — already global */
    }
  }

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
      const prior = vals.slice(0, n - 1);
      const pm = mean(prior),
        psRaw = sd(prior);
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

  // ── Clock Contract — floating tMs displayed via getUTC* ──
  function _p2(x) {
    return (x < 10 ? '0' : '') + x;
  }
  function fmtDateUTC(ms) {
    if (ms == null) return null;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + _p2(d.getUTCMonth() + 1) + '-' + _p2(d.getUTCDate());
  }

  // night-level ODI = desats POOLED over analyzed hours across available-oximeter sessions (null if
  // no oximeter that night). NOT a mean of the per-session rates — that would let a 40-minute nap
  // weigh as much as a 6-hour sleep. Same arithmetic as residualAHI. DEEP-AUDIT §20.
  function nightOdi(n) {
    if (!n.sessions) return null;
    var live = n.sessions.filter(function (s) {
      return s.oximetry && s.oximetry.available && s.oximetry.odi != null;
    });
    if (!live.length) return null;
    var desats = 0,
      hours = 0;
    live.forEach(function (s) {
      var o = s.oximetry;
      if (o.desatCount != null && o.analyzedHours) {
        desats += o.desatCount;
        hours += o.analyzedHours;
      }
    });
    // 2 dp — the same precision the lane and the cross-metrics report ODI at (an unrounded quotient
    // would ship 5.99880023995201 into the crossnight series for what is a 6.00 /hr night).
    if (hours > 0) return +(desats / hours).toFixed(2);
    // LEGACY session objects (no lane denominators recorded) — fall back to the per-session rate,
    // which is exact for the single-session case and only approximate when several are pooled.
    var sum = 0;
    live.forEach(function (s) {
      sum += s.oximetry.odi;
    });
    return sum / live.length;
  }
  // CPAPDex outcome metric defs — each an OUTCOME with a clear good-direction.
  var CPAP_DEFS = {
    residualAHI: {
      good: 'down',
      label: 'Residual AHI',
      unit: '/hr',
      evidence: 'measured',
      get: function (n) {
        return n.metrics ? n.metrics.residualAHI : null;
      }
    },
    usageHours: {
      good: 'up',
      label: 'Usage Hours',
      unit: 'hr',
      evidence: 'measured',
      get: function (n) {
        return n.therapyHours != null ? n.therapyHours : n.metrics ? n.metrics.usageHours : null;
      }
    },
    largeLeakPct: {
      good: 'down',
      label: 'Large Leak %',
      unit: '%',
      evidence: 'validated',
      get: function (n) {
        return n.metrics ? n.metrics.largeLeakPct : null;
      }
    },
    centralIndex: {
      good: 'down',
      label: 'Central Apnea Index',
      unit: '/hr',
      evidence: 'measured',
      get: function (n) {
        return n.metrics ? n.metrics.centralIndex : null;
      }
    },
    odi: { good: 'down', label: 'ODI', unit: '/hr', evidence: 'validated', get: nightOdi },
    // -III §1: device-scored PERIODIC-BREATHING burden (% therapy in CSL Cheyne-Stokes/PB spans) so the
    // Integrator Longitudinal view trends PB across nights + couples it against residualAHI/centralIndex/etc.
    // The generic ganglior.crossnight ingester picks it up with no Integrator code. MEASURED per
    // cpapdex-registry — firmware-scored CSL annotation, a direct device read.
    periodicBreathingPct: {
      good: 'down',
      label: 'Periodic Breathing',
      unit: '%',
      evidence: 'measured',
      cite: '% therapy in CSL Cheyne-Stokes/PB spans — device-scored',
      get: function (n) {
        return n.metrics ? n.metrics.periodicBreathingPct : null;
      }
    }
  };
  function nightTms(n) {
    return n && n.t0Ms != null ? n.t0Ms : null;
  }
  // weight each night by therapy-hour completeness (a 40-min session weighs less than a full night)
  function nightWeight(n) {
    var h = n.therapyHours != null ? n.therapyHours : n.metrics ? n.metrics.usageHours : null;
    return h != null ? Math.max(0.05, Math.min(1, h / 6)) : 1;
  }

  // build the cross-night EXPORT block via the shared CrossNightEnvelope (shape only;
  // math is CPAPDex's local crossNight). nightsChrono = ascending by time.
  function crossNightBlock(nightsChrono) {
    var block;
    if (global.CrossNightEnvelope) {
      block = global.CrossNightEnvelope.build({
        node: 'CPAPDex',
        nodeVersion: '1.0',
        unit: 'night',
        items: nightsChrono,
        t0Of: nightTms,
        weightOf: nightWeight,
        crossNight: crossNight,
        metrics: Object.keys(CPAP_DEFS).map(function (id) {
          var d = CPAP_DEFS[id];
          return { id: id, label: d.label, unit: d.unit, goodDirection: d.good, evidence: d.evidence, cite: d.cite, get: d.get };
        })
      });
    } else {
      // legacy fallback (pre-envelope shape)
      block = { doc: 'night-to-night robust stats — same crossNight() engine as the rest of the suite', metrics: {} };
      for (var k in CPAP_DEFS) {
        var d = CPAP_DEFS[k];
        var ser = nightsChrono.map(function (n, i) {
          return { x: i, t: nightTms(n), v: d.get(n), w: nightWeight(n) };
        });
        block.metrics[k] = crossNight(ser, { good: d.good });
      }
    }
    // FOLLOWUPS-II §P8 — device-SETTING change-points. crossNight() above deliberately does NOT trend
    // delivered PRESSURE (a setting, not an outcome), and classifyModeLongitudinal medians over ≥7 nights
    // (smooths a step), so a real EPAP/pressure step is structurally invisible to the trend metrics. This
    // additive block flags it via robust L1 binary segmentation. Empty array ⇒ no setting change detected;
    // consumers that ignore the field are unaffected (additive, not a contract change).
    block.pressureChangePoints = ['epap95', 'pressureEnvIqr'].reduce(function (acc, metric) {
      var pser = nightsChrono.map(function (n, i) {
        return { x: i, t: nightTms(n), v: n && n.metrics ? n.metrics[metric] : null };
      });
      return acc.concat(pressureChangePoints(pser, { metric: metric }));
    }, []);
    return block;
  }

  /* compliancePct — % of nights meeting ≥4 h usage (CMS-style adherence) over the
   loaded window. Separate from the per-metric trends (it's an aggregate count). */
  function compliancePct(nights, thresholdH) {
    thresholdH = thresholdH == null ? 4 : thresholdH;
    if (!nights || !nights.length) return null;
    var ok = 0;
    nights.forEach(function (n) {
      var h = n.therapyHours != null ? n.therapyHours : n.metrics ? n.metrics.usageHours : 0;
      if (h >= thresholdH) ok++;
    });
    return +((ok / nights.length) * 100).toFixed(1);
  }

  /* ── Cross-night device-SETTING change-point detector (FOLLOWUPS-II §P8 KNOWN GAP) ──
   crossNight() trends OUTCOMES and deliberately excludes delivered pressure (a SETTING). So a real
   device-setting step — e.g. the EPAP-min lowered mid-corpus — is invisible to the longitudinal layer:
   the 5-min P90 envelope PRESERVES the step but nothing FLAGS it. This flags it.

   Algorithm: L1-cost binary segmentation (the canonical robust change-point method), chosen by a 4-way
   bake-off scored against the real 180-night corpus. At each level it scans every split with ≥MINLEN
   nights per side, picks the split minimizing total within-segment L1 cost (Σ|v−median|), and ACCEPTS it
   only if (a) the median step |medL−medR| clears absFloor (an independent step-height guard, in the
   signal's own units) AND (b) the cost drop beats a data-scaled BIC-like penalty PEN_K·gMAD·log(span);
   then recurses into both halves. Median (L1) fit + MAD scale make it immune to the unbalanced-split flaw
   a mean/variance fit suffers on a noisy post-change regime — so on the real corpus it nails the epap95
   step at 2026-06-12 (10.7→6.8) with ZERO false positives AND honestly returns EMPTY on the noise-dominated
   pressureEnvIqr (no fabricated change). series = [{ x, t, v }]; opts.absFloor overrides the step floor. */
  function pressureChangePoints(series, opts) {
    opts = opts || {};
    var MINLEN = 7; // a device setting holds ≥7 nights (same window classifyModeLongitudinal trusts)
    var absFloor = typeof opts.absFloor === 'number' ? opts.absFloor : 1.2;

    // finite values in chronological order (carry the wall-clock stamp for the export)
    var vals = [],
      xs = [],
      ts = [];
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      if (s && typeof s.v === 'number' && isFinite(s.v)) {
        vals.push(s.v);
        xs.push(typeof s.x === 'number' ? s.x : i);
        ts.push(s.t != null ? s.t : null);
      }
    }
    var n = vals.length;
    if (n < 2 * MINLEN) return [];

    function med(arr, lo, hi) {
      var m = arr.slice(lo, hi).sort(function (a, b) {
        return a - b;
      });
      var len = m.length,
        mid = len >> 1;
      return len & 1 ? m[mid] : 0.5 * (m[mid - 1] + m[mid]);
    }
    function l1cost(arr, lo, hi) {
      var c = 0,
        mv = med(arr, lo, hi);
      for (var k = lo; k < hi; k++) c += Math.abs(arr[k] - mv);
      return c;
    }

    // global robust scale (MAD about the global median) for the penalty term
    var gMed = med(vals, 0, n);
    var absdev = [];
    for (var j = 0; j < n; j++) absdev.push(Math.abs(vals[j] - gMed));
    var gMAD = med(absdev, 0, n);
    if (gMAD <= 0) gMAD = 1e-9;
    var PEN_K = 4.0; // sensitivity dial: lower ⇒ noise leaks in, higher ⇒ small real steps missed

    var cps = [];
    function recurse(lo, hi) {
      var span = hi - lo;
      if (span < 2 * MINLEN) return;
      var whole = l1cost(vals, lo, hi);
      var bestDrop = -Infinity,
        bestK = -1;
      for (var k = lo + MINLEN; k <= hi - MINLEN; k++) {
        if (Math.abs(med(vals, lo, k) - med(vals, k, hi)) < absFloor) continue; // step-height guard
        var drop = whole - (l1cost(vals, lo, k) + l1cost(vals, k, hi));
        if (drop > bestDrop) {
          bestDrop = drop;
          bestK = k;
        }
      }
      if (bestK < 0) return;
      if (bestDrop <= PEN_K * gMAD * Math.log(span)) return; // data-scaled BIC-like penalty
      cps.push({ k: bestK, before: med(vals, lo, bestK), after: med(vals, bestK, hi) });
      recurse(lo, bestK);
      recurse(bestK, hi);
    }
    recurse(0, n);

    cps.sort(function (a, b) {
      return a.k - b.k;
    });
    var out = [];
    for (var c = 0; c < cps.length; c++) {
      var kk = cps[c].k;
      var nextK = c + 1 < cps.length ? cps[c + 1].k : n;
      out.push({
        nightIdx: xs[kk],
        tMs: ts[kk],
        dateUTC: fmtDateUTC(ts[kk]),
        metric: opts.metric || null,
        before: +cps[c].before.toFixed(2),
        after: +cps[c].after.toFixed(2),
        delta: +(cps[c].after - cps[c].before).toFixed(2),
        direction: cps[c].after < cps[c].before ? 'down' : 'up',
        holdNights: nextK - kk
      });
    }
    return out;
  }

  var api = { crossNight, crossNightBlock, pressureChangePoints, compliancePct, ols, mannKendall, bootstrapDeltaCI, fmtDateUTC, CPAP_DEFS, nightTms, nightWeight, nightOdi };

  // Dual-realm, matching the house pattern already used by cpapdex-dsp.js / -edf.js /
  // -fusion.js. This file used to close over a bare `window` and expose NOTHING to
  // CommonJS, so `require('./cpapdex-cross.js')` THREW ("window is not defined") — which
  // is why buildLongitudinal() handed back crossNight:null in every Node realm, silently
  // (brief §F5). Browser behaviour is unchanged: global.CPAPCross is still set.
  //
  // `globalThis` (not null) is passed in Node because the body does bare `global.X`
  // feature lookups (CrossNightEnvelope): it needs a real object on which the optional
  // dependency is simply absent, so the existing truthiness guard does its job.
  if (global) global.CPAPCross = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
