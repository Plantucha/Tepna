/* ═════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Dex Suite · CROSS-DAY ANALYTICS ENGINE  (glucodex-cross.js)
   ───────────────────────────────────────────────────────────────────────
   The GlucoDex leg of residue `2026-11-08-three-nodes-emit-no-crossnight-export`:
   HRVDex, GlucoDex and MotionDex emitted no `ganglior.crossnight` envelope, so the
   Integrator longitudinal layer read nothing from them. #4887 added HRVDex. This file
   adds GlucoDex. MotionDex stays open, and the row stays OPEN with it.

   WHY GLUCODEX BEFORE MOTIONDEX. A GlucoDex item is one calendar DAY and `analyze()`
   already folds that series — `perDay(c)` writes it and the result carries it as
   `daily` (glucodex-dsp.js). MotionDex holds no series at all: one file is one
   session and `compute(input)` reads one recording, so MotionDex needs a multi-session
   model before an envelope over it describes anything. The spec names MotionDex `the
   unmitigated case` for that reason.

   The math below is the suite's shared crossNight() engine, duplicated locally per
   node (suite convention — like parseTimestamp). This copy is BYTE-IDENTICAL to the
   region that `pulsedex-cross.js`, `ppgdex-cross.js`, `ecgdex-cross.js` and
   `hrvdex-cross.js` already share, and `tests/dex-tests.js` holds the five against
   each other, so a drift in one of them reds. `oxydex-cross.js` and `cpapdex-cross.js`
   carry their own variants of the same math and stay outside that set. Only the metric
   table, the DEFS projection, the envelope call and the global name differ below.

   GLUCODEX CARRIES NO `clock.js` (CLAUDE.md §✅ — `DexClock` is UNDEFINED in this
   bundle, a ReferenceError and not a fallback). Nothing below reaches it: the engine is
   arithmetic, `crossnight-envelope.js` names `parseTimestamp` only in a comment, and the
   item stamp is the day row's own `startMs`.

   WHY EVERY ITEM WEIGHS THE SAME. The envelope down-weights an item by its coverage
   fraction. A day row states its sample count in `n` and `perDay` already drops a day
   under 6 analysable samples, so the rows that reach here are comparable by
   construction. Turning `n` into a coverage fraction needs a per-day DENOMINATOR, and
   the sensor's own cadence varies within a wear, so that denominator would be a guess.
   Every item weighs 1 and `window.coverageWeighted` reads false. The flag says which it
   is.

   `unit:'day'` extends the three values `crossnight-envelope.js` records in a comment
   (session, recording, night). Nothing reads that field as a vocabulary — no gate
   checks it and the Integrator's `.unit` reads are the METRIC unit — so this file does
   not edit that comment, because `crossnight-envelope.js` is inlined in seven bundles
   and a comment-only edit there moves every carrying bundle's `manifestHash` and
   `computeHash`.

   Exposes window.GluCross = { crossNight, crossNightBlock, ols, mannKendall,
   bootstrapDeltaCI, METRICS, GLU_DEFS }.
   ═════════════════════════════════════════════════════════════════════════ */
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
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; // §9.5 — Math.imul: exact mod-2^32 multiply (bare * reached ~2.3e18 > 2^53 → low bits rounded away → entropy collapse at n≥18)
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

  /* A row field is a number, null, or absent. The engine reads `v` and drops a non-finite one, so
     this reader states the absence once rather than at five call sites. NaN is what the CSV parser
     writes for an unreadable cell, and `0` is a legal rMSSD on a flat trace, so the test is
     finiteness and never truthiness. */
  function _v(x) {
    return x == null || !isFinite(x) ? null : +x;
  }

  /* Each metric self-describes its `evidence` tier so the Integrator Longitudinal view BADGES the
     trend cards (evBadge reads metrics{}.evidence; an ungraded metric renders unbadged — a
     COVERAGE-MANDATE gap). Every field here is COPIED FROM `glucodex-registry.js`, which is the
     source: `registry-defs-parity` holds label, unit, goodDirection and evidence of each id against
     GLU_REGISTRY and reds on a drift, with the registry winning.
     WHAT IS IN THIS TABLE, AND WHY MODD, MAGE AND ADRR ARE NOT. A metric qualifies only if it is
     (a) graded in `glucodex-registry.js` and (b) carried by a `perDay` row, which is the series every
     realm that calls `glucoBuildNodeExport` folds — the app, the Data Unifier, OverDex and the
     headless `GlucoDex.compute` all reach it through `analyze()`. The six below are exactly the
     numeric fields a day row writes. MODD, MAGE, ADRR, CONGA and the AGP bands fail (b): they are
     WHOLE-WEAR metrics computed across days, so a per-day series of them does not exist and a
     cross-day trend over one number is not a trend.
     `perDay` writes `tbr` as the sum of the two below-range bands and `tar` as the sum of the two
     above-range bands, which is what the registry grades as `timeBelow` and `timeAbove`. The ids
     below are the registry's, so the badge and the parity gate read one vocabulary. */
  const METRICS = [
    { id: 'mean', label: 'Mean glucose', unit: 'mg/dL', goodDirection: 'down', evidence: 'measured', get: (r) => _v(r.mean) },
    { id: 'gmi', label: 'GMI', unit: '%', goodDirection: 'down', evidence: 'validated', get: (r) => _v(r.gmi) },
    { id: 'cv', label: 'CV', unit: '%', goodDirection: 'down', evidence: 'validated', get: (r) => _v(r.cv) },
    { id: 'tir', label: 'Time in Range', unit: '%', goodDirection: 'up', evidence: 'validated', get: (r) => _v(r.tir) },
    { id: 'timeBelow', label: 'Time Below', unit: '%', goodDirection: 'down', evidence: 'validated', get: (r) => _v(r.tbr) },
    { id: 'timeAbove', label: 'Time Above', unit: '%', goodDirection: 'down', evidence: 'validated', get: (r) => _v(r.tar) }
  ];
  // id-keyed projection of METRICS — the shape `registry-defs-parity` reads (it iterates Object.keys
  // and falls back to REG[defId] when idForLabel misses). Same objects, no second source of truth.
  const GLU_DEFS = METRICS.reduce((o, m) => {
    o[m.id] = m;
    return o;
  }, {});

  /* Build the cross-day EXPORT block from GlucoDex's per-day rows. Standardized
     `ganglior.crossnight` v1.0 via the shared CrossNightEnvelope.build (SHAPE only) — the MATH is the
     local crossNight() above. A realm without the shared builder gets the legacy shape, the same
     fallback the other five cross modules carry.
     `unit:'day'` — a GlucoDex item is one calendar day of a continuous wear. It is not a `session`,
     because a GlucoDex wear SESSION spans many days and the registry grades it with its own metrics
     (`sessionSpread`, `sessionDrift`). */
  function crossNightBlock(list) {
    if (global.CrossNightEnvelope) {
      return global.CrossNightEnvelope.build({
        node: 'GlucoDex',
        nodeVersion: '1.0',
        unit: 'day',
        items: list,
        t0Of: (r) => (r && isFinite(r.startMs) ? r.startMs : null),
        weightOf: () => 1,
        coverageWeighted: false,
        crossNight: crossNight,
        metrics: METRICS
      });
    }
    // ── legacy fallback (pre-envelope shape) ──
    const sorted = [...list].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    const out = { doc: 'day-to-day robust stats — same crossNight() engine as ECGDex/OxyDex', metrics: {} };
    for (const m of METRICS) {
      const ser = sorted.map((r, i) => ({ x: i, t: r.startMs, v: m.get(r), w: 1 }));
      out.metrics[m.id] = crossNight(ser, { good: m.goodDirection });
    }
    return out;
  }

  global.GluCross = { crossNight, crossNightBlock, ols, mannKendall, bootstrapDeltaCI, METRICS, GLU_DEFS };
})(typeof window !== 'undefined' ? window : globalThis);
