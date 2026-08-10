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
 * each tagged with its `driftSource`. Nothing is silently discarded and nothing is
 * silently promoted. See INTEGRATOR-PAT-VASCULAR Phase 0.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // The published bar (PAT-FEASIBILITY §"When either lands"), plus the two unstated
  // conditions found in code. Values are UNCHANGED from the shipped literals — this is a
  // single-sourcing pass, not a re-tuning one. Do not edit without a brief.
  var PAT_GATE = {
    COUPLING_MIN: 0.55, // matchRate ≥ — published
    BEAT_IQR_MAX_MS: 60, // residIQR ≤ — published
    DRIFT_MAX_MS: 60, // driftRange ≤ for FEASIBLE — published
    DRIFT_DOMINATED_MS: 250, // driftRange > ⇒ DRIFT-DOMINATED — unstated in prose
    LAG_MIN_MS: 60, // median lag ≥ — the `physical` window, unstated in prose
    LAG_MAX_MS: 700 // median lag ≤ — the `physical` window, unstated in prose
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
    if (!cp || !cp.ok) return { tier: 'no', label: 'NOT COUPLED', why: null };
    if (!sc || !sc.ok) return { tier: 'no', label: 'NOT SIMULTANEOUS', why: null };

    var tightBeat = isFinite(cp.residIQR) && cp.residIQR <= PAT_GATE.BEAT_IQR_MAX_MS,
      goodMatch = cp.matchRate >= PAT_GATE.COUPLING_MIN,
      physical = cp.med >= PAT_GATE.LAG_MIN_MS && cp.med <= PAT_GATE.LAG_MAX_MS,
      driftMs = isFinite(cp.driftRange) ? cp.driftRange : Infinity;
    var why = { tightBeat: tightBeat, goodMatch: goodMatch, physical: physical, driftMs: driftMs, driftOK: driftMs <= PAT_GATE.DRIFT_MAX_MS };

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
    var overlapMin = ov && isFinite(ov.min) ? ov.min
      : (Math.min(ecg.t0Ms + ecg.durSec * 1000, ppg.t0Ms + ppg.durSec * 1000) - Math.max(ecg.t0Ms, ppg.t0Ms)) / 60000;
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

  root.PATGate = { PAT_GATE: PAT_GATE, verdict: verdict, sharedClock: sharedClock, SC_RATE_TOL: SC_RATE_TOL, SC_MIN_OVERLAP_MIN: SC_MIN_OVERLAP_MIN, VERSION: '1.1.0' };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
