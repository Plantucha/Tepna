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
    driftFitLine: driftFitLine,
    closureLine: closureLine,
    clockFitLine: clockFitLine
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DriftReport;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
