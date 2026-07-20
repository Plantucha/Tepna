/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Ganglior · CROSS-NIGHT ENVELOPE  (crossnight-envelope.js)
   ────────────────────────────────────────────────────────────────────────
   The ONE shared piece in the cross-night system: the standardized, versioned
   *shape* (ganglior.crossnight v1.0) that every node emits and the Integrator
   reads. See CROSSNIGHT-ENVELOPE-SPEC.md.

   Design rule (important): this file standardizes the CONTAINER, not the MATH.
   The statistics engine `crossNight()` stays duplicated locally per node
   (suite convention — like parseTimestamp). `build()` is DEPENDENCY-INJECTED
   with the caller's local crossNight fn + raw-value getters, so adopting the
   envelope changes no node's numbers — only how they're packaged.

       crossNight(series, opts)      → MATH   → local per node (unchanged)
       CrossNightEnvelope.build(...) → SHAPE  → this file (shared)

   Exposes window.CrossNightEnvelope = { build, validate, ENGINE_VERSION, SHAPE_VERSION }.
   Pure; no DOM; no deps.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const SHAPE_VERSION = '1.0'; // envelope shape (this contract)
  const ENGINE_VERSION = '1.0.0'; // crossNight() algorithm version (suite-wide)

  // ── Clock Contract — floating tMs rendered via getUTC* ──────────────────────
  function _p2(x) {
    return (x < 10 ? '0' : '') + x;
  }
  function fmtDateUTC(ms) {
    if (ms == null || !isFinite(ms)) return null;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + _p2(d.getUTCMonth() + 1) + '-' + _p2(d.getUTCDate());
  }

  function _round(v, d) {
    return v == null || !isFinite(v) ? null : +v.toFixed(d == null ? 2 : d);
  }

  /* ────────────────────────────────────────────────────────────────────────
   build(opts) → ganglior.crossnight v1.0 envelope

   opts = {
     node, nodeVersion,                  // identity strings
     unit,                               // "session" | "recording" | "night"
     items,                              // [] of the node's per-item result objects, ANY order
     t0Of(item)        → floating tMs | null,
     weightOf(item)    → 0..1   (coverage weight; default 1),
     qualityFloorPct,                    // default 50 — below ⇒ lowQuality flag
     coverageWeighted,                   // default true (informational flag in window{})
     metrics: [ { id, label, unit, goodDirection:'up'|'down', get(item)→number|null } ],
     crossNight,                         // the caller's LOCAL crossNight(series,opts) fn (math)
     engineVersion                       // optional override of the local engine's version
   }
   ──────────────────────────────────────────────────────────────────────── */
  function build(opts) {
    opts = opts || {};
    const CN = opts.crossNight;
    if (typeof CN !== 'function') throw new Error('CrossNightEnvelope.build: opts.crossNight (local engine fn) is required');
    const t0Of = opts.t0Of || ((it) => (it && it.t0Ms != null ? it.t0Ms : null));
    const weightOf = opts.weightOf || (() => 1);
    const floor = opts.qualityFloorPct != null ? opts.qualityFloorPct : 50;
    const metricsDef = opts.metrics || [];

    // sort items ascending by floating t0Ms (items with no t0 sort last, stable)
    const items = (opts.items || [])
      .slice()
      .map((it, origIdx) => ({ it, t0: t0Of(it), origIdx }))
      .sort((a, b) => (a.t0 == null) - (b.t0 == null) || (a.t0 || 0) - (b.t0 || 0) || a.origIdx - b.origIdx);

    const n = items.length;
    const t0s = items.map((x) => x.t0).filter((v) => v != null);
    const firstT0 = t0s.length ? t0s[0] : null,
      lastT0 = t0s.length ? t0s[t0s.length - 1] : null;

    // per-item weight + quality flag
    const weights = items.map((x) => {
      const w = weightOf(x.it);
      return w == null || !isFinite(w) ? 1 : Math.max(0.05, Math.min(1, w));
    });
    const lowQ = weights.map((w) => w * 100 < floor);

    // ── metrics block ──
    const metrics = {};
    metricsDef.forEach((m) => {
      const series = items.map((x, i) => ({ x: i, t: x.t0, v: _safe(m.get(x.it)), w: weights[i] })).filter((p) => p.v != null);
      const st = CN(series, { good: m.goodDirection || 'up' }); // ← local node math, untouched
      metrics[m.id] = _shapeMetric(m, st);
    });

    // ── series block (raw provenance for the Integrator to re-align/re-derive) ──
    const series = items.map((x, i) => {
      const values = {};
      metricsDef.forEach((m) => {
        const v = _safe(m.get(x.it));
        if (v != null) values[m.id] = v;
      });
      return { i, t0Ms: x.t0, date: fmtDateUTC(x.t0), weight: _round(weights[i], 3), lowQuality: lowQ[i], values };
    });

    // ── ranked headline callouts (|z| × significance) ──
    const cand = [];
    metricsDef.forEach((m) => {
      const M = metrics[m.id];
      if (!M) return;
      const z = M.baseline && M.baseline.zLatest;
      if (z != null && Math.abs(z) >= DexKernel.K.Z_HEADLINE) cand.push({ score: Math.abs(z), txt: `${m.label} ${z > 0 ? '+' : ''}${z}σ vs your ${M.n}-night baseline` });
      if (M.change && M.change.significant)
        cand.push({
          score: 2.0 + Math.abs(M.change.deltaFirstHalfToSecond || 0) / 10,
          txt: `${m.label} shifted ${M.change.deltaFirstHalfToSecond > 0 ? '+' : ''}${M.change.deltaFirstHalfToSecond}${m.unit || ''} (95% CI excludes 0)`
        });
    });
    const headline = cand
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((c) => c.txt);

    return {
      schema: {
        name: 'ganglior.crossnight',
        version: SHAPE_VERSION,
        engine: 'crossNight',
        engineVersion: opts.engineVersion || ENGINE_VERSION,
        node: opts.node || 'unknown',
        nodeVersion: opts.nodeVersion || '1.0',
        generated: new Date().toISOString()
      },
      window: {
        unit: opts.unit || 'session',
        count: n,
        firstT0Ms: firstT0,
        lastT0Ms: lastT0,
        spanDays: firstT0 != null && lastT0 != null ? _round((lastT0 - firstT0) / 86400000, 2) : null,
        coverageWeighted: opts.coverageWeighted !== false,
        qualityFloorPct: floor,
        lowQualityCount: lowQ.filter(Boolean).length
      },
      metrics,
      series,
      headline
    };
  }

  function _safe(v) {
    return v == null || (typeof v === 'number' && !isFinite(v)) ? null : v;
  }

  // map a raw crossNight() stats object → the contract's nested metric shape
  function _shapeMetric(m, st) {
    st = st || {};
    const zFlag = ((z) => {
      if (z == null) return null;
      if (z <= -2) return 'below-2sigma';
      if (z >= 2) return 'above-2sigma';
      if (z <= -1) return 'below-1sigma';
      if (z >= 1) return 'above-1sigma';
      return null;
    })(st.zLatest);
    const label = st.n != null && st.n < 3 ? 'insufficient' : st.trendLabel || 'stable';
    const change =
      st.n != null && st.n >= 7 && st.deltaHalves != null ? { deltaFirstHalfToSecond: st.deltaHalves, ci95: st.ci || null, significant: !!(st.ci && (st.ci[0] > 0 || st.ci[1] < 0)) } : null;
    return {
      label: m.label,
      unit: m.unit || '',
      goodDirection: m.goodDirection || 'up',
      evidence: m.evidence || null,
      cite: m.cite || null,
      n: st.n != null ? st.n : 0,
      central: { mean: st.mean, sd: st.sd, median: st.median, iqr: st.iqr, min: st.min, max: st.max, cv: st.cv },
      // §9.3 — dirDisagree rides along: this projection is HAND-PICKED, so a field added to the
      // per-metric stat object is invisible to every consumer until it is named here.
      // §9.4 — `slopeBasis` rides along too, for the same reason the comment above gives: a consumer
      // reading `slopePerDay: null` cannot otherwise tell "no trend" from "the series is undated, so
      // a per-day rate does not exist"; `slopePerRecording` carries the figure that DOES exist.
      trend: {
        slopePerIndex: st.slope,
        slopePerDay: st.slopePerDay,
        slopePerRecording: st.slopePerRecording,
        slopeBasis: st.slopeBasis,
        r2: st.r2,
        r2date: st.r2date,
        mannKendall: { tau: st.tau, p: st.p },
        label,
        dirDisagree: !!st.trendDirDisagree
      },
      change,
      baseline: {
        window: st.n != null && st.n > 1 ? 'prior-' + (st.n - 1) : null,
        mean: _safe(st.baselineMean),
        sd: _safe(st.baselineSd),
        zLatest: st.zLatest != null ? st.zLatest : null,
        flag: zFlag
      }
    };
  }

  /* ────────────────────────────────────────────────────────────────────────
   validate(env) → { ok, errors:[], warnings:[] }
   Structural conformance check (spec §6). Cheap; safe for consumers to gate on.
   ──────────────────────────────────────────────────────────────────────── */
  function validate(env) {
    const errors = [],
      warnings = [];
    const E = (c, msg) => {
      if (!c) errors.push(msg);
    };
    const W = (c, msg) => {
      if (!c) warnings.push(msg);
    };
    E(env && typeof env === 'object', 'envelope is not an object');
    if (!env || typeof env !== 'object') return { ok: false, errors, warnings };
    const s = env.schema || {};
    E(s.name === 'ganglior.crossnight', 'schema.name must be "ganglior.crossnight"');
    E(typeof s.version === 'string', 'schema.version missing');
    E(s.version && s.version.split('.')[0] === '1', 'unsupported major version (expected 1.x)');
    E(typeof s.engineVersion === 'string', 'schema.engineVersion missing (cannot compare trends safely)');
    E(env.window && typeof env.window === 'object', 'window block missing');
    E(env.metrics && typeof env.metrics === 'object', 'metrics block missing');
    E(Array.isArray(env.series), 'series must be an array');
    // per-metric checks
    Object.keys(env.metrics || {}).forEach((id) => {
      const m = env.metrics[id];
      E(m.label != null && m.unit != null, `metric "${id}" missing label/unit`);
      E(m.goodDirection === 'up' || m.goodDirection === 'down', `metric "${id}" goodDirection must be up|down`);
      E(m.trend && m.trend.mannKendall, `metric "${id}" missing trend.mannKendall`);
      W(!(m.n >= 7) || m.change != null, `metric "${id}" n≥7 but change block is null`);
      W(!(m.n < 7) || m.change == null, `metric "${id}" n<7 but change block present (should be null)`);
      if (m.n != null && m.n < 3) W(m.trend.label === 'insufficient', `metric "${id}" n<3 should label trend "insufficient"`);
    });
    // floating-clock sanity: series dates must match a getUTC* render of t0Ms
    (env.series || []).forEach((it, i) => {
      if (it.t0Ms != null) W(it.date === fmtDateUTC(it.t0Ms), `series[${i}].date is not a getUTC* render of t0Ms (Clock Contract)`);
    });
    return { ok: errors.length === 0, errors, warnings };
  }

  /* ────────────────────────────────────────────────────────────────────────
   validateNodeExport(json) → { ok, errors, warnings }
   Structural conformance for a NODE export (schema.name "ganglior.node-export";
   contract = Clock Contract §6 + EEGDEX brief). Advisory: consumers read by
   structure and should NEVER hard-reject on this — errors are precise diagnostics,
   not gates. FORWARD-COMPATIBLE: an unknown major schema.version is a WARNING, not
   an error (a v3 export with the same shape still ingests). Mirrors validate()'s style.
   ──────────────────────────────────────────────────────────────────────── */
  function validateNodeExport(json) {
    const errors = [],
      warnings = [];
    const E = (c, msg) => {
      if (!c) errors.push(msg);
    };
    const W = (c, msg) => {
      if (!c) warnings.push(msg);
    };
    E(json && typeof json === 'object', 'export is not an object');
    if (!json || typeof json !== 'object') return { ok: false, errors, warnings };
    const s = json.schema || {};
    E(s.name === 'ganglior.node-export', 'schema.name should be "ganglior.node-export"');
    E(typeof (s.node || json.node) === 'string', 'schema.node (or top-level node) missing');
    W(typeof s.version === 'string', 'schema.version missing');
    W(typeof s.version !== 'string' || s.version.split('.')[0] === '2', 'unknown major schema.version "' + s.version + '" — reading by structure (forward-compatible)');
    const bus = json.bus != null ? json.bus : s.bus;
    W(bus == null || /^(ganglior|fascia)$/i.test(String(bus)), 'unrecognized bus "' + bus + '" — accepted case-insensitively (never a reject reason)');
    // events: ganglior_events → fascia_events → events (same order the Integrator reads)
    const evs = Array.isArray(json.ganglior_events) ? json.ganglior_events : Array.isArray(json.fascia_events) ? json.fascia_events : Array.isArray(json.events) ? json.events : null;
    W(evs != null, 'no ganglior_events[] — nothing to fuse (a metrics-only summary export is valid but contributes no events)');
    // clock placement: needs a floating t0 OR events carrying absolute tMs
    const t0 = json.recording && json.recording.startEpochMs != null ? json.recording.startEpochMs : json.startEpochMs != null ? json.startEpochMs : json.t0Ms;
    const hasAbs = Array.isArray(evs) && evs.some((e) => e && typeof e.tMs === 'number');
    W(typeof t0 === 'number' || hasAbs, 'no recording.startEpochMs and no event carries absolute tMs — events cannot be placed on the clock (date unknown, never fabricated)');
    (Array.isArray(evs) ? evs : []).forEach((e, i) => {
      E(e && typeof e === 'object', 'ganglior_events[' + i + '] is not an object');
      if (!e || typeof e !== 'object') return;
      E(typeof e.impulse === 'string' && e.impulse !== '', 'ganglior_events[' + i + '] missing impulse');
      E(typeof e.t === 'string' || typeof e.tMs === 'number', 'ganglior_events[' + i + '] needs t "HH:MM:SS" or absolute tMs');
      W(e.conf == null || (typeof e.conf === 'number' && e.conf >= 0 && e.conf <= 1), 'ganglior_events[' + i + '] conf should be 0..1 or null');
      W(typeof e.t !== 'string' || /^\d{1,2}:\d{2}(:\d{2})?$/.test(e.t), 'ganglior_events[' + i + '] t "' + e.t + '" is not HH:MM[:SS]');
    });
    return { ok: errors.length === 0, errors, warnings };
  }

  global.CrossNightEnvelope = { build, validate, validateNodeExport, SHAPE_VERSION, ENGINE_VERSION, fmtDateUTC };
})(window);
