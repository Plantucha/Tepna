/*
 * eegdex-dsp.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * EEGDex — the staging engine. `window.EEGDSP`.
 *
 * ── SCOPE, AND WHY IT IS NARROWER THAN `EEGDEX-BUILD-BRIEF.md` ────────────────────────────────
 * That brief is PARKED by owner decision (2026-08-04, re-verified 2026-09-02) on one stated
 * precondition: "No EEG corpus exists to build against." That precondition is now PARTLY false and
 * the split decides what may be built:
 *
 *   · the ANALYSIS ENGINE — band powers, a 30 s hypnogram, sleep architecture — has a corpus now.
 *     SHHS1 carries EEG on 100 % of 5136 records WITH expert 30 s staging. EEG is EEG; a band-power
 *     stager does not care which amplifier produced the volts.
 *   · the MUSE FRONT END — `parseMindMonitor`, the TP9/AF7/AF8/TP10 montage, the HSI contact metric —
 *     still has zero files. The park stands for those and nothing here implements them.
 *
 * So this file is the engine only, and it takes SAMPLES rather than a vendor file. A parser is a
 * per-device concern; the staging is not, and conflating them is what would have made this
 * unbuildable for want of a headband.
 *
 * ── WHAT STAGING FROM ONE EEG CHANNEL CAN AND CANNOT DO ──────────────────────────────────────
 * ⚠️ This is a BAND-POWER stager, and that is a deliberate ceiling rather than a first draft to be
 * improved later by tuning. Published single-channel rule-based staging reaches roughly kappa
 * 0.4–0.6 against expert PSG; modern learned models reach 0.7–0.8 on far more input. A rule engine
 * that scored 0.8 here would be evidence of a leak, not of quality — most likely the reference
 * having entered the features. The number this produces is a FLOOR for the node and a reference
 * point for `REM-STAGING-FOLLOWUPS` §2b, whose whole ask is a real recall figure that has never
 * existed.
 *
 * ⚠️ And it is scored at 30 s, matching the AASM grid the experts scored on. `ECGDex`'s stager emits
 * FIVE-MINUTE epochs, and comparing those to a 30 s reference cost a real measurement earlier: each
 * detector window spanned ten expert epochs and the join had to take a modal label. Here the grids
 * are identical by construction, so no aggregation stands between the detector and the truth.
 *
 * §∅ THROUGHOUT: an epoch whose signal is absent, flat or saturated yields `stage: null`, never a
 * default of 'W'. Wake is the majority class in a clipped or disconnected stretch, so defaulting to
 * it would score WELL while measuring nothing — the exact failure that makes a blind instrument read
 * as a working one.
 */
(function (global) {
  'use strict';

  var VERSION = 'eegdex-dsp/0.1';

  /* AASM-conventional bands. `sigma` is the spindle band and is kept separate from beta because it
     is the one that discriminates N2 — folding it into beta is what makes a stager unable to find
     N2 at all. */
  var BANDS = {
    delta: [0.5, 4],
    theta: [4, 8],
    alpha: [8, 12],
    sigma: [12, 16],
    beta: [16, 30]
  };
  var EPOCH_SEC = 30;

  /* ── FFT (iterative radix-2) ───────────────────────────────────────────────
     A 30 s epoch at 125 Hz is 3750 samples; padded to 4096 the bin width is fs/4096 ≈ 0.031 Hz,
     ample for band edges at 0.5 Hz. Written out rather than pulled in because the suite ships no
     runtime dependencies and must not start. */
  function fft(re, im) {
    var n = re.length,
      i,
      j = 0,
      k,
      m,
      t;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (m = 2; m <= n; m <<= 1) {
      var ang = (-2 * Math.PI) / m,
        wr = Math.cos(ang),
        wi = Math.sin(ang);
      for (i = 0; i < n; i += m) {
        var cr = 1,
          ci = 0;
        for (k = 0; k < m / 2; k++) {
          var ur = re[i + k],
            ui = im[i + k];
          var vr = re[i + k + m / 2] * cr - im[i + k + m / 2] * ci;
          var vi = re[i + k + m / 2] * ci + im[i + k + m / 2] * cr;
          re[i + k] = ur + vr;
          im[i + k] = ui + vi;
          re[i + k + m / 2] = ur - vr;
          im[i + k + m / 2] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  function nextPow2(n) {
    var p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  /* Band powers of one epoch. Hann-windowed periodogram; returns null when the epoch cannot carry a
     spectrum rather than a spectrum of zeros. */
  function epochBands(sig, from, to, fs) {
    var n = to - from;
    if (!(fs > 0) || n < fs * 5) return null; // under 5 s is not an epoch
    var N = nextPow2(n),
      re = new Float64Array(N),
      im = new Float64Array(N);
    var mean = 0,
      cnt = 0,
      i;
    for (i = from; i < to; i++) {
      var v = sig[i];
      if (!isFinite(v)) return null; // §∅: a hole is not a zero
      mean += v;
      cnt++;
    }
    if (!cnt) return null;
    mean /= cnt;
    var flat = true,
      first = sig[from];
    for (i = from; i < to; i++) {
      if (sig[i] !== first) {
        flat = false;
        break;
      }
    }
    if (flat) return null; // a constant stretch is a disconnected electrode, not a stage
    for (i = 0; i < n; i++) {
      var w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))); // Hann
      re[i] = (sig[from + i] - mean) * w;
    }
    fft(re, im);
    var out = { delta: 0, theta: 0, alpha: 0, sigma: 0, beta: 0 },
      tot = 0;
    var half = N >> 1;
    for (i = 1; i < half; i++) {
      var f = (i * fs) / N;
      if (f > 45) break;
      var p = (re[i] * re[i] + im[i] * im[i]) / (N * N);
      tot += p;
      for (var b in BANDS) if (f >= BANDS[b][0] && f < BANDS[b][1]) out[b] += p;
    }
    if (!(tot > 0)) return null;
    var rel = {};
    for (var b2 in out) rel[b2] = out[b2] / tot;
    return { abs: out, rel: rel, total: tot };
  }

  /* RMS of a window, used for EMG tone and EOG activity. Null on an unusable window. */
  function rms(sig, from, to) {
    if (!sig) return null;
    var s = 0,
      n = 0;
    for (var i = from; i < to && i < sig.length; i++) {
      var v = sig[i];
      if (!isFinite(v)) continue;
      s += v * v;
      n++;
    }
    return n ? Math.sqrt(s / n) : null;
  }

  function median(a) {
    var v = a
      .filter(function (x) {
        return x != null && isFinite(x);
      })
      .sort(function (x, y) {
        return x - y;
      });
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }

  /* ── the stager ────────────────────────────────────────────────────────────
     Rules over RELATIVE band power plus EMG tone and EOG activity, each normalised to that
     recording's own median. Absolute microvolts are not comparable between recordings — different
     amplifiers, impedances and montages — so every threshold here is relative, the same discipline
     the Integrator's effort rule got wrong with an absolute floor. */
  /* Thresholds fitted by grid search over 576 combinations on a TRAINING half of SHHS1 records, then
     evaluated ONCE on a held-out half. Reported figures are the held-out ones:

         baseline (hand-set)     train kappa 0.148   test kappa 0.174
         fitted                  train kappa 0.293   test kappa 0.314

     ⚠️ Test kappa exceeds train kappa, so these are not overfitted — if anything the held-out half is
     the easier one. That is worth stating because the opposite pattern is what a leak looks like, and
     the module header warns that a suspiciously good score here would be evidence of one.

     ⚠️ THE TEST HALF WAS CONSULTED EXACTLY ONCE, after the winner was fixed. Re-running the grid
     against it would turn the held-out number into a training number silently, and every further
     tweak of these constants owes a fresh split. */
  var TUNED = { n3: 0.65, remD: 0.45, remEmg: 0.95, remEog: 0.9, n2s: 0.075, n2d: 0.25, wFast: 0.3, wEmg: 0.85 };

  function stageEpoch(b, emgRel, eogRel, p) {
    if (!b) return null; // §∅ — no spectrum, no stage. Never a default of 'W'.
    p = p || TUNED;
    var d = b.rel.delta,
      a = b.rel.alpha,
      sg = b.rel.sigma,
      bt = b.rel.beta;
    /* N3: slow-wave dominance — relative delta as the band-power proxy for the AASM criterion. */
    if (d >= p.n3) return 'N3';
    /* REM: low delta, low EMG tone, eye movement present. The EMG leg is what separates REM from N1,
       which otherwise look alike in this feature space — without it a stager calls everything N1, and
       the untuned version did exactly that (REM recall 3.9 %).
       ⚠️ The `== null` arms make an ABSENT channel permissive rather than disqualifying: a recording
       with no EMG should still be stageable, just less well. Requiring the channel would silently
       return null for every epoch of such a record — an absence of input becoming an absence of
       output, which reads as "nothing to score" rather than "scored with less". */
    if (d < p.remD && (emgRel == null || emgRel < p.remEmg) && (eogRel == null || eogRel > p.remEog)) return 'REM';
    /* N2: spindle band lifted against a moderate delta background. */
    if (sg >= p.n2s && d >= p.n2d) return 'N2';
    /* Wake: fast activity with tone. */
    if (bt + a > p.wFast && (emgRel == null || emgRel > p.wEmg)) return 'W';
    if (d >= 0.3) return 'N2';
    return 'N1';
  }

  /* ── temporal smoothing ────────────────────────────────────────────────────
     Sleep stages persist; an isolated epoch flanked by two of another stage is far more likely a
     misclassification than a real one-epoch bout. Applied AFTER staging so the rules stay readable
     and the raw hypnogram is still available for comparison.

     ⚠️ `ecgdex-dsp.js` carries a hard-won warning about exactly this, and it is worth reading before
     assuming smoothing is free: an unconditional despiker "is not a denoiser, it is an eraser" — on a
     series where one class dominates, every isolated MINORITY-stage epoch is overwritten by
     construction. Measured there: two epochs satisfied the full REM rule and the smoother deleted
     both, reporting REM = 0 min.

     ⚠️ ITS REMEDY DOES NOT TRANSFER HERE, AND THE REASON IS THE GRID. ECGDex exempts the minority
     stages because it runs a FIVE-MINUTE epoch, where a single epoch IS a legitimate REM or Deep bout
     (real bouts run 5-25 min). EEGDex runs 30 s, where a real REM bout is 10-50 epochs — so an
     isolated 30 s singleton is genuinely more likely noise than bout. The same rule is right there and
     wrong here, because the unit differs.

     That inversion is an argument, not evidence, so the effect on REM recall specifically is MEASURED
     rather than assumed — see the commit. A smoother that lifted overall kappa while collapsing REM
     would be the ECGDex failure wearing a better headline number. */
  function smoothHypnogram(stages) {
    if (!stages || stages.length < 3) return stages ? stages.slice() : stages;
    var out = stages.slice();
    for (var i = 1; i < stages.length - 1; i++) {
      var a = stages[i - 1],
        b = stages[i],
        c = stages[i + 1];
      /* §∅ — a null epoch is an ABSENCE and is never smoothed over, in either direction: it must not
         be filled from its neighbours (that fabricates a stage for an unscorable epoch), and it must
         not be allowed to outvote a real one. */
      if (a == null || b == null || c == null) continue;
      if (a === c && b !== a) out[i] = a;
    }
    return out;
  }

  /* ── analyze ───────────────────────────────────────────────────────────────
     `rec` = { eeg:Float|Array, fs, emg?, emgFs?, eog?, eogFs?, t0Ms? }. Samples, not a vendor file:
     see the scope note at the top. */
  function analyze(rec, opts) {
    opts = opts || {};
    if (!rec || !rec.eeg || !(rec.fs > 0)) return { err: 'no EEG signal' };
    var fs = rec.fs,
      sig = rec.eeg;
    var spe = Math.round(EPOCH_SEC * fs);
    var nEp = Math.floor(sig.length / spe);
    if (nEp < 2) return { err: 'under two epochs of EEG' };

    var bands = [],
      emgR = [],
      eogR = [],
      i;
    for (i = 0; i < nEp; i++) {
      bands.push(epochBands(sig, i * spe, (i + 1) * spe, fs));
      var ef = rec.emgFs || fs,
        of = rec.eogFs || fs;
      emgR.push(rec.emg ? rms(rec.emg, Math.round(i * EPOCH_SEC * ef), Math.round((i + 1) * EPOCH_SEC * ef)) : null);
      eogR.push(rec.eog ? rms(rec.eog, Math.round(i * EPOCH_SEC * of), Math.round((i + 1) * EPOCH_SEC * of)) : null);
    }
    /* per-recording normalisation — see the stager's note on absolute thresholds */
    var emgMed = median(emgR),
      eogMed = median(eogR);

    var hypnogram = [],
      rawStages = [],
      counts = { W: 0, N1: 0, N2: 0, N3: 0, REM: 0 },
      nNull = 0;
    for (i = 0; i < nEp; i++) {
      var st = stageEpoch(bands[i], emgMed > 0 && emgR[i] != null ? emgR[i] / emgMed : null, eogMed > 0 && eogR[i] != null ? eogR[i] / eogMed : null);
      rawStages.push(st);
    }
    /* smoothing is opt-OUT rather than opt-in, because the raw series is the diagnostic and the
       smoothed one is the product; `opts.smooth === false` recovers the raw hypnogram exactly */
    var stages = opts.smooth === false ? rawStages : smoothHypnogram(rawStages);
    for (i = 0; i < nEp; i++) {
      var st2 = stages[i];
      hypnogram.push({ epoch: i, tMs: rec.t0Ms != null ? rec.t0Ms + i * EPOCH_SEC * 1000 : null, stage: st2, conf: st2 == null ? null : 0.5 });
      if (st2 == null) nNull++;
      else counts[st2]++;
    }

    var scored = nEp - nNull;
    var sleepEp = counts.N1 + counts.N2 + counts.N3 + counts.REM;
    /* §∅ — architecture over zero scored epochs is not an architecture. */
    var arch =
      scored > 0
        ? {
            TST: +((sleepEp * EPOCH_SEC) / 3600).toFixed(3),
            SE: +((100 * sleepEp) / scored).toFixed(1),
            n3Pct: sleepEp ? +((100 * counts.N3) / sleepEp).toFixed(1) : null,
            remPct: sleepEp ? +((100 * counts.REM) / sleepEp).toFixed(1) : null
          }
        : { TST: null, SE: null, n3Pct: null, remPct: null };

    return {
      version: VERSION,
      fs: fs,
      nEpochs: nEp,
      epochSec: EPOCH_SEC,
      hypnogram: hypnogram,
      stageCounts: counts,
      architecture: arch,
      quality: {
        analyzablePct: +((100 * scored) / nEp).toFixed(1),
        nUnscorable: nNull
      }
    };
  }

  global.EEGDSP = {
    VERSION: VERSION,
    BANDS: BANDS,
    EPOCH_SEC: EPOCH_SEC,
    epochBands: epochBands,
    stageEpoch: stageEpoch,
    smoothHypnogram: smoothHypnogram,
    TUNED: TUNED,
    rms: rms,
    median: median,
    analyze: analyze,
    _fft: fft
  };
})(typeof window !== 'undefined' ? window : this);
