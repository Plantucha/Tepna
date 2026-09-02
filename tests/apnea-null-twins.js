/*
 * tests/apnea-null-twins.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * The apnea chance-null's COMMITTED TWINS (DEEP-AUDIT-VI-FOLLOWUPS §4.3).
 *
 * WHY THIS FILE EXISTS. §4.2b changed the reportability gate — the null that decides whether a
 * confirmed apnea index is published — and landed with **zero fixture movement available to catch
 * it**. The Integrator's only code-gated fixture is a TCH consensus export with no `apneaNullModel`
 * at all, so no committed artifact could express the change. "No fixture moved" was silence BY
 * CONSTRUCTION, not evidence. That is the failure class this repo keeps finding: a check that ran
 * and examined nothing.
 *
 * TWO TWINS, NOT ONE, because a gate has two directions and a corpus that can only express one of
 * them can only ever half-fail. `coupled` must be PUBLISHED (p at the surrogate floor) and `null`
 * must be WITHHELD (p mid-range). A single coupled twin would go green against a null that published
 * everything.
 *
 * INPUTS ARE REBUILT IN-CODE, following tests/tch-golden-inputs.js: `inputHashes:{}`, so the fixture
 * is a pure function of INTEGRATOR code and no OxyDex/ECGDex DSP change can move it. One builder,
 * consumed by both the regen tool and the equivalence gate, so the two cannot drift.
 *
 * DUAL-MODE (global + module.exports) because dex-tests.js runs in both lanes, exactly as
 * tch-golden-inputs.js and clock.js do.
 *
 * PURE + DETERMINISTIC: seeded mulberry32, no clock read, no Math.random, no I/O.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function mb32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A night is 8 h from a FIXED floating wall-clock anchor (Clock Contract §1: Date.UTC of local
     civil time). No clock read anywhere — the anchor is a literal so the bytes never move. */
  var T0 = Date.UTC(2026, 5, 27, 22, 0, 0);
  var SPAN_MS = 8 * 3600 * 1000;

  function hhmmss(ms) {
    var d = new Date(ms);
    function p(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  function exportOf(node, impulse, timesMs, conf, segments) {
    return {
      schema: { name: 'ganglior.node-export', version: '1.0', bus: 'ganglior', node: node },
      node: node,
      /* `recording.coverage.segments` is what makes a night SPARSE (integrator-dsp.js:736 →
         recSegments → segmentsOverlap). The gapped twin below is the only one of the three that can
         express the covered-time shift; without it that branch is invisible to the corpus. */
      recording: segments ? { startEpochMs: T0, endEpochMs: T0 + SPAN_MS, node: node, coverage: { segments: segments } } : { startEpochMs: T0, endEpochMs: T0 + SPAN_MS, node: node },
      ganglior_events: timesMs.map(function (t) {
        return { t: hhmmss(t), tMs: t, impulse: impulse, node: node, conf: conf, sqi: 0.9 };
      })
    };
  }

  /* 40 desaturations, irregularly spaced so the train is not periodic — a periodic desat train is
     exactly the resonance case event-coupling.js:120 warns about, and building the twin on one would
     make the surrogate null look better than it is. */
  function desatTimes() {
    var r = mb32(20260903),
      out = [],
      t = 6 * 60000;
    for (var i = 0; i < 40; i++) {
      out.push(T0 + Math.round(t));
      t += 380000 + r() * 340000; // ~6.3–12 min apart
    }
    return out;
  }

  /* COUPLED twin: every desat is followed by an autonomic surge at a physiologically ordinary
     latency (+18 s, inside the −15…+60 s directionality gate), plus a handful of unrelated surges so
     the night is not a degenerate one-to-one map. Expected verdict: PUBLISHED, p at the floor. */
  function coupledSurgeTimes() {
    var r = mb32(4242),
      d = desatTimes(),
      out = [];
    for (var i = 0; i < d.length; i++) out.push(d[i] + 18000);
    for (var k = 0; k < 12; k++) out.push(T0 + Math.round(r() * SPAN_MS));
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  /* NULL twin: the SAME desats and the SAME number of surges, placed independently of them. Holding
     both counts fixed is what makes the pair a controlled contrast — the twins differ in COUPLING
     and in nothing else, so a verdict difference cannot be attributed to event density. */
  function nullSurgeTimes() {
    var r = mb32(1337),
      n = desatTimes().length + 12,
      out = [];
    for (var i = 0; i < n; i++) out.push(T0 + Math.round(r() * SPAN_MS));
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  /* GAPPED twin — the recording stops for 100 minutes mid-night and resumes.
     WHY A THIRD TWIN. Bar (3) of §4.3 is that a mutant to the shipped path must MOVE these bytes; a
     fixture that stays byte-identical under it has restated the exposure rather than closed it. The
     first two twins are single-segment, so `_coveredShift` and a plain wrap are IDENTICAL on them and
     dropping the covered-time shift moves nothing — measured, not assumed. This twin has a real gap,
     so a surrogate that wraps in wall time lands surges inside the dead span (where nothing was
     observing and no desat can be confirmed) while the covered-time shift never does.
     Events are authored only INSIDE the two live segments — an event in the gap would contradict the
     coverage it declares. */
  var GAP_START_MS = T0 + 3 * 3600 * 1000;
  var GAP_END_MS = GAP_START_MS + 100 * 60 * 1000;
  var GAPPED_SEGMENTS = [
    { startMs: T0, durSec: (GAP_START_MS - T0) / 1000 },
    { startMs: GAP_END_MS, durSec: (T0 + SPAN_MS - GAP_END_MS) / 1000 }
  ];
  function inLiveSpan(t) {
    return t < GAP_START_MS || t >= GAP_END_MS;
  }
  function gappedDesatTimes() {
    return desatTimes().filter(inLiveSpan);
  }
  function gappedSurgeTimes() {
    var r = mb32(90909),
      d = gappedDesatTimes(),
      out = [],
      i;
    for (i = 0; i < d.length; i++) out.push(d[i] + 18000);
    for (i = 0; i < 12; i++) {
      var t = T0 + Math.round(r() * SPAN_MS);
      if (inLiveSpan(t)) out.push(t);
    }
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  /* CONTENDED twin — desats in tight clusters, so several compete for ONE surge.
     WHY A FOURTH. The central claim of §4.2b is that the null scores the PUBLISHED statistic: an
     EXCLUSIVE greedy matching, not independent per-desat trials. On the first three twins a mutant
     that swaps the null's scorer for a non-exclusive hit-count moves NOTHING — measured — because
     their desats are minutes apart and never contend for the same surge, so the two scorers agree.
     A corpus blind to the difference cannot witness the fix.
     Here 10 clusters of 4 desats sit ~12 s apart with ONE surge each: the exclusive matching scores
     ~1 per cluster, a non-exclusive count scores up to 4. The scorer is now expressible. */
  var CONTENDED_CLUSTERS = 40;
  function contendedDesatTimes() {
    var out = [],
      c,
      j;
    for (c = 0; c < CONTENDED_CLUSTERS; c++) {
      var base = T0 + (6 * 60 + c * 11.5 * 60) * 1000; // clusters ~11.5 min apart, so the night is dense
      for (j = 0; j < 3; j++) out.push(base + j * 12000); // 3 desats, 12 s apart — they CONTEND
    }
    return out;
  }
  /* Surges land on the first half of the clusters. Density matters as much as placement: the clusters
     must be close enough together that a SHIFTED surge still lands inside one, or every surrogate
     scores zero and the two scorers agree trivially — which is what a first, sparser version of this
     twin did (surrogate mean 0.00, mutant invisible). */
  function contendedSurgeTimes() {
    var out = [],
      c;
    for (c = 0; c < CONTENDED_CLUSTERS / 2; c++) out.push(T0 + (6 * 60 + c * 11.5 * 60) * 1000 + 20000);
    for (c = 0; c < 20; c++) out.push(T0 + (3 * 60 + c * 23 * 60) * 1000 + 7000);
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  function apneaNullTwins() {
    return {
      contended: [
        { node: 'OxyDex', json: exportOf('OxyDex', 'spo2_desaturation', contendedDesatTimes(), 0.9) },
        { node: 'ECGDex', json: exportOf('ECGDex', 'autonomic_surge', contendedSurgeTimes(), 0.9) }
      ],
      gapped: [
        { node: 'OxyDex', json: exportOf('OxyDex', 'spo2_desaturation', gappedDesatTimes(), 0.9, GAPPED_SEGMENTS) },
        { node: 'ECGDex', json: exportOf('ECGDex', 'autonomic_surge', gappedSurgeTimes(), 0.9, GAPPED_SEGMENTS) }
      ],
      coupled: [
        { node: 'OxyDex', json: exportOf('OxyDex', 'spo2_desaturation', desatTimes(), 0.9) },
        { node: 'ECGDex', json: exportOf('ECGDex', 'autonomic_surge', coupledSurgeTimes(), 0.9) }
      ],
      uncoupled: [
        { node: 'OxyDex', json: exportOf('OxyDex', 'spo2_desaturation', desatTimes(), 0.9) },
        { node: 'ECGDex', json: exportOf('ECGDex', 'autonomic_surge', nullSurgeTimes(), 0.9) }
      ]
    };
  }

  root.apneaNullTwins = apneaNullTwins;
  if (typeof module !== 'undefined' && module.exports) module.exports = { apneaNullTwins: apneaNullTwins };
})(typeof globalThis !== 'undefined' ? globalThis : this);
