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

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussFrom(rng) {
    var u = 0,
      v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ── PQRST morphology: sum of skew-tuned Gaussians (µV), phase 0..1 within a beat ──
  // Amplitudes/widths fit the Lead-II look ECGDSP.genSynthetic targets: R ~1.1 mV,
  // sharp QRS, broad T, small P. Width scales mildly with RR (rate-dependent QT).
  function pqrst(ph, rrSec) {
    function g(c, amp, w) {
      var d = ph - c;
      return amp * Math.exp(-(d * d) / (2 * w * w));
    }
    var qtScale = Math.min(1.25, Math.max(0.8, Math.sqrt(rrSec / 0.8))); // Bazett-ish T stretch
    return (
      g(0.18, 90, 0.025) + // P
      g(0.385, -180, 0.012) + // Q
      g(0.41, 1180, 0.0085) + // R
      g(0.435, -300, 0.013) + // S
      g(0.62, 235, 0.04 * qtScale) // T
    );
  }

  // Render a window of the night's RR beats into an Int16 µV ECG @130 Hz + deviceRR.
  // tl = SYNTH.masterTimeline(...) ; win = { startRel, lenSec } from SYNTH.pickWindow.
  function renderECGInt16(tl, win, SYNTH) {
    var fs = 130;
    var t0Ms = tl.t0Ms + win.startRel * 1000;
    var N = Math.round(win.lenSec * fs);
    var rng = mulberry32((tl.seed ^ 0x5eed1ce) >>> 0);

    // beats overlapping the window (+2 s guard each side), from the SAME RR series
    var all = SYNTH.buildRR(tl);
    var beats = all.filter(function (b) {
      return b.tMs >= t0Ms - 2000 && b.tMs <= t0Ms + win.lenSec * 1000 + 2000;
    });
    if (beats.length < 3) return null;

    var ecg = new Float32Array(N);
    var bi = 0;
    // baseline wander + mains-ish low noise; QRS amplitude dips during apnea (perfusion)
    for (var i = 0; i < N; i++) {
      var ms = t0Ms + Math.round((i / fs) * 1000);
      var rel = win.startRel + i / fs;
      while (bi < beats.length - 1 && beats[bi + 1].tMs <= ms) bi++;
      var bcur = beats[bi],
        bnext = beats[Math.min(bi + 1, beats.length - 1)];
      // R-CENTER each beat on its TRUE time. The old form measured phase from the beat's
      // ONSET (ph = (ms − bcur.tMs)/span) with the R lobe at template phase 0.41, so each
      // R landed at bcur.tMs + 0.41·RR and the rendered R-to-R interval became
      // RR + 0.41·ΔRR — a low-pass of the true tachogram that attenuated reconstructed
      // beat-to-beat rMSSD ≈26% (a renderer artifact, NOT a detector property; surfaced by
      // qrs-yield-analysis.html). Picking the NEAREST beat and offsetting phase so template
      // 0.41 sits exactly on nb.tMs places every R at its true instant → detected R-to-R ==
      // true RR (modulo 130 Hz quantization), so ECGDex rMSSD is faithful and the three-way
      // rMSSD equivalence (rmssd-equivalence.html) can use the ECG arm as a real reference.
      var nb = Math.abs(ms - bcur.tMs) <= Math.abs(bnext.tMs - ms) ? bcur : bnext;
      var nbi = nb === bcur ? bi : Math.min(bi + 1, beats.length - 1);
      var prevB = beats[Math.max(0, nbi - 1)];
      var span = Math.max(300, nb.tMs - prevB.tMs) || 900; // local RR (QT/width scaling)
      var ph = Math.max(0, Math.min(1, 0.41 + (ms - nb.tMs) / span)); // template R (0.41) at nb.tMs
      var amp = 1.0;
      var wander = 70 * Math.sin((2 * Math.PI * rel) / 11) + 35 * Math.sin((2 * Math.PI * rel) / 3.7); // resp + drift
      ecg[i] = pqrst(ph, span / 1000) * amp + wander + gaussFrom(rng) * 14;
    }
    var int16 = new Int16Array(N);
    for (var k = 0; k < N; k++) {
      var v = Math.round(ecg[k]);
      if (v > 32767) v = 32767;
      if (v < -32768) v = -32768;
      int16[k] = v;
    }

    // ground-truth device RR rows for the validation card (windowed)
    var devRR = [];
    for (var j = 1; j < beats.length; j++) devRR.push({ tsMs: beats[j].tMs, rr: Math.round(beats[j].tMs - beats[j - 1].tMs) });

    return { int16: int16, fs: fs, t0Ms: t0Ms, durSec: win.lenSec, source: 'cohort-synth', deviceRR: devRR, gaps: [] };
  }

  global.CohortFull = { renderECGInt16: renderECGInt16, pqrst: pqrst };
})(typeof window !== 'undefined' ? window : this);
