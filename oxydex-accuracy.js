/* ════ OxyDex · Accuracy Harness — OxyAccuracy (oxydex-accuracy.js) ══════════════════════════════════
   Harness machinery for the OxyDex math-correctness validation (Targets 1–2 of the
   reframed accuracy design). NOT shipped metrics: this module exists so the test
   suite can measure how OxyDex's DSP behaves, following the suite's convention
   that measurement lives in a DSP module and tests assert on it.

   Two pure functions, both absence-contract-clean:

     injectBias(series, biasPct)
       Adds biasPct (±) to every measured SpO₂ sample. Results clamp to [0, 100]
       (real sensors saturate; an unclamped +4% on a 98% sample would be a
       non-physical 102%). Null samples stay null — the absence contract holds
       under injection.

     sensitivityReport(baseMetrics, biasedMetrics, biasPct)
       Compares two plain metric objects (as extracted from OxyDex DSP output)
       and returns per-metric deltas, boundary crossings, and masked/phantom
       event counts. This is the DSP-layer consequence of sensor bias: it
       quantifies fragility, it does not make OxyDex robust to bias.

   Layer boundary (the reframe): OxyDex receives SpO₂ from a wearable and computes
   metrics from it. It never sees arterial blood. Validating OxyDex against ABG
   would test the sensor, not the software. These functions test the calculator:
   its arithmetic (Target 1, via the real DSP entry points) and how wrong inputs
   propagate (Target 2, via injectBias + sensitivityReport).

   Dual-mode like the other DSP modules: the IIFE attaches window.OxyAccuracy for
   the classic co-load (both test runners), and the ESM re-export below serves
   the owned bundles. Plain global script otherwise — no imports.
   ══════════════════════════════════════════════════════════════════════════════════ */

(function (/** @type {any} */ root) {
  'use strict';

  var OxyAccuracy = {};

  /* ── injectBias ────────────────────────────────────────────────────────────
     series: array of SpO₂ samples — each element is a number, null, or an
             object with a numeric/null `spo2` field (a DSP row). Objects are
             shallow-copied; the input is never mutated.
     biasPct: the systematic bias to add, in percentage points (e.g. +2, -4).
     Returns a new array. Every measured sample moves by biasPct, clamped to
     [0, 100]. Null (absent) samples are returned as null / with spo2: null —
     bias is never invented for missing data. */

  function clamp100(v) {
    if (v == null) return null;
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    if (v < 0) return 0;
    if (v > 100) return 100;
    return v;
  }

  function biasValue(v, biasPct) {
    if (v == null) return null;
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    return clamp100(v + biasPct);
  }

  OxyAccuracy.injectBias = function (series, biasPct) {
    if (!Array.isArray(series)) return null;
    if (typeof biasPct !== 'number' || Number.isNaN(biasPct)) return null;
    return series.map(function (s) {
      if (s == null) return null;
      if (typeof s === 'number') return biasValue(s, biasPct);
      if (typeof s === 'object' && 'spo2' in s) {
        var copy = {};
        for (var k in s) {
          if (Object.prototype.hasOwnProperty.call(s, k)) copy[k] = s[k];
        }
        copy.spo2 = biasValue(s.spo2, biasPct);
        return copy;
      }
      return null;
    });
  };

  /* ── sensitivityReport ─────────────────────────────────────────────────────
     baseMetrics / biasedMetrics: plain objects of scalar metrics as extracted
       from OxyDex DSP output on the clean and the biased series, e.g.
         { odi3: 8.0, odi4: 3.1, nadir: 91, t90: 5.2, events: [...] }
       Values may be numbers or null. The `events` key, when present, holds an
       array of desaturation events, each with at least `startSec`/`endSec`
       (or an `id`); it is compared separately, not as a scalar.
     biasPct: the bias level that produced biasedMetrics (for the report).
     Returns:
       {
         method: 'injectBias clamp [0,100], nulls preserved; +bias masks, -bias invents',
         biasPct: <number>,
         deltas: { <metric>: { base, biased, absDelta, relDelta, boundaryCross } },
         maskedEvents: [<event ids>],    // in base, gone under +bias
         phantomEvents: [<event ids>],   // absent in base, appear under -bias
         nMasked: <number>, nPhantom: <number>
       }
     Absence rules: absDelta is null when either side is null. relDelta is null
     when base is null, 0, or biased is null — never 0/0 = 0. boundaryCross is
     null when the delta is null. */

  var BOUNDARIES = {
    /* ODI severity bands (/h). Metric names starting with 'odi' use these. */
    odi: [5, 15, 30],
    /* Hypoxemia threshold. */
    nadir: [88],
    minspo2: [88],
    /* Time-below-90% fraction (percent of night). */
    t90: [10]
  };

  function boundaryKey(name) {
    var n = String(name).toLowerCase();
    if (n.indexOf('odi') === 0) return 'odi';
    if (n === 'nadir' || n === 'minspo2' || n === 'min_spo2') return 'nadir';
    if (n === 't90' || n === 'ct90') return 't90';
    return null;
  }

  function crossesBoundary(base, biased, bounds) {
    for (var i = 0; i < bounds.length; i++) {
      var b = bounds[i];
      var baseSide = base < b ? -1 : (base > b ? 1 : 0);
      var biasedSide = biased < b ? -1 : (biased > b ? 1 : 0);
      if (baseSide !== biasedSide) {
        return { boundary: b, from: base, to: biased,
                 direction: biasedSide > baseSide ? 'up' : 'down' };
      }
    }
    return null;
  }

  function eventId(ev, idx) {
    if (ev && (typeof ev.id === 'string' || typeof ev.id === 'number')) return String(ev.id);
    if (ev && ev.startSec != null && ev.endSec != null) return ev.startSec + '-' + ev.endSec;
    if (ev && ev.startIdx != null && ev.endIdx != null) return ev.startIdx + '-' + ev.endIdx;
    return 'idx-' + idx;
  }

  function eventsOverlap(a, b) {
    var a0 = a.startSec != null ? a.startSec : a.startIdx;
    var a1 = a.endSec != null ? a.endSec : a.endIdx;
    var b0 = b.startSec != null ? b.startSec : b.startIdx;
    var b1 = b.endSec != null ? b.endSec : b.endIdx;
    if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
    return a0 <= b1 && b0 <= a1;
  }

  OxyAccuracy.sensitivityReport = function (baseMetrics, biasedMetrics, biasPct) {
    var report = {
      method: 'injectBias clamp [0,100], nulls preserved; +bias masks desaturations, -bias invents them',
      biasPct: (typeof biasPct === 'number' && !Number.isNaN(biasPct)) ? biasPct : null,
      deltas: {},
      maskedEvents: [],
      phantomEvents: [],
      nMasked: 0,
      nPhantom: 0
    };
    if (baseMetrics == null || typeof baseMetrics !== 'object') return report;
    if (biasedMetrics == null || typeof biasedMetrics !== 'object') return report;

    var keys = {};
    var k;
    for (k in baseMetrics) {
      if (Object.prototype.hasOwnProperty.call(baseMetrics, k) && k !== 'events') keys[k] = true;
    }
    for (k in biasedMetrics) {
      if (Object.prototype.hasOwnProperty.call(biasedMetrics, k) && k !== 'events') keys[k] = true;
    }
    for (k in keys) {
      var base = baseMetrics[k];
      var biased = biasedMetrics[k];
      var bNum = (typeof base === 'number' && !Number.isNaN(base)) ? base : null;
      var dNum = (typeof biased === 'number' && !Number.isNaN(biased)) ? biased : null;
      var absDelta = (bNum == null || dNum == null) ? null : dNum - bNum;
      var relDelta = (bNum == null || bNum === 0 || dNum == null) ? null : (dNum - bNum) / Math.abs(bNum);
      var boundaryCross = null;
      var bk = boundaryKey(k);
      if (absDelta != null && bk && BOUNDARIES[bk === 'odi' ? 'odi' : bk]) {
        var bounds = bk === 'odi' ? BOUNDARIES.odi : BOUNDARIES[bk];
        boundaryCross = crossesBoundary(bNum, dNum, bounds);
      }
      report.deltas[k] = {
        base: bNum,
        biased: dNum,
        absDelta: absDelta,
        relDelta: relDelta,
        boundaryCross: boundaryCross
      };
    }

    /* Event-list comparison: masked = in base, gone in biased; phantom = the reverse.
       Events match by interval overlap; unmatched base events are masked, unmatched
       biased events are phantom. */
    var baseEvents = Array.isArray(baseMetrics.events) ? baseMetrics.events : [];
    var biasedEvents = Array.isArray(biasedMetrics.events) ? biasedMetrics.events : [];
    var matchedBiased = [];
    var i, j;
    for (i = 0; i < baseEvents.length; i++) matchedBiased[i] = false;
    var matchedBase = [];
    for (j = 0; j < biasedEvents.length; j++) matchedBase[j] = false;
    for (i = 0; i < baseEvents.length; i++) {
      for (j = 0; j < biasedEvents.length; j++) {
        if (!matchedBase[j] && eventsOverlap(baseEvents[i], biasedEvents[j])) {
          matchedBiased[i] = true;
          matchedBase[j] = true;
          break;
        }
      }
    }
    for (i = 0; i < baseEvents.length; i++) {
      if (!matchedBiased[i]) report.maskedEvents.push(eventId(baseEvents[i], i));
    }
    for (j = 0; j < biasedEvents.length; j++) {
      if (!matchedBase[j]) report.phantomEvents.push(eventId(biasedEvents[j], j));
    }
    report.nMasked = report.maskedEvents.length;
    report.nPhantom = report.phantomEvents.length;
    return report;
  };

  /* Expose the boundary table for tests that want to assert the contract. */
  OxyAccuracy.BOUNDARIES = BOUNDARIES;

  root.OxyAccuracy = OxyAccuracy;
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));

// ESM-MIGRATION: dual-mode re-export like the other DSP modules. The IIFE above
// attaches OxyAccuracy to the shared root (classic co-load); this lets ESM
// consumers import it directly.
export const OxyAccuracy = (typeof globalThis !== 'undefined' ? globalThis.OxyAccuracy : null);
