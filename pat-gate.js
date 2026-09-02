/*
 * pat-gate.js — Tepna · the PAT feasibility promotion gate, single-sourced
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF §1.5).
 *
 * The PAT promotion gate — drift ≤ 60 ms · coupling ≥ 55 % · beat-to-beat IQR ≤ 60 ms —
 * is the bar `PAT-FEASIBILITY-2026-07-08-BRIEF` publishes and `INTEGRATOR-PAT-VASCULAR`
 * Phase 0 is measured against. Before this module it lived as bare literals in
 * `verdict()` inside `pat-feasibility-worker.js` AND was duplicated as five more literals
 * in `pat-feasibility.js`'s renderer, with no shared constant and NO test executing the
 * math (it had to be hand-extracted via `vm` to be checked at all).
 *
 * Two divergences between the published prose and the shipped code were found that way,
 * and both are preserved here DELIBERATELY and documented rather than silently "fixed":
 *
 *   1. A FOURTH condition exists that no brief states — `physical`: the median lag must
 *      fall in [60, 700] ms. A night meeting all three published bars but with a median
 *      lag outside that window returns WEAK COUPLING. It is a real sanity check (a lag
 *      below ~60 ms is not a pulse transit; above ~700 ms is a mis-match), so it stays —
 *      but it is now NAMED and testable instead of anonymous.
 *
 *   2. The tier is decided on RAW, UNCORRECTED drift. `verdict()` is called once, before
 *      the ACC-sync stage computes the drift-corrected coupling (`cpCorr`), and cpCorr
 *      never re-enters it. A night whose ACC-corrected drift cleared 60 ms would still
 *      report DRIFT-DOMINATED.
 *
 * On (2) this module deliberately does NOT change the meaning of the primary verdict —
 * whether the tier SHOULD reflect corrected drift is a scientific call for the owner, not
 * a refactor. Instead the caller now ALSO evaluates the gate on cpCorr and reports both,
 * each tagged with its `driftSource`. Nothing is silently promoted.
 *
 * ⚠️ **"Nothing is silently discarded" was FALSE from the day it was written, and is true again as of
 * 2026-09-02.** The caller did evaluate the gate on `cpCorr` and publish `vdCorr` — but only as far as
 * the WORKER. `pat-feasibility.js` read `m.vd` and never `m.vdCorr`, so the second verdict crossed the
 * worker boundary and was dropped at the last step: computed, carried, never consumed. The claim was
 * checked at the layer that produced the value and not at the layer that renders it, which is exactly
 * how an invariant asserted in a comment outlives the thing it describes. The renderer now surfaces
 * the corrected verdict beside the primary, tagged by the drift it reflects.
 *
 * The tier is STILL decided on raw drift and that is still deliberate — see (2) above. Surfacing the
 * second verdict decides nothing; promoting on it remains the owner's call.
 * See INTEGRATOR-PAT-VASCULAR Phase 0.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // The published bar (PAT-FEASIBILITY §"When either lands"), plus the two unstated
  // conditions found in code. Values are UNCHANGED from the shipped literals — this is a
  // single-sourcing pass, not a re-tuning one. Do not edit without a brief.
  var PAT_GATE = {
    COUPLING_MIN: 0.55, // matchRate ≥ — published
    BEAT_IQR_MAX_MS: 60, // residIQR ≤ — published
    /* Both bars keep their published VALUES; what they are measured against changed on 2026-08-10
       (PAT-DRIFT-STATISTIC). They now weigh `cp.stepP95` — the p95 |Δ bin median| between adjacent
       qualified bins — instead of `cp.driftRange`, which is bounded by, and saturates at, the 450 ms
       pairing window: nine box nights over ~6 h all read 420–442. Not a re-tuning; the numbers are
       untouched precisely so this cannot be one. `driftRange` stays in the payload as a diagnostic,
       and a caller that supplies only `driftRange` still gets the old behaviour. */
    DRIFT_MAX_MS: 60, // stepP95 ≤ for FEASIBLE — published
    DRIFT_DOMINATED_MS: 250, // stepP95 > ⇒ DRIFT-DOMINATED — unstated in prose
    LAG_MIN_MS: 60, // median lag ≥ — the `physical` window, unstated in prose
    LAG_MAX_MS: 700, // median lag ≤ — the `physical` window, unstated in prose
    /* The share of beats the `[200,650]` pairing window DISCARDS, above which the night is refused
       (PAT-WINDOW-CENSORING-2026-08-11). Not a tuned value: over the box corpus the two populations
       are 0.0 / 0.1 / 0.2 % against 4.9 – 97.4 %, so any bound between them separates the corpus, and
       2 % sits 10× above the clean group and 2.5× below the nearest censored one. Scoped to the
       ANALYSED BEATS, not to the file — which is why 2026-08-02 survives despite its device axis
       carrying a 22 s step elsewhere in the recording. */
    CENSORED_MAX_PCT: 2
  };

  /* Evaluate the gate for one night.
   *   ov = overlap summary {min}   cp = coupling summary {ok, matchRate, residIQR, med, driftRange}
   *   sc = shared-clock test {ok}
   * → { tier:'go'|'maybe'|'no', label, why:{…} }  — `why` exposes each leg so a consumer can
   *   say WHICH condition failed instead of just showing a label (the old code could not).
   *
   * Tier/label output is IDENTICAL to the pre-extraction verdict() for every input the caller
   * produces — same threshold VALUES, only named. Two deltas, both additive and deliberate:
   * `why` is new, and a null/undefined `ov`/`cp`/`sc` now returns a label instead of throwing
   * (the old code dereferenced them unguarded). No input that previously returned a tier
   * returns a different one. */
  /* `ax` (OPTIONAL, LAST — back-compat per CLAUDE.md) is the DexClock.hostAxis result for the night.
     NO SECOND CLOCK ⇒ NO VERDICT. Every number this gate weighs is a comparison BETWEEN TWO DEVICES,
     so it presupposes the two sit on one timebase. `hostAxis.independent === false` says they do not:
     the capture host's column was DERIVED from the device stamp (measured discriminator — residual
     spread ≤ ~1 ms, one stamp quantum, against 101.89–5124 ms where a real second clock exists), so
     each device rides its own crystal and per-device wander lands directly in the beat-lag scatter.
     It is then indistinguishable from the physiology the gate is trying to measure: on 2026-08-09
     every H10 night in the corpus measured 0.98 ms — all phone captures — while the PAT verdict built
     on them attributed 84–99 ms of scatter to PTT variability. That attribution is not identifiable
     without a shared clock, so the honest output is a refusal, not a tier.
     Absent `ax` the behaviour is UNCHANGED — only an explicit `false` refuses. That is deliberate
     back-compat, and it is why the refusal names itself in `label`: a caller that never passes an
     axis is visible as 'no axis' in `why`, not silently treated as if it had one. */
  function verdict(ov, cp, sc, ax) {
    if (!ov || ov.min <= 0) return { tier: 'no', label: 'NO OVERLAP', why: null };
    if (ax && ax.independent === false)
      return {
        tier: 'no',
        label: 'NO SHARED CLOCK',
        why: {
          independent: false,
          spreadMs: ax.spreadMs != null ? ax.spreadMs : null,
          reason: 'host column is derived from the device stamp — the two devices are not on one timebase, so beat-lag scatter cannot be separated from per-device clock wander'
        }
      };
    /* A DRAWN AXIS IS NOT A CLOCK — AND IT FAILS THE CHECK ABOVE *OPEN*. `timingSource:'none'` is
       ppgdex-dsp's verdict (`ppgdex-dsp.js:740`) that the device axis was CONSTRUCTED — `sample_index ×
       an assumed rate` — AND that no host anchors were usable: the recording carries no timing
       information whatsoever (CLAUDE.md §7, "A device whose axis was DRAWN is not a clock").
       This CANNOT be folded into NO SHARED CLOCK, and that is the whole defect. That branch tests
       `independent === false`, but `'none'` is a hostAxis REFUSAL (`{ok:false, reason, n}`), so it
       carries no `independent` member at all — `undefined`, not `false`. The *more* degenerate input
       therefore walked straight through the guard that catches the *less* degenerate one: a leg with no
       clock passed where a leg with an unshared clock was refused.
       Why it must be a refusal and not a downgrade: under a drawn axis both trains advance at an
       ASSUMED rate, so the inter-device lag drifts by the difference of two rate errors and every PAT
       number below faithfully measures that drift as if it were PTT. `O2RING-SYNTHESISED-AXIS`
       retracted two of three pairs over exactly this, and `CLOCK-CLOSURE-THREE-SOURCE` recorded its
       signature — "six nights failed with all legs confident".
       `'host'` is deliberately NOT refused: the axis was drawn, but real host anchors then placed it on
       host time, so the two devices genuinely do sit on one timebase — which is the condition this gate
       exists to require, however the axis got there. Refusing it would cost the box nights that are the
       only ones with a second clock at all. */
    if (ax && ax.timingSource === 'none')
      return {
        tier: 'no',
        label: 'DRAWN AXIS',
        why: {
          timingSource: 'none',
          drawn: ax.drawn === undefined ? null : ax.drawn,
          quantizedShare: ax.quantizedShare == null ? null : ax.quantizedShare,
          reason:
            'the device axis was constructed from a sample index and an assumed rate, and no host anchors were usable — the recording carries no timing, so a beat-lag is a rate-error difference rather than a PTT'
        }
      };
    if (!cp || !cp.ok) return { tier: 'no', label: 'NOT COUPLED', why: null };
    if (!sc || !sc.ok) return { tier: 'no', label: 'NOT SIMULTANEOUS', why: null };
    /* REFUSE A NIGHT THE WINDOW HAS EATEN. `[PHYS_LO, PHYS_HI]` was treated as a plausibility filter;
       it is a censoring cut, and where the inter-device offset puts the true lag outside it the window
       keeps an edge-biased remnant and every leg below is computed on that. This is a REFUSAL, not a
       downgrade, for the same reason as NO SHARED CLOCK: the quantity is not identifiable, so a tier
       would be a guess dressed as a measurement. Measured: 16 of 19 box site-nights lose most of their
       beats here, and one at 97.4 % (median lag 831 ms) still produced a confident PAT number.
       Absent `censoredPct` the behaviour is UNCHANGED — a caller that cannot compute it is not refused,
       which keeps every pre-2026-08-11 consumer working. */
    if (isFinite(cp.censoredPct) && cp.censoredPct > PAT_GATE.CENSORED_MAX_PCT)
      return {
        tier: 'no',
        label: 'WINDOW-CENSORED',
        why: {
          censoredPct: cp.censoredPct,
          censoredN: cp.censoredN != null ? cp.censoredN : null,
          reason:
            'the physiological window discards ' +
            cp.censoredPct.toFixed(1) +
            ' % of beats — the inter-device offset puts the true lag outside it, so what survives is an edge-biased remnant, not a transit time'
        }
      };

    var tightBeat = isFinite(cp.residIQR) && cp.residIQR <= PAT_GATE.BEAT_IQR_MAX_MS,
      goodMatch = cp.matchRate >= PAT_GATE.COUPLING_MIN,
      physical = cp.med >= PAT_GATE.LAG_MIN_MS && cp.med <= PAT_GATE.LAG_MAX_MS,
      /* Prefer `stepP95`; fall back to `driftRange` so a pre-2026-08-10 caller (or a night with too
         few adjacent qualified bins to form a step) behaves exactly as before rather than passing on
         a missing field. `driftStat` names which one was weighed, so a reader is never left guessing. */
      driftStat = isFinite(cp.stepP95) ? 'stepP95' : 'driftRange',
      driftMs = isFinite(cp.stepP95) ? cp.stepP95 : isFinite(cp.driftRange) ? cp.driftRange : Infinity;
    var why = {
      tightBeat: tightBeat,
      goodMatch: goodMatch,
      physical: physical,
      driftStat: driftStat,
      driftMs: driftMs,
      driftOK: driftMs <= PAT_GATE.DRIFT_MAX_MS,
      driftRange: isFinite(cp.driftRange) ? cp.driftRange : null // diagnostic; see PAT_GATE comment
    };

    if (goodMatch && tightBeat && physical && driftMs <= PAT_GATE.DRIFT_MAX_MS) return { tier: 'go', label: 'FEASIBLE', why: why };
    if (goodMatch && tightBeat && driftMs > PAT_GATE.DRIFT_DOMINATED_MS) return { tier: 'no', label: 'DRIFT-DOMINATED', why: why };
    if (tightBeat && physical) return { tier: 'maybe', label: 'PROMISING', why: why };
    return { tier: 'maybe', label: 'WEAK COUPLING', why: why };
  }

  /* SIMULTANEITY IS A PROPERTY OF THE OVERLAP, NOT OF THE FILE HEADERS (PAT-COMPENDIUM §9.1).
     The old form was `dT0 <= 5000 && |nEcg - nPpg| / max <= 0.12`, and BOTH halves measured something
     other than what they are named for. Measured over the 15 box nights on 2026-08-10 it refused 21 of
     30 pairings, and it refuses BEFORE `verdict()` looks at coupling or beat IQR — so the numbers that
     actually passed were never reached.
  
       · `dT0` is the difference in FILE START times. The capture host starts BLE streams sequentially
         and a device reconnects on its own schedule, so a stagger of 55 s to 16 276 s is routine and
         says nothing whatever about a shared timebase. A 5 s tolerance cannot be met by this rig.
       · `|nEcg - nPpg|` compares WHOLE-FILE beat counts for files of different lengths. On 2026-08-02
         the ECG covers 1.8 h and the PPG 10 h, giving 5551 vs 31 580 and a ratio of 0.824 — a duration
         mismatch reported as a clock failure.
  
     This is the SAME defect `matchRate` already carried and was fixed for (see the `nCoverable` note in
     coupledPAT): a statistic over whole files, on a pair that only overlaps in part, measures the
     recording geometry. `sharedClock` never got the same treatment.
  
     So: require a real common interval, and compare BEAT RATES rather than counts. A rate is
     duration-independent by construction, which is exactly the property the count form lacked. The
     0.12 tolerance is carried over unchanged and now applies to the rate — this is a fix to WHAT is
     measured, not a re-tuning of how much is allowed.
     `dT0` and `beatRatio` are still REPORTED, because they are useful diagnostics and because a reader
     comparing against a pre-2026-08-10 run needs to see the old numbers; they simply no longer decide. */
  var SC_RATE_TOL = 0.12, // was the beat-COUNT tolerance; same number, now on rates
    SC_MIN_OVERLAP_MIN = 5; // a common interval shorter than this cannot support a night's verdict
  function sharedClock(ecg, ppg, ov) {
    var dT0 = Math.abs(ecg.t0Ms - ppg.t0Ms),
      beatRatio = Math.abs(ecg.n - ppg.n) / Math.max(ecg.n, ppg.n, 1);
    var ecgHz = ecg.durSec > 0 ? ecg.n / ecg.durSec : NaN,
      ppgHz = ppg.durSec > 0 ? ppg.n / ppg.durSec : NaN;
    var rateRatio = isFinite(ecgHz) && isFinite(ppgHz) && Math.max(ecgHz, ppgHz) > 0 ? Math.abs(ecgHz - ppgHz) / Math.max(ecgHz, ppgHz) : Infinity;
    /* No `ov` ⇒ derive the common interval here. pat-gate deliberately does not import the worker's
       `overlap()`; duplicating three lines is cheaper than a dependency in the other direction. */
    var overlapMin = ov && isFinite(ov.min) ? ov.min : (Math.min(ecg.t0Ms + ecg.durSec * 1000, ppg.t0Ms + ppg.durSec * 1000) - Math.max(ecg.t0Ms, ppg.t0Ms)) / 60000;
    return {
      dT0: dT0,
      beatRatio: beatRatio, // diagnostic only — see the note above
      ecgHz: ecgHz,
      ppgHz: ppgHz,
      rateRatio: rateRatio,
      overlapMin: overlapMin,
      ok: overlapMin >= SC_MIN_OVERLAP_MIN && rateRatio <= SC_RATE_TOL
    };
  }

  /* THE DRIFT STATISTICS (PAT-DRIFT-STATISTIC-2026-08-10). Lives here, not in the worker, for the
     same reason `sharedClock` moved: the worker is in no test lane, so logic left there is logic
     nothing executes. `bins` is one record per occupied 5-minute bin, in bin-index order:
       { bin, med, n, nBeats, iqr }   n = paired beats · nBeats = ECG beats in the SAME bin
     Two rules, both from the brief:
       · a bin qualifies on MATCH RATE (n/nBeats) and its own IQR — never on an absolute count of n,
         which is §3's defect; a bin at 3 % match is edge-censored toward PHYS_HI, not a measurement.
         THIS RULE HAS A NAME AND A CITATION — it is CIRCULAR ANALYSIS ("double dipping"): the use of one
         dataset for both selection and the selective analysis, invalid whenever the result statistic is
         not independent of the selection criterion. Selecting the bin with the tightest IQR selects the
         most CENSORED bin, because censoring toward PHYS_HI is what makes an IQR tight — committed here
         on 2026-08-12, when a 5-minute window at 11.6 ms residIQR was called the best and was 89 %
         censored. The prescribed remedy is stronger than "be careful": use INDEPENDENT data for the
         selection and for the analysis. Kriegeskorte, Simmons, Bellgowan & Baker, Nat Neurosci 12:535
         (2009), <https://www.nature.com/articles/nn.2303> — 42 % of 134 fMRI papers did this.
         See briefs/CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md §3
       · steps are taken only between bins ADJACENT IN INDEX, so a recording gap is not charged as a
         step — the lag is free to have moved during the gap and nothing observed it */
  var BIN_MATCH_MIN = 0.8;
  function driftStats(bins, matchMin, iqrMax) {
    var mm = isFinite(matchMin) ? matchMin : BIN_MATCH_MIN,
      im = isFinite(iqrMax) ? iqrMax : PAT_GATE.BEAT_IQR_MAX_MS;
    var list = bins && bins.length ? bins : [];
    var qual = [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i],
        nb = b.nBeats > 0 ? b.nBeats : 0,
        mr = nb ? b.n / nb : 0;
      if (nb && mr >= mm && isFinite(b.iqr) && b.iqr <= im) qual.push(b);
    }
    var steps = [];
    for (var k = 1; k < qual.length; k++) if (qual[k].bin === qual[k - 1].bin + 1) steps.push(Math.abs(qual[k].med - qual[k - 1].med));
    function rangeOf(a) {
      if (a.length < 2) return NaN;
      var lo = a[0],
        hi = a[0];
      for (var j = 1; j < a.length; j++) {
        if (a[j] < lo) lo = a[j];
        if (a[j] > hi) hi = a[j];
      }
      return hi - lo;
    }
    /* p95 by nearest-rank on the sorted steps. With few steps this lands on the maximum, which is the
       conservative direction: a short recording is judged by its worst observed step rather than being
       let through on a percentile it has too little data to support. */
    var srt = steps.slice().sort(function (x, y) {
      return x - y;
    });
    var stepP95 = srt.length ? srt[Math.min(srt.length - 1, Math.ceil(0.95 * srt.length) - 1)] : NaN;
    return {
      stepP95: stepP95,
      stepMed: srt.length ? srt[Math.floor(srt.length / 2)] : NaN,
      nSteps: steps.length,
      binsQualified: qual.length,
      binsTotal: list.length,
      driftRange: rangeOf(
        list.map(function (x) {
          return x.med;
        })
      ),
      driftRangeQual: rangeOf(
        qual.map(function (x) {
          return x.med;
        })
      )
    };
  }

  /* TWO LEGS, TWO AXES, ONE VERDICT. A PAT number is a comparison BETWEEN two recordings, so it is only
     as good as the WORSE of their two clocks — an honest H10 axis does not redeem a drawn ring one, and
     handing `verdict` whichever axis came first would let the good leg vouch for the bad. `verdict`
     takes a single `ax`, so *which* axis it gets is a gate policy, and it lives here rather than in the
     worker for the reason `verdict` and `sharedClock` moved here at all (ENGINE-VERIFICATION-FINDINGS
     §1.5): a criterion that lives in a Web Worker cannot be executed by a test.
     Ordering is SEVERITY, not preference. A drawn axis outranks a non-independent one because it is the
     stronger statement — no timing at all, versus real timing on an unshared crystal — and because the
     two are not comparable through `independent`, which a drawn axis does not carry (see `verdict`).
     Nulls are dropped rather than defaulted: a leg that reports no axis must not be read as a clean one,
     it simply does not vote, and if NO leg reports an axis the result is `null` so `verdict` keeps its
     documented back-compat behaviour of not refusing. */
  function worstAxis(a, b) {
    var xs = [a, b].filter(function (x) {
      return x != null;
    });
    if (!xs.length) return null;
    for (var i = 0; i < xs.length; i++) if (xs[i].timingSource === 'none') return xs[i];
    for (var j = 0; j < xs.length; j++) if (xs[j].independent === false) return xs[j];
    return xs[0];
  }

  /* HOW THE VERDICT PAIR IS PRESENTED — pure, so it is testable without a DOM (2026-09-02).
     `pat-feasibility.js` is an anonymous IIFE with no export surface, so the composition it used to
     do inline was unreachable from any test: `dex-tests.js` references the WORKER five times and the
     renderer zero. That asymmetry is why `vdCorr` could be published, cross the worker boundary and
     be dropped at the render step while every test stayed green — the tests scanned the layer that
     produced the value and never the layer that consumes it.

     Returns the cell TEXT and TITLE for a night's payload. It reads `vdCorr` and never decides with
     it: the tier stays the caller's, on raw drift, because promoting on corrected drift is the
     owner's scientific call (see (2) above). */
  function verdictCell(m) {
    if (!m || !m.vd) return { text: '', title: '' };
    var t = m.vd.label;
    if (m.cp && m.cp.ok && isFinite(m.cp.driftRange)) t += ' \u00b7 ' + m.cp.driftRange.toFixed(0) + 'ms';
    if (m.cpCorr && m.cpCorr.ok && isFinite(m.cpCorr.driftRange)) t += ' \u2192 ' + m.cpCorr.driftRange.toFixed(0) + 'ms\u2726';
    var hasCorr = !!(m.vdCorr && m.vdCorr.label);
    if (hasCorr) t += ' \u00b7 corrected(acc): ' + m.vdCorr.label;
    var title =
      'primary verdict on ' +
      (m.driftSource || 'raw') +
      ' drift: ' +
      m.vd.label +
      '\n' +
      (hasCorr ? 'ACC-corrected verdict: ' + m.vdCorr.label + (m.vdCorr.label === m.vd.label ? ' (agrees)' : ' (DIFFERS from primary)') : 'ACC-corrected verdict: not available for this night');
    return { text: t, title: title, differs: hasCorr && m.vdCorr.label !== m.vd.label };
  }

  root.PATGate = {
    PAT_GATE: PAT_GATE,
    verdict: verdict,
    verdictCell: verdictCell,
    worstAxis: worstAxis,
    sharedClock: sharedClock,
    driftStats: driftStats,
    BIN_MATCH_MIN: BIN_MATCH_MIN,
    SC_RATE_TOL: SC_RATE_TOL,
    SC_MIN_OVERLAP_MIN: SC_MIN_OVERLAP_MIN,
    VERSION: '1.2.0'
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
