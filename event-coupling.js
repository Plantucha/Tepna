/*
 * event-coupling.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE cross-node event-coupling primitive (CPAP-REAL-CORPUS-2026-07-11-BRIEF §P5, §M1).
 *
 * Question it answers: "do node A's events PRECEDE node B's events, or do the two streams
 * merely co-occur because both are frequent?" — e.g. CPAP apnea × OxyDex desaturation,
 * ECGDex arrhythmia × desat, GlucoDex excursion × anything.
 *
 * ── Why a chance baseline is MANDATORY (§M1) ────────────────────────────────────────────
 * Two frequent event streams co-occur BY CONSTRUCTION. A raw co-occurrence rate is therefore
 * not evidence of anything, and on the real ~180-night CPAP corpus the naive read was flatly
 * INVERTED by the null: the DOMINANT event class (n=688) sat at lift ×0.6–1.0 — exactly
 * chance — at every window from 0–30 s to 0–120 s, while a RARE class (n=39) hit ×3.3–10.
 * Without the null the dominant class's raw rate looks like a finding. It is not one.
 *
 * ── The null: CIRCULAR time-shift surrogates ────────────────────────────────────────────
 * Displace every A event by ±5–15 min and re-measure. This preserves both streams' marginal
 * rates and their within-stream structure, destroying ONLY the A↔B alignment — so it isolates
 * true coupling rather than shared burden.
 *
 * The shift MUST WRAP (circularly, within the recording span). A plain additive shift lets
 * A events fall off the end of the recording, where no B can ever match them; that DEFLATES
 * chancePct and therefore INFLATES lift — i.e. it manufactures couplings in exactly the
 * direction a careless reader wants to believe. `tools/cpap-oxy-couple.mjs`'s prototype
 * shifted without wrapping; this module does not.
 *
 * ⚠️ RESONANCE CAVEAT. Circular surrogates degrade when stream B is near-PERIODIC and a shift
 * is commensurate with its period (shift ≡ 0 mod period re-aligns the same phase, so the null
 * reproduces the observed rate and lift collapses toward 1 — a false NEGATIVE). Default shifts
 * are deliberately NOT all multiples of one another. If B is periodic by nature, pass
 * `nullShifts` that are incommensurate with its period.
 *
 * ⚠️ SATURATION CAVEAT — and why every measurement reports `maxLift`. If the window is wide
 * relative to B's mean inter-event interval, then EVERY A event finds a B by chance alone, the
 * null rate approaches 100%, and lift is driven toward 1.0 BY ARITHMETIC — even when the
 * coupling is perfect. A lift of ~1.0 is therefore ambiguous on its own: it means either "no
 * coupling" or "this window is too wide to resolve one", and those must never be conflated.
 * The bound is exact, so we publish it rather than leave it implicit:
 *
 *     maxLift = 100 / chancePct        // the largest lift this window COULD return
 *
 * At chancePct = 90%, maxLift = 1.11 — the window cannot demonstrate a coupling however real it
 * is. `saturated` (maxLift < 1.5) flags such a window as UNINFORMATIVE, not as a negative result.
 * Read a lift of 1.0 as evidence of absence ONLY on an unsaturated window.
 *
 * ── Duration stratification: what turns "no signal" into "provably no signal" (§M1) ──────
 * A long event MUST couple if the coupling is real — a 60 s apnea that never desaturates is
 * not a 60 s apnea. So stratifying A by duration is the decisive check, not a nicety: on the
 * real corpus the LONGEST bucket (n=42) came back at lift ×0.0, which is what promoted "we
 * found nothing" to "there is provably nothing here".
 *
 * ── Contract ────────────────────────────────────────────────────────────────────────────
 *   coupling(eventsA, eventsB, opts) → {
 *     n, hits, observedPct, chancePct, lift, nullPcts, spanMs, window, windowSweep[], strata[]
 *   }
 *
 *   eventsA / eventsB : [{ tMs, … }]  — floating wall-clock ms (CLAUDE.md §🔒). Extra fields
 *                                       (e.g. durSec) ride along and are used by stratifyBy.
 *   opts.window       : [loMs, hiMs]  — a "hit" = some B lands in [tA+lo, tA+hi]. Default [0, 60s].
 *   opts.nullShifts   : [ms, …]       — surrogate displacements. Default ±5–15 min, incommensurate.
 *   opts.span         : [t0Ms, t1Ms]  — the recording extent the circular wrap runs over.
 *                                       Omitted → derived from the union of both streams' extents
 *                                       and reported back as `spanMs` (derivation is a real
 *                                       methodological choice; it is surfaced, never hidden).
 *   opts.windowSweep  : [[lo,hi], …]  — extra windows to re-run. Default 0–30 s / 0–60 s / 0–120 s.
 *   opts.stratifyBy   : 'durSec'      — numeric field on eventsA to bucket by. Default: no strata.
 *   opts.strataEdges  : [e1, e2, …]   — bucket boundaries. Omitted → quartiles of the field.
 *
 * `lift` = observedPct / chancePct. Honest edges: chance 0 & observed 0 → NaN ("no information",
 * NOT 1.0); chance 0 & observed > 0 → Infinity. Never fabricated, per the suite's never-invent rule.
 *
 * Standalone spine module — NOT co-loaded into any bundle (no app consumes it yet, so wiring it
 * into dex-coload.js would re-bundle all 8 apps to carry inert code; it rides the first node that
 * actually uses it). Dual-realm.   Self-test:  node event-coupling.js --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var DEFAULT_WINDOW = [0, 60000];
  // ±5–15 min, but deliberately NOT round (see the resonance caveat above). Whole-MINUTE
  // shifts are a trap: they are all multiples of 60 s, so against any stream B with a round
  // periodicity (60 s, 30 s, 120 s — not exotic at all) every surrogate re-lands A on the SAME
  // phase, the null reproduces the observed rate, and lift collapses to ~1 — a FALSE NEGATIVE.
  // These offsets are second-level and share no common factor with 30/60/120 s, so no round
  // periodicity in B can re-phase them.  (Caught by this module's own gate: a 60 s-periodic B
  // scored a planted, perfect coupling at lift 1.006 under whole-minute shifts.)
  var DEFAULT_SHIFTS = [-887000, -809000, -663000, -461000, -317000,
                         317000,  461000,  663000,  809000,  887000];
  var DEFAULT_SWEEP = [[0, 30000], [0, 60000], [0, 120000]];

  function _finiteTs(events) {
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e && e.tMs != null && isFinite(e.tMs)) out.push(e);
    }
    return out;
  }

  function _quantile(sorted, p) {
    if (!sorted.length) return NaN;
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  /* Sorted-B + binary search: the first B at or after t. O(|A|·log|B|) per surrogate. */
  function _lowerBound(sortedB, t) {
    var lo = 0, hi = sortedB.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sortedB[mid] < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /* Fraction of A events (already shifted) with some B in [tA+lo, tA+hi]. */
  function _hitRate(shiftedA, sortedB, lo, hi) {
    var hits = 0;
    for (var i = 0; i < shiftedA.length; i++) {
      var t = shiftedA[i];
      var j = _lowerBound(sortedB, t + lo);
      if (j < sortedB.length && sortedB[j] <= t + hi) hits++;
    }
    return { hits: hits, pct: shiftedA.length ? (hits / shiftedA.length) * 100 : NaN };
  }

  /* Circular displacement within [s0, s1). This is the whole point — see the header. */
  function _wrap(tMs, shift, s0, width) {
    if (!(width > 0)) return tMs + shift;                 // degenerate span → cannot wrap
    var d = (tMs - s0 + shift) % width;
    if (d < 0) d += width;
    return s0 + d;
  }

  function _lift(observedPct, chancePct) {
    if (!isFinite(observedPct) || !isFinite(chancePct)) return NaN;
    if (chancePct === 0) return observedPct === 0 ? NaN : Infinity;   // never coerce to 1.0
    return observedPct / chancePct;
  }

  // The largest lift a window COULD return at this chance rate (observed caps at 100%).
  // Publishing it is what stops a saturated window's lift≈1.0 being misread as "no coupling".
  var SATURATION_MAX_LIFT = 1.5;
  function _maxLift(chancePct) {
    if (!isFinite(chancePct) || chancePct <= 0) return Infinity;
    return 100 / chancePct;
  }

  /* One (window × event-set) measurement against the circular-shift null. */
  function _measure(A, sortedB, lo, hi, shifts, s0, width) {
    if (!A.length) {
      return { n: 0, hits: 0, observedPct: NaN, chancePct: NaN, lift: NaN,
               maxLift: NaN, saturated: false, nullPcts: [] };
    }
    var tA = A.map(function (e) { return e.tMs; });
    var obs = _hitRate(tA, sortedB, lo, hi);

    var nullPcts = shifts.map(function (s) {
      var shifted = tA.map(function (t) { return _wrap(t, s, s0, width); });
      return _hitRate(shifted, sortedB, lo, hi).pct;
    }).filter(function (p) { return isFinite(p); });

    var chancePct = nullPcts.length
      ? nullPcts.reduce(function (a, b) { return a + b; }, 0) / nullPcts.length
      : NaN;

    var maxLift = _maxLift(chancePct);
    return {
      n: A.length,
      hits: obs.hits,
      observedPct: obs.pct,
      chancePct: chancePct,
      lift: _lift(obs.pct, chancePct),
      maxLift: maxLift,
      // TRUE ⇒ this window cannot demonstrate a coupling however real; its lift is
      // UNINFORMATIVE, not a negative result. See the saturation caveat in the header.
      saturated: isFinite(maxLift) && maxLift < SATURATION_MAX_LIFT,
      nullPcts: nullPcts
    };
  }

  /**
   * coupling(eventsA, eventsB, opts) — see the header block for the full contract.
   * Pure: no clock reads, no RNG, no I/O. Deterministic for identical inputs.
   */
  function coupling(eventsA, eventsB, opts) {
    opts = opts || {};
    var A = _finiteTs(eventsA || []);
    var B = _finiteTs(eventsB || []);

    var win = opts.window || DEFAULT_WINDOW;
    var lo = win[0], hi = win[1];
    var shifts = opts.nullShifts || DEFAULT_SHIFTS;

    var sortedB = B.map(function (e) { return e.tMs; }).sort(function (a, b) { return a - b; });

    // Span for the circular wrap. Derived from the union of both streams when not supplied —
    // a real choice, so it is reported back as spanMs rather than buried.
    var s0, s1;
    if (opts.span && isFinite(opts.span[0]) && isFinite(opts.span[1])) {
      s0 = opts.span[0]; s1 = opts.span[1];
    } else {
      var all = A.concat(B).map(function (e) { return e.tMs; });
      s0 = all.length ? Math.min.apply(null, all) : 0;
      s1 = all.length ? Math.max.apply(null, all) : 0;
    }
    var width = s1 - s0;

    var out = _measure(A, sortedB, lo, hi, shifts, s0, width);
    out.spanMs = width;
    out.window = [lo, hi];

    // ── window sweep: is the lift stable across windows, or an artifact of one? ──
    var sweep = opts.windowSweep || DEFAULT_SWEEP;
    out.windowSweep = sweep.map(function (w) {
      var m = _measure(A, sortedB, w[0], w[1], shifts, s0, width);
      return {
        window: [w[0], w[1]],
        n: m.n, hits: m.hits,
        observedPct: m.observedPct, chancePct: m.chancePct, lift: m.lift,
        maxLift: m.maxLift, saturated: m.saturated
      };
    });

    // ── duration strata: the decisive check (§M1) ──
    out.strata = [];
    if (opts.stratifyBy) {
      var key = opts.stratifyBy;
      var vals = A.map(function (e) { return e[key]; })
                  .filter(function (v) { return v != null && isFinite(v); })
                  .sort(function (a, b) { return a - b; });

      if (vals.length) {
        var edges = opts.strataEdges ||
          [_quantile(vals, 0.25), _quantile(vals, 0.50), _quantile(vals, 0.75)];
        // Dedupe: a degenerate field (all one value) collapses to a single bucket rather
        // than emitting empty strata that read as "we looked and found nothing".
        var uniq = [];
        for (var i = 0; i < edges.length; i++) {
          if (isFinite(edges[i]) && uniq.indexOf(edges[i]) === -1) uniq.push(edges[i]);
        }
        var bounds = [-Infinity].concat(uniq, [Infinity]);

        for (var b = 0; b < bounds.length - 1; b++) {
          var loB = bounds[b], hiB = bounds[b + 1];
          /* jshint loopfunc:true */
          var bucket = A.filter(function (e) {
            var v = e[key];
            return v != null && isFinite(v) && v >= loB && (hiB === Infinity ? true : v < hiB);
          });
          if (!bucket.length) continue;
          var sm = _measure(bucket, sortedB, lo, hi, shifts, s0, width);
          out.strata.push({
            by: key, lo: loB, hi: hiB,
            n: sm.n, hits: sm.hits,
            observedPct: sm.observedPct, chancePct: sm.chancePct, lift: sm.lift,
            maxLift: sm.maxLift, saturated: sm.saturated
          });
        }
      }
    }

    return out;
  }

  /* ══ self-test ═══════════════════════════════════════════════════════════════════════ */
  function selfTest() {
    var pass = 0, fail = 0, log = [];
    function ok(name, cond, got) {
      (cond ? pass++ : fail++);
      log.push((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' — got ' + got));
    }
    function near(a, b, tol) { return a != null && isFinite(a) && Math.abs(a - b) <= tol; }

    // Deterministic LCG — no Math.random (it would break reproducibility).
    var _s = 12345;
    function rnd() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

    var T0 = Date.UTC(2026, 5, 13, 23, 0, 0);   // floating tMs, per the Clock Contract
    var SPAN_MS = 3 * 3600 * 1000;              // 3 h recording

    // Stream B: ~every 60 s with ±15 s deterministic jitter (jitter defeats the resonance
    // failure the header warns about — a perfectly periodic B would re-phase the surrogates).
    var B = [];
    for (var i = 0; i < 180; i++) {
      B.push({ tMs: T0 + i * 60000 + Math.round((rnd() - 0.5) * 30000) });
    }
    var span = [T0, T0 + SPAN_MS];

    // ── 1. planted coupling: every A sits 2 s before a B ──
    var Acoupled = [];
    for (var j = 10; j < 170; j++) Acoupled.push({ tMs: B[j].tMs - 2000, durSec: 30 });
    var r1 = coupling(Acoupled, B, { window: [0, 10000], span: span });
    ok('planted coupling: observed = 100%', near(r1.observedPct, 100, 0.01), r1.observedPct);
    ok('planted coupling: lift >> 1 (≥3)', r1.lift >= 3, r1.lift);
    ok('planted coupling: chance is non-zero (circular wrap kept A in-span)',
       r1.chancePct > 0 && r1.chancePct < 60, r1.chancePct);
    ok('planted coupling: hits = n', r1.hits === r1.n, r1.hits + '/' + r1.n);

    // ── 2. the null itself: A independent of B → lift ≈ 1 (this is the whole §M1 point) ──
    var Aindep = [];
    for (var k = 0; k < 160; k++) Aindep.push({ tMs: T0 + Math.floor(rnd() * SPAN_MS), durSec: 30 });
    var r2 = coupling(Aindep, B, { window: [0, 10000], span: span });
    ok('independent streams: lift ≈ 1 (0.6–1.6) despite frequent co-occurrence',
       r2.lift > 0.6 && r2.lift < 1.6, r2.lift);
    ok('independent streams: raw co-occurrence is NOT ~0 (the trap the null defuses)',
       r2.observedPct > 5, r2.observedPct);

    // ── 3. circular wrap: chance must not collapse (the prototype's non-wrapping bug) ──
    // A huge shift past the recording end must still land in-span and score a real rate.
    var rWrap = coupling(Acoupled, B, {
      window: [0, 10000], span: span, nullShifts: [SPAN_MS * 4 + 137000]
    });
    ok('circular wrap: a 4×-span shift still yields a finite, non-zero chance',
       isFinite(rWrap.chancePct) && rWrap.chancePct > 0, rWrap.chancePct);

    // ── 4. duration strata: coupling planted ONLY in the long events (§M1's decisive check) ──
    var Amixed = [];
    for (var m = 10; m < 90; m++) Amixed.push({ tMs: B[m].tMs - 2000, durSec: 60 });    // long → coupled
    for (var n = 90; n < 170; n++) Amixed.push({ tMs: B[n].tMs + 30000, durSec: 5 });   // short → not
    var r4 = coupling(Amixed, B, { window: [0, 10000], span: span, stratifyBy: 'durSec' });
    ok('strata: emitted', r4.strata.length >= 2, r4.strata.length);
    var longS  = r4.strata[r4.strata.length - 1];
    var shortS = r4.strata[0];
    ok('strata: LONG bucket couples (lift ≥ 3)', longS && longS.lift >= 3, longS && longS.lift);
    ok('strata: SHORT bucket does not (lift < 1)', shortS && shortS.lift < 1, shortS && shortS.lift);
    ok('strata: pooled lift HIDES the split (between the two)',
       r4.lift > shortS.lift && r4.lift < longS.lift, r4.lift);

    // ── 5. window sweep + SATURATION ────────────────────────────────────────────────────
    // B fires ~every 60 s here, so a 0–60 s / 0–120 s window is WIDER than B's inter-event
    // interval: every A finds a B by chance, chance → 100%, and lift is crushed toward 1.0
    // BY ARITHMETIC even though the coupling is perfect. That is not a negative result, and
    // the primitive must say so rather than report a bare lift ≈ 1.0 (which a reader would
    // take as "no coupling"). This is the trap `saturated`/`maxLift` exist to close.
    ok('sweep: 3 windows by default', r1.windowSweep.length === 3, r1.windowSweep.length);

    var tight = r1.windowSweep[0];    // 0–30 s — narrower than B's interval → informative
    var wide  = r1.windowSweep[2];    // 0–120 s — 2× B's interval        → saturated
    ok('sweep: the TIGHT window resolves the planted coupling (lift ≥ 1.5, unsaturated)',
       tight.lift >= 1.5 && !tight.saturated,
       'lift ' + tight.lift.toFixed(2) + ' saturated=' + tight.saturated);
    ok('sweep: the WIDE window is flagged SATURATED, not reported as "no coupling"',
       wide.saturated === true && wide.maxLift < 1.5,
       'lift ' + wide.lift.toFixed(2) + ' maxLift ' + wide.maxLift.toFixed(2) +
       ' saturated=' + wide.saturated);
    ok('sweep: saturated lift ≈ 1.0 is an ARITHMETIC ceiling — lift ≤ maxLift always',
       r1.windowSweep.every(function (w) { return !isFinite(w.maxLift) || w.lift <= w.maxLift + 1e-9; }),
       r1.windowSweep.map(function (w) { return w.lift.toFixed(2) + '≤' + w.maxLift.toFixed(2); }).join(' '));
    ok('sweep: an unsaturated window is what licenses reading lift ≈ 1 as absence',
       r2.windowSweep[0].saturated === false && r2.windowSweep[0].lift < 1.6,
       'lift ' + r2.windowSweep[0].lift.toFixed(2));

    // ── 6. honest edges — never fabricate a lift ──
    var rEmpty = coupling([], B, { span: span });
    ok('empty A: n=0, lift NaN (not 1.0), no throw',
       rEmpty.n === 0 && isNaN(rEmpty.lift), rEmpty.lift);
    var rNoB = coupling(Acoupled, [], { window: [0, 10000], span: span });
    ok('empty B: observed 0, lift NaN (0/0 is "no information", not "no effect")',
       rNoB.observedPct === 0 && isNaN(rNoB.lift), rNoB.lift);

    // ── 7. RESONANCE: the trap the non-round default shifts exist to dodge ──────────────
    // A perfectly PERIODIC B (60 s grid) + whole-MINUTE surrogates = every shift re-lands A on
    // the same phase, so the null reproduces the observed rate and a perfect planted coupling
    // reads as lift ≈ 1.0 — a false negative. Same data, non-round default shifts → recovered.
    var Bper = [], Aper = [];
    for (var q = 0; q < 120; q++) Bper.push({ tMs: T0 + q * 60000 });
    for (var w = 10; w < 110; w++) Aper.push({ tMs: Bper[w].tMs - 2000 });
    var MINUTES = [-15, -13, -11, -7, -5, 5, 7, 11, 13, 15].map(function (x) { return x * 60000; });

    var rRes = coupling(Aper, Bper, { window: [0, 10000], span: span, nullShifts: MINUTES });
    ok('resonance: whole-minute shifts vs a 60 s-periodic B DO collapse a real coupling to ~1',
       rRes.lift < 1.2, rRes.lift);
    var rFix = coupling(Aper, Bper, { window: [0, 10000], span: span });   // default shifts
    ok('resonance: the non-round DEFAULT shifts recover that same coupling (lift ≥ 3)',
       rFix.lift >= 3, rFix.lift);
    ok('resonance: no default shift is a whole number of minutes',
       API.DEFAULT_SHIFTS.every(function (s) { return s % 60000 !== 0; }),
       API.DEFAULT_SHIFTS.join(','));

    // ── 8. purity: identical inputs → identical output ──
    var rA = coupling(Amixed, B, { window: [0, 10000], span: span, stratifyBy: 'durSec' });
    var rB = coupling(Amixed, B, { window: [0, 10000], span: span, stratifyBy: 'durSec' });
    ok('deterministic: identical inputs → identical output',
       JSON.stringify(rA) === JSON.stringify(rB), 'differs');

    return { pass: pass, fail: fail, log: log };
  }

  var API = { coupling: coupling, selfTest: selfTest, DEFAULT_SHIFTS: DEFAULT_SHIFTS };

  root.EventCoupling = root.EventCoupling || API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  if (typeof process !== 'undefined' && process.argv && process.argv.indexOf('--selftest') !== -1) {
    var r = selfTest();
    r.log.forEach(function (l) { console.log('  ' + l); });
    console.log('\n  EventCoupling self-test: ' + r.pass + ' passed, ' + r.fail + ' failed\n');
    if (typeof process.exitCode !== 'undefined') process.exitCode = r.fail ? 1 : 0;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
