/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   cohort-full.js — FULL-lane (≤500 cert lane) waveform renderers + node runners
   for the Ganglior Cohort Validation Harness. Loaded ONLY in the 'full' worker.
   ----------------------------------------------------------------------------
   The FAST lane never builds a waveform. The FULL lane adds the two pacing nodes
   on ONE representative ~9-min window per patient (the apnea-cluster window from
   SYNTH.pickWindow) so runtime stays bounded while the REAL morphology pipelines
   actually run:
     · PpgDex — SYNTH.renderPPG(tl,win) → PPGDSP.parsePPG → PPGDSP.analyze (176 Hz)
     · ECGDex — renderECGInt16(tl,win)  → ECGDSP.analyze({int16,fs,t0Ms,deviceRR})

   ⚠ KNOWN HARD PART #1 (per the brief): ECGDex wants a raw int16 µV ECG, not RR.
   synth-gen only emits RR text, and the RR→PQRST renderer lives *inside*
   ECGDSP.genSynthetic (not factored out). Rather than edit the shipped DSP (which
   would trip the regression + provenance gates), we render the µV waveform HERE,
   from the SAME master-timeline RR beats SYNTH.buildRR(tl) feeds every other node
   — so ECG stays event-coherent with Oxy/PPG/Pulse (shared apnea clusters), and
   ECGDSP's own Pan-Tompkins must re-derive those beats from the morphology. This
   is a genuine round-trip test of the detector, not a replay of the truth RR.

   100% local. Clock Contract: t0Ms is floating wall-clock ms (from the timeline).
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── PQRST + µV renderer MOVED to synth-gen.js (GENERATOR-FOLLOWUPS-II §3 step 1) ──────────────
     They now live beside every other node's waveform renderer, where ECGDex can actually load them —
     `cohort-full.js` is a FULL-lane-worker file, which is why ECGDex could not use this renderer and
     stayed single-recording. These two remain exported here, delegating, so the FULL-lane harness,
     `qrs-yield-worker.js` and `qrs-equiv-worker.js` keep their existing 3-arg call sites unchanged.

     The lift was byte-identical (same constants, same phase anchoring, same RNG), so the
     waveform-fidelity snapshot and both published QRS analyses are unmoved — asserted, not assumed,
     by the `synth-gen ≡ cohort-full` parity leg in tests/dex-tests.js. */
  function pqrst(ph, rrSec) {
    return SYNTHREF().pqrst(ph, rrSec);
  }
  function renderECGInt16(tl, win, SYNTH) {
    return (SYNTH && SYNTH.renderECGInt16 ? SYNTH : SYNTHREF()).renderECGInt16(tl, win);
  }
  /* The engine is a global loaded by the worker's own importScripts list; resolve it at CALL time,
     never at module scope — cohort-full.js may be imported before synth-gen.js and capturing an
     undefined here would fail long after the real cause. */
  function SYNTHREF() {
    var S = global.SYNTH;
    if (!S || typeof S.renderECGInt16 !== 'function') throw new Error('cohort-full: SYNTH.renderECGInt16 unavailable — load synth-gen.js before cohort-full.js');
    return S;
  }

  global.CohortFull = { renderECGInt16: renderECGInt16, pqrst: pqrst };
})(typeof window !== 'undefined' ? window : this);
