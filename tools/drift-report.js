/*
 * tools/drift-report.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * DRIFT REPORTING — the pure formatters behind `trio-batch`'s clock lines.
 * WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF §F5.
 *
 * WHY THIS FILE EXISTS. `printDriftFit` used to print
 *
 *     ⏱ H10↔Verity drift: 80 ppm (2.13 s over 444 min), offset …
 *
 * and only then, twenty lines further down, compute the three-source closure that decides whether
 * that 80 ppm means anything. On 2026-07-26 the closure reads 100.9 ppm against an identity of 0 —
 * the pairwise fit is provably wrong — yet the line above it had already stated a drift and, worse,
 * CONVERTED it into "2.13 s over the night", which reads as a physical fact rather than a fit.
 *
 * `CROSS-DEVICE-DRIFT-AND-CLOSURE` §6 is explicit: *"Do not quote a ppm figure that has not closed.
 * The six nights here produce drift estimates spanning −21 to +754 ppm; two of them are credible.
 * The rest are unwrap failures wearing the same units, and they are indistinguishable from real
 * measurements without the closure column beside them."* The printer contradicted its own brief.
 *
 * THE RULE ENCODED HERE. A ppm is a MEASUREMENT only when a three-source closure exists and is
 * consistent. In every other state — no third source, a refused closure, an inconsistent one — the
 * number is still printed (a refusal is a result, and hiding the fit would cost the diagnostic) but
 * it is marked, and **the seconds-per-night conversion is suppressed**. That conversion is the part
 * that reads as fact, so it is the part gated on closure.
 *
 * WHY A SEPARATE MODULE, and not a few lines inside the .mjs. `trio-batch.mjs` executes its night
 * loop at import, so nothing inside it can be called from a test — which is exactly why
 * `printDriftFit`/`printClockFit` had ZERO coverage while every other clock assertion in the suite
 * targets `fitClockClosure`'s own unit group. Pure string-returning formatters in a classic module
 * are reachable from BOTH lanes, so the wording of a claim is gated the same way its arithmetic is.
 *
 * Pure: no fs, no console, no DOM, no Date. Input in, string out.
 */
(function (root) {
  'use strict';

  /* ── the closure STATE of a drift fit ────────────────────────────────────────────────────────
     Four states, and only one of them licenses quoting the number:

       'closed'        a three-source closure ran and is consistent      → quotable
       'inconsistent'  a closure ran and FAILED the identity             → void
       'refused'       a closure was attempted and declined to run       → unclosed
       'unclosed'      no third source was present at all                → unclosed

     `refused` and `unclosed` are kept distinct on purpose. "No third sensor was worn" and "a third
     sensor was worn and its axis was drawn" are different facts about the night, and collapsing them
     is how six nights of CLOCK-CLOSURE-THREE-SOURCE looked like clean absences rather than refusals. */
  function driftVerdict(closure) {
    if (!closure) return { state: 'unclosed', quotable: false, why: 'no third source' };
    if (closure.refused) return { state: 'refused', quotable: false, why: 'closure refused' + (closure.reason ? ' — ' + closure.reason : '') };
    if (closure.closurePpm == null || !isFinite(closure.closurePpm)) return { state: 'unclosed', quotable: false, why: 'closure did not resolve' };
    if (!closure.consistent)
      return {
        state: 'inconsistent',
        quotable: false,
        why: 'closure ' + closure.closurePpm.toFixed(1) + ' ppm INCONSISTENT — at least one pairwise fit is wrong'
      };
    return { state: 'closed', quotable: true, why: 'closure ' + closure.closurePpm.toFixed(1) + ' ppm consistent' };
  }

  /* ── THE CLOSURE IDENTITY ITSELF, over drift legs a CALLER already fitted ────────────────────
     CROSS-DEVICE-DRIFT-AND-CLOSURE §5: *"Drift is measured with unwrapping and reported with a closure
     residual; a figure without one is not published."* `driftVerdict` above encodes what a closure
     LICENSES, but it takes the closure as given, so it can only gate a caller that already has one.
     `integrator-dsp.js fitClockClosure` computes one — but it fits its OWN legs with `fitClockDrift`,
     so it cannot close over a ppm some other estimator produced. `beat-comb-analysis.mjs` is exactly
     that other estimator: it derives drift from per-block lag by Theil-Sen and printed the result with
     no closure at all, which is the guardrail the brief wrote against.

     Closing over legs the caller supplies is what makes the check FREE: each pair is fitted
     independently, so the identity is a constraint the fit never used and cannot have fabricated.

     Directed legs, `{ a, b, ppm }` meaning b's clock runs `ppm` fast relative to a's. Around any cycle
     the rates must sum to zero, so d(A,B) + d(B,C) + d(C,A) = 0 — and d(B,A) = -d(A,B) lets the caller
     hand over whichever direction it happened to fit.

     ⚠ THE TOLERANCE IS MIRRORED, NOT SHARED. `max(5, 0.25 * max|leg|)` is `fitClockClosure`'s rule
     verbatim — the legs' own scale, so a triple of weak fits is allowed a looser closure than a triple
     of sharp ones. It is duplicated here because that function is inlined into every bundle and this
     one is not, and a gate (`drift-closure-identity`) reads BOTH sources and fails if they diverge. */
  function closeTriple(legs, opts) {
    opts = opts || {};
    if (!legs || legs.length < 3) return null;
    var names = [];
    legs.forEach(function (l) {
      if (!l || !l.a || !l.b) return;
      if (names.indexOf(l.a) < 0) names.push(l.a);
      if (names.indexOf(l.b) < 0) names.push(l.b);
    });
    if (names.length !== 3) return null;

    var dOf = function (a, b) {
      for (var i = 0; i < legs.length; i++) {
        var l = legs[i];
        if (!l || l.ppm == null || !isFinite(l.ppm)) continue;
        if (l.a === a && l.b === b) return l.ppm;
        if (l.a === b && l.b === a) return -l.ppm; // d(B,A) = -d(A,B)
      }
      return null;
    };
    var A = names[0],
      B = names[1],
      C = names[2];
    var d1 = dOf(A, B),
      d2 = dOf(B, C),
      d3 = dOf(C, A);
    /* An absent leg is not a zero. Two legs and a hole close trivially at whatever the two sum to,
       which is a fabricated pass — the same failure as defaulting a missing timestamp to now(). */
    if (d1 == null || d2 == null || d3 == null) return null;

    var err = d1 + d2 + d3;
    var tol = opts.closureTolPpm != null ? opts.closureTolPpm : Math.max(5, 0.25 * Math.max(Math.abs(d1), Math.abs(d2), Math.abs(d3)));
    return {
      nodes: [A, B, C],
      closurePpm: err,
      tolPpm: tol,
      consistent: Math.abs(err) <= tol
    };
  }

  /* One drift line. `r` is a `fitClockDrift` result, `closure` the triple summary computed BEFORE
     this is called (that ordering is the whole fix — see the header). */
  function driftFitLine(r, closure, label) {
    label = label || 'H10↔Verity';
    if (!r || r.offsetMs == null || r.driftPpm == null) return '    ⏱ ' + label + ' drift: unresolved — ' + ((r && r.reason) || 'no fit');

    var v = driftVerdict(closure);
    var ppm = r.driftPpm.toFixed(0);
    var span = r.spanMin;

    /* THE GATED CLAUSE. Seconds-over-the-night is the strongest statement the line makes, and it is
       the one a reader carries away, so it appears only in the 'closed' state. The span rides along
       in every state because a ppm without a span is not interpretable at all (F7: the same rate
       error over 11 min and over 373 min are different claims). */
    var head = v.state === 'closed' ? ppm + ' ppm (' + ((r.driftPpm / 1e6) * span * 60).toFixed(2) + ' s over ' + span + ' min)' : ppm + ' ppm over ' + span + ' min';

    /* The verdict CLOSES the line rather than interrupting the metrics — a reader who stops early
       must still have met it, and a reader who reads to the end must not have to reconstruct it. */
    var verdict = v.state === 'closed' ? '   — ' + v.why : '   — ' + (v.state === 'inconsistent' ? 'VOID' : 'UNCLOSED') + ' (' + v.why + '): not a measurement';

    return (
      '    ⏱ ' +
      label +
      ' drift: ' +
      head +
      ', offset ' +
      (r.offsetMs / 1000).toFixed(2) +
      ' s' +
      '   corr ' +
      (100 * r.medianCorrespondence).toFixed(0) +
      '% vs chance ' +
      (100 * r.chanceCorrespondence).toFixed(0) +
      '%   IQR ' +
      Math.round(r.medianIqrMs) +
      ' ms' +
      (r.confident ? '' : '  — ⚠ ' + r.reason) +
      /* The search window bounds what drift can be SEEN, so a fit pressed against it is reporting the
         instrument, not the pair (a planted 250 ppm reads 49 when the window cannot hold it). */
      (r.maxDriftPpm != null && Math.abs(r.driftPpm) > r.maxDriftPpm * 0.8 ? '  — ⚠ near the ' + r.maxDriftPpm.toFixed(0) + ' ppm search bound' : '') +
      verdict
    );
  }

  /* The closure line itself. Returns null when there was nothing to say — but a REFUSAL is always
     said, because printing nothing is how a drawn O2Ring leg stayed invisible for six nights. */
  function closureLine(cl) {
    if (!cl) return null;
    if (!cl.ok) return cl.excluded && cl.excluded.length ? '    ⏱ 3-source closure: REFUSED — ' + cl.reason : null;
    if (!cl.triples || !cl.triples.length) return null;
    var tri = cl.triples[0];
    return (
      '    ⏱ 3-source closure: ' +
      tri.closurePpm.toFixed(1) +
      ' ppm (identity 0, tol ' +
      tri.tolPpm.toFixed(0) +
      ')' +
      '   ' +
      (tri.consistent ? 'consistent' : '⚠ INCONSISTENT — at least one pairwise fit is wrong') +
      (tri.weakLegs && tri.weakLegs.length ? '   weak legs: ' + tri.weakLegs.join(', ') : '   (all legs confident)') +
      (cl.sharedHostTimebase ? '   ⚠ ' + cl.hostTimedLegs.join('+') + ' share the HOST timebase — less independent than the identity assumes' : '')
    );
  }

  /* `printClockFit`'s head — extracted for the same reason: it states an offset in minutes and a
     precision, and neither had a test. */
  function clockFitLine(fit, nApnea) {
    if (!fit) return '    ⏱ CPAP clock offset: unresolved — no fit';
    var head;
    if (fit.offsetSec == null) head = 'unresolved — ' + fit.reason;
    else
      head =
        (fit.offsetSec / 60).toFixed(2) +
        ' min (' +
        Math.round(fit.offsetSec) +
        ' s)' +
        /* The PLATEAU, not "how far apart the sensors were": a hard ±45 s match window makes the peak
           flat over ~90 s, and quoting its centre without the width states the instrument's precision
           as if it were the data's. */
        (fit.spreadSec != null ? ', ±' + Math.round(fit.spreadSec / 2) + ' s' : '') +
        ', Z ' +
        fit.z.toFixed(1) +
        ' vs own null ' +
        (fit.nullZ == null ? '?' : fit.nullZ.toFixed(1)) +
        ' (p ' +
        fit.pValue +
        ')' +
        /* Not established is a stronger claim than a parenthetical caveat, so it leads. The corpus
           shows why it must: 8 of 29 nights land in the right band WITHOUT clearing their own null.
           Those are correct answers the evidence does not yet support, and saying so is the point. */
        (!fit.confident ? '  — ⚠ ' + fit.reason : '');
    return '    ⏱ CPAP clock offset: ' + head + '   [' + nApnea + ' apnea events]';
  }

  root.DriftReport = {
    driftVerdict: driftVerdict,
    closeTriple: closeTriple,
    driftFitLine: driftFitLine,
    closureLine: closureLine,
    clockFitLine: clockFitLine
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DriftReport;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
