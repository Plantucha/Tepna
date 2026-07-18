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
  function verdict(ov, cp, sc) {
    if (!ov || ov.min <= 0) return { tier: 'no', label: 'NO OVERLAP', why: null };
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

  root.PATGate = { PAT_GATE: PAT_GATE, verdict: verdict, VERSION: '1.0.0' };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
