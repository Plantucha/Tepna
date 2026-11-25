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
 * 0.4–0.6 against expert PSG; modern learned models reach 0.7–0.8 on far more input.
 * ⚠️ THOSE TWO KAPPA RANGES ARE UNCITED and are retained as orientation, not as authority — §📚 is
 * explicit that a number without a checkable citation keeps the suite's own tier and never earns
 * `validated`. What follows IS cited, and it is what the argument below actually rests on.
 *
 * THE HUMAN CEILING IS THE POINT, and it is measurable rather than rhetorical. Arnal et al. (2020),
 * "The Dreem Headband compared to polysomnography…", SLEEP 43(11) zsaa097,
 * doi:10.1093/sleep/zsaa097 — 25 subjects scored simultaneously by a headband and by PSG: the device
 * reached 83.5 ± 6.4 % accuracy (F1 83.8 ± 6.3) while FIVE HUMAN EXPERTS scoring the same records
 * averaged 86.4 ± 8.0 % (F1 86.3 ± 7.4). Experts agree with each other to about 86 %; that is the
 * band any stager is competing inside.
 * ⚠️ Arnal reports ACCURACY and F1, NOT kappa — do not read its 83.5 % against the 0.4–0.6 above as
 * if they shared a scale. They are different statistics over the same task, and quoting one for the
 * other is the unit error this file would otherwise be inviting.
 * The programme that makes "expert agreement" a defined quantity rather than an impression is the
 * AASM Inter-scorer Reliability programme — Rosenberg & Van Hout (2013), "The American Academy of
 * Sleep Medicine Inter-scorer Reliability Program: Sleep Stage Scoring", J Clin Sleep Med 9(1),
 * doi:10.5664/jcsm.2350. Cited for the benchmark's IDENTITY only: its agreement figures are not
 * quoted here because they were not verifiable at author time, and a number nobody checked is
 * exactly what the paragraph above refuses.
 *
 * A rule engine that scored 0.8 here would be evidence of a leak, not of quality — most likely the
 * reference having entered the features. The number this produces is a FLOOR for the node and a reference
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

/* ── NSRR DATA ACKNOWLEDGEMENT (data access and use agreement §11, §16) ───────────────────────
   Where this file names an SHHS-measured number: the Sleep Heart Health Study data were obtained
   through the National Sleep Research Resource (NSRR) under its data access and use agreement.
   Publications and presentations of those numbers carry the line
   "NSRR R24 HL114473: NHLBI National Sleep Research Resource" and cite the SHHS references listed
   on its NSRR page. Results of the analysis may be published; no part or excerpt of the Data
   appears here.
     · Quan SF, Howard BV, Iber C, et al. The Sleep Heart Health Study: design, rationale, and
       methods. Sleep. 1997;20(12):1077–85. doi:10.1093/sleep/20.12.1077
     · Zhang GQ, Cui L, Mueller R, et al. The National Sleep Research Resource: towards a sleep
       data commons. J Am Med Inform Assoc. 2018;25(10):1351–1358. doi:10.1093/jamia/ocy064
   Clause source: the signed agreement, §11 and §16. Cohort page: `docs/SHHS-COHORT-REFERENCE.md`. */
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
  /* The analysis ceiling, in Hz. Every power this engine sums stops here, so every share and every
     spectral edge is a share of the band 0 to this number and nothing wider. */
  var SEF_CEIL_HZ = 45;

  function epochBands(sig, from, to, fs, opts) {
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
    /* ── THE OPT-IN 1 Hz BIN VECTOR (2026-11-15) ───────────────────────────────────────────────
       The SEF comment below states that this function holds no array per epoch, and that stays the
       default. A caller drawing a spectrogram needs one, so `opts.bins` turns it on and nothing
       else does. The cost is 45 numbers an epoch, so 43 200 over an 8 h night at 30 s epochs, and
       the renderer holds them for as long as the night stays open. Bin `i` carries the power in
       [i, i+1) Hz, so the vector stops at the same `SEF_CEIL_HZ` as `tot` and as every share. */
    var bins = opts && opts.bins ? new Array(SEF_CEIL_HZ) : null,
      bi = 0;
    if (bins) {
      for (bi = 0; bi < SEF_CEIL_HZ; bi++) bins[bi] = 0;
    }
    for (i = 1; i < half; i++) {
      var f = (i * fs) / N;
      if (f > SEF_CEIL_HZ) break;
      var p = (re[i] * re[i] + im[i] * im[i]) / (N * N);
      tot += p;
      for (var b in BANDS) if (f >= BANDS[b][0] && f < BANDS[b][1]) out[b] += p;
      if (bins) {
        bi = Math.floor(f);
        if (bi < SEF_CEIL_HZ) bins[bi] += p;
      }
    }
    if (!(tot > 0)) return null;
    var rel = {};
    for (var b2 in out) rel[b2] = out[b2] / tot;
    /* ── SPECTRAL EDGE FREQUENCY, 95 % (SEF95) ──────────────────────────────────────────────────
       The frequency below which 95 % of the epoch's power sits. It is a DEFINITION over the same
       spectrum the five bands come from, not a model of anything, so it is `measured`: no tuned
       constant, no literature threshold, no stage assumption. One number says where the mass of
       the spectrum lies, which five band shares can only imply.

       The quantum is the bin width `fs / N`, and the answer is the centre frequency of the bin
       where the running sum first reaches 95 % of the SAME `tot` the shares divide by. The second
       pass recomputes each bin's power rather than storing the first pass's, because an array per
       epoch over a whole night is memory this engine does not need to hold.

       It runs over the SAME 45 Hz ceiling as `tot`, so it answers "95 % of the power this engine
       examined" and never "95 % of the power in the channel". A reader needs that bound stated,
       and `SEF_CEIL_HZ` is where it is stated. */
    var want = 0.95 * tot,
      run = 0,
      sef = null;
    for (i = 1; i < half; i++) {
      var fe = (i * fs) / N;
      if (fe > SEF_CEIL_HZ) break;
      run += (re[i] * re[i] + im[i] * im[i]) / (N * N);
      if (run >= want) {
        sef = +fe.toFixed(2);
        break;
      }
    }
    return { abs: out, rel: rel, total: tot, sef95: sef, bins: bins };
  }

  /* ── WHY AN EPOCH HAS NO SPECTRUM (∅) ─────────────────────────────────────────────────────────
     `epochBands` returns `null` and `stageEpoch` then returns `null`, so the hypnogram already
     refuses an unusable epoch rather than defaulting it to a stage. What it did NOT carry is the
     REASON, and ∅ asks an output over absent input to name one.

     This function mirrors `epochBands`'s own arms in `epochBands`'s own order, and it invents no
     arm that function does not have: a non-finite sample first (“a hole is not a zero”), then a
     constant stretch (a disconnected electrode), then the two shape guards. It runs NO FFT, so the
     last arm is a deduction rather than a measurement: when every cheap arm passes and the bands
     are still null, the only arm left in `epochBands` is its `tot > 0` guard. */
  function epochAbsence(sig, from, to, fs) {
    if (!sig) return 'no-samples';
    if (!(fs > 0)) return 'no-sample-rate';
    var n = to - from;
    if (n < fs * 5) return 'epoch-too-short';
    var holes = 0,
      i;
    for (i = from; i < to; i++) if (!isFinite(sig[i])) holes++;
    if (holes) return holes === n ? 'signal-absent' : 'partial-hole';
    var first = sig[from],
      flat = true;
    for (i = from; i < to; i++) {
      if (sig[i] !== first) {
        flat = false;
        break;
      }
    }
    if (flat) return 'flat-signal';
    return 'no-spectrum';
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
    if (!v.length) return null;
    /* Residue 2026-11-08-eegdex-median-takes-the-upper-middle: an even count used to return the UPPER
       middle, so median([1, 2, 3, 4]) read 3 where every other copy in the suite reads 2.5. */
    var m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
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
    /* ⚠️ EOG CONJUGACY WAS TRIED HERE AND IS DELIBERATELY NOT USED — measured 2026-09-15, recorded so
       it is not re-derived. In REM the eyes move together, so a left and a right EOG electrode should
       see the same deflection with opposite sign; SHHS carries both channels at 100 %, so the feature
       is available. Correlation over 30 s epochs, share below -0.2, 8 records:

           REM 23.7 %  ·  Wake 7.1 %  ·  N1 6.3 %  ·  N2 0.4 %  ·  N3 0.2 %

       The signal is REAL — REM is 30-100x more often anti-correlated than NREM — but it is SPECIFIC
       and not SENSITIVE: it sees under a quarter of REM. Two wirings were measured on identical
       records, changing nothing else:

           as a REQUIREMENT (replacing the amplitude arm) .. REM recall 20.2 % -> 6.7 %, kappa -0.010
           as an ADDITIONAL sufficient path (OR) ........... REM recall 20.2 % -> 20.2 %, kappa -0.0005

       Worse as a gate, and redundant as an OR because the amplitude arm already fires on everything it
       would catch. So it buys nothing here and costs a second channel dependency, and a recording with
       one EOG lead would silently lose it. Revisit only if the amplitude arm is tightened — at that
       point conjugacy's specificity would have something left to add.

    ⚠️ AND EMG ATONIA WAS TRIED AND ALSO REJECTED — 2026-09-15, same method, recorded so it is not
       re-derived. REM is defined by atonia, so tightening `remEmg` looks obvious. EMG by expert
       stage, each record normalised to its own median, 8 records:

           Wake 2.285  ·  N1 1.092  ·  N2 0.856  ·  N3 0.554  ·  REM 0.610      (medians)

       Two things fall out. First, REM is NOT the quietest stage — N3 is — so "tighten EMG to find the
       atonic stage" finds N3. That does not bite here only because the N3 branch runs FIRST and has
       already consumed those epochs. Second, the shipped 0.95 does admit most of N2 (median 0.856),
       which is a real imprecision, so tightening to 0.75 — the midpoint of the REM and N2 medians —
       is a principled choice rather than a fitted one.

       Measured A/B on identical records: REM recall 23.7 % -> 7.5 %, kappa -0.0026. WORSE.

       ⚠️ THE REASON IS THE CONJUNCTION, AND IT IS THE FINDING WORTH KEEPING. REM requires low delta
       AND low EMG AND eye movement SIMULTANEOUSLY, so each arm's false-negative rate MULTIPLIES:
       tightening any single arm costs more recall than its own selectivity buys. Two principled
       single-arm changes have now been measured and both lost — conjugacy above, EMG here. Improving
       REM needs the rule's SHAPE changed (weighted evidence, where one strong arm can carry a weak
       one) rather than any threshold or any further feature. Do not spend a third attempt on a
       single arm.

       REM: low delta, low EMG tone, eye movement present. The EMG leg is what separates REM from N1,
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
  /* ── REM PERIODS, AND THE NREM STRETCHES BETWEEN THEM ──────────────────────────────────────────
     One function, so the count `sleepArchitecture` publishes and the stretches `swaTrend` measures
     over can never disagree. A REM period is a maximal run of REM epochs merged across a non-REM
     gap of up to `REM_GAP_EP`; a non-REM epoch and an unscored epoch both widen that gap, because
     an epoch nobody staged is not evidence of REM. */
  function remPeriodSpans(stages) {
    var spans = [],
      gap = REM_GAP_EP + 1,
      i;
    for (i = 0; i < stages.length; i++) {
      if (stages[i] === 'REM') {
        if (gap > REM_GAP_EP) spans.push([i, i + 1]);
        else spans[spans.length - 1][1] = i + 1;
        gap = 0;
      } else gap++;
    }
    return spans;
  }

  /* ── SLOW-WAVE ACTIVITY ACROSS THE NIGHT ───────────────────────────────────────────────────────
     Delta power falls from one NREM period to the next in a healthy night, and the SHAPE of that
     fall is the oldest quantitative claim in sleep EEG. This function measures the fall and NOTHING
     about the claim: it reports the median absolute delta power of each NREM stretch and the
     least-squares slope across them, as a percentage of the FIRST stretch per period.

     ⚠️ THE INTERPRETATION IS UNCITED HERE, so the metric is `heuristic`. A homeostatic reading of
     this slope needs a citation this repo has not verified, and §📚 is explicit that a number
     without one keeps the suite's own tier. What is measured is the slope; what is claimed is
     nothing.

     ABSOLUTE power, never the relative share: a relative delta share is bounded by 1 and saturates
     in N3, so a share cannot fall while the power does. The unit is therefore the EDF channel's own
     physical dimension squared, which `compute` carries as `unit`, and a synthetic frame declares
     none.

     An NREM stretch is the span from sleep onset or the end of the previous REM period to the start
     of the next REM period, and only its N2 and N3 epochs with a spectrum count. A stretch with no
     such epoch is EXCLUDED and counted, never entered as a zero. */
  var SWA_MIN_EPOCHS = 4; // 2 min of staged NREM, under which a stretch's median is not a stretch

  function swaTrend(bands, stages) {
    var out = { periods: [], decayPctPerPeriod: null, fit: null, reason: null, population: { stretches: 0, measured: 0, excluded: 0 } };
    if (!bands || !bands.length || !stages || stages.length !== bands.length) {
      out.reason = 'no-epoch-bands';
      return out;
    }
    var spans = remPeriodSpans(stages),
      onset = -1,
      i,
      j;
    for (i = 0; i < stages.length; i++) {
      if (isSleepStage(stages[i])) {
        onset = i;
        break;
      }
    }
    if (onset < 0) {
      out.reason = 'no-sleep-onset';
      return out;
    }
    /* The stretch boundaries: onset, then every REM period's end, closing at the next REM start or
       at the end of the recording. */
    var edges = [],
      at = onset;
    for (i = 0; i < spans.length; i++) {
      if (spans[i][0] > at) edges.push([at, spans[i][0]]);
      at = spans[i][1];
    }
    if (at < stages.length) edges.push([at, stages.length]);
    out.population.stretches = edges.length;
    for (i = 0; i < edges.length; i++) {
      var vals = [];
      for (j = edges[i][0]; j < edges[i][1]; j++) {
        if ((stages[j] === 'N2' || stages[j] === 'N3') && bands[j]) vals.push(bands[j].abs.delta);
      }
      if (vals.length < SWA_MIN_EPOCHS) {
        out.population.excluded++;
        continue;
      }
      out.population.measured++;
      out.periods.push({ period: out.periods.length, fromEpoch: edges[i][0], toEpoch: edges[i][1], epochs: vals.length, deltaPower: round3(median(vals)) });
    }
    if (out.periods.length < 2) {
      out.reason = 'under-two-nrem-stretches';
      return out;
    }
    /* Least squares over the stretch index, reported against the FIRST stretch so the number is a
       percentage and not an amplitude. */
    var n = out.periods.length,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (i = 0; i < n; i++) {
      sx += i;
      sy += out.periods[i].deltaPower;
      sxx += i * i;
      sxy += i * out.periods[i].deltaPower;
    }
    var den = n * sxx - sx * sx;
    if (!(den > 0) || !(out.periods[0].deltaPower > 0)) {
      out.reason = 'no-first-stretch-power';
      return out;
    }
    var slope = (n * sxy - sx * sy) / den;
    out.decayPctPerPeriod = +((100 * slope) / out.periods[0].deltaPower).toFixed(2);
    /* THE FITTED LINE TRAVELS WITH THE PERCENTAGE. A surface that drew its own least squares over
       `periods` would publish a second calculation of this same line, and the two would disagree the
       moment either side changed — the band shares carry the same rule, where `alphaRel` and
       `thetaRel` are the two published medians rather than a second pass. `intercept` is the fitted
       delta power at stretch 0, in the units of `deltaPower`, so a renderer draws THIS line. */
    out.fit = { slope: round3(slope), intercept: round3(sy / n - (slope * sx) / n) };
    return out;
  }

  /* ── SLEEP ARCHITECTURE OVER THE STAGE SERIES ──────────────────────────────────────────────────
     Twelve numbers, every one of them arithmetic over ONE array of stages. The arithmetic is exact
     and the stages are not, so each key here inherits the single-channel stager's tier and none of
     them earns a reference-standard grade. The module header above holds the ceiling that bounds
     all twelve: Arnal et al. (2020) measured five human experts agreeing to about 86 % on the same
     records, so an exact number over an inexact hypnogram is still an inexact number.

     ∅ · EVERY NULL CARRIES ITS OWN REASON, and the reasons are not interchangeable. A night with no
     scored epoch measured no latency at all, while a night that never reached REM measured one and
     found no REM. `absence` holds an entry for exactly the keys that are null, so a consumer never
     reads a reason beside a value.

     `remPeriods` is named for what it counts. A REM period here is a maximal run of REM epochs,
     merged across a non-REM gap of up to `REM_GAP_EP` epochs. That is NOT the Feinberg-Floyd sleep
     cycle, which requires an NREM period of its own minimum length ahead of each REM period, so
     this key is not called `cycles` and no consumer may read it as one. */
  var ARCH_KEYS = ['TST', 'SE', 'n1Pct', 'n2Pct', 'n3Pct', 'remPct', 'wakePct', 'latencySleepMin', 'latencyRemMin', 'wasoMin', 'stageShifts', 'remPeriods'];
  var REM_GAP_EP = 10; // 5 min at a 30 s epoch

  function isSleepStage(st) {
    return st === 'N1' || st === 'N2' || st === 'N3' || st === 'REM';
  }

  function sleepArchitecture(stages) {
    stages = stages || [];
    var arch = {},
      absence = {},
      i,
      st;
    for (i = 0; i < ARCH_KEYS.length; i++) arch[ARCH_KEYS[i]] = null;
    var tally = { W: 0, N1: 0, N2: 0, N3: 0, REM: 0 },
      scored = 0,
      first = -1,
      last = -1,
      firstRem = -1;
    for (i = 0; i < stages.length; i++) {
      st = stages[i];
      if (st == null) continue;
      scored++;
      if (tally[st] != null) tally[st]++;
      if (isSleepStage(st)) {
        if (first < 0) first = i;
        last = i;
        if (st === 'REM' && firstRem < 0) firstRem = i;
      }
    }
    var asleep = tally.N1 + tally.N2 + tally.N3 + tally.REM;
    var out = {
      arch: arch,
      absence: absence,
      tally: tally,
      scored: scored,
      sleepEpochs: asleep,
      onsetEpoch: first < 0 ? null : first
    };
    if (!scored) {
      for (i = 0; i < ARCH_KEYS.length; i++) absence[ARCH_KEYS[i]] = 'no-scored-epoch';
      return out;
    }
    var minPerEp = EPOCH_SEC / 60;
    arch.TST = +((asleep * EPOCH_SEC) / 3600).toFixed(3);
    arch.SE = +((100 * asleep) / scored).toFixed(1);
    arch.wakePct = +((100 * tally.W) / scored).toFixed(1);
    if (asleep) {
      arch.n1Pct = +((100 * tally.N1) / asleep).toFixed(1);
      arch.n2Pct = +((100 * tally.N2) / asleep).toFixed(1);
      arch.n3Pct = +((100 * tally.N3) / asleep).toFixed(1);
      arch.remPct = +((100 * tally.REM) / asleep).toFixed(1);
    } else {
      absence.n1Pct = 'no-sleep-epoch';
      absence.n2Pct = 'no-sleep-epoch';
      absence.n3Pct = 'no-sleep-epoch';
      absence.remPct = 'no-sleep-epoch';
    }
    if (first < 0) {
      absence.latencySleepMin = 'no-sleep-onset';
      absence.latencyRemMin = 'no-sleep-onset';
      absence.wasoMin = 'no-sleep-onset';
    } else {
      /* ELAPSED epochs to the first sleep epoch, so an unscorable epoch before onset still costs
         the time it occupied. A latency is a clock fact rather than a scoring fact. */
      arch.latencySleepMin = +(first * minPerEp).toFixed(1);
      if (firstRem < 0) absence.latencyRemMin = 'no-rem-epoch';
      else arch.latencyRemMin = +((firstRem - first) * minPerEp).toFixed(1);
      var waso = 0;
      for (i = first + 1; i < last; i++) if (stages[i] === 'W') waso++;
      arch.wasoMin = +(waso * minPerEp).toFixed(1);
    }
    if (scored < 2) absence.stageShifts = 'under-two-scored-epochs';
    else {
      var shifts = 0,
        prev = null;
      for (i = 0; i < stages.length; i++) {
        st = stages[i];
        /* A refused epoch BREAKS the run, exactly as `buildNodeExport` breaks its impulse run: the
           next scored epoch is a fresh stage, never a continuation across a span nobody staged. */
        if (st == null) {
          prev = null;
          continue;
        }
        if (prev != null && st !== prev) shifts++;
        prev = st;
      }
      arch.stageShifts = shifts;
    }
    if (firstRem < 0) absence.remPeriods = 'no-rem-epoch';
    else arch.remPeriods = remPeriodSpans(stages).length;
    return out;
  }

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
      /* ∅ — A RATE WE DO NOT HAVE IS NOT THE EEG RATE. `rec.emgFs || fs` read an EMG or EOG lead of
         undeclared rate at the EEG's rate, which multiplies every window bound by the ratio of the two:
         measured on one 480 s synthetic frame, an EMG lead at 25 Hz read at 100 Hz covered only the first
         four epochs and left twelve with no tone, so the stager's permissive `== null` arm drove them
         into REM — 8 REM epochs instead of the 3 a declared `emgFs: 25` produces, TST 0.117 h instead of
         0.108, SE 87.5 instead of 81.3. An undeclared (or non-positive) rate now makes the leg ABSENT,
         which is a state these arms already model, instead of inventing a rate the caller never stated.
         `rec.emgFs`/`eogFs` in the contract at the top of this block is what a caller declares. */
      var ef = rec.emgFs > 0 ? rec.emgFs : null,
        of = rec.eogFs > 0 ? rec.eogFs : null;
      emgR.push(rec.emg && ef != null ? rms(rec.emg, Math.round(i * EPOCH_SEC * ef), Math.round((i + 1) * EPOCH_SEC * ef)) : null);
      eogR.push(rec.eog && of != null ? rms(rec.eog, Math.round(i * EPOCH_SEC * of), Math.round((i + 1) * EPOCH_SEC * of)) : null);
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
      /* §∅ · `conf` IS NULL ON EVERY EPOCH, and that is the contract rather than a gap.
         `hypno-export.js` states it for the whole fleet: `confidence` is "the posterior of the
         decoded stage", and "a stager without posteriors (ECGDex's rule set) reports
         `confidence: null`, and the card says so". This stager is a band-power rule set with no
         posterior, so there is no number to state. The flat 0.5 that stood here until 2026-11-10 was
         an in-range sentinel: `confidenceSvg` draws "darker = surer", so a constant drew a uniform
         strip that read as a measured confidence at every epoch. A consumer now reads the absence. */
      /* ∅ · a null stage CARRIES ITS REASON. `absentReason` is null whenever a stage exists, so a
         consumer never reads a reason beside a value. */
      hypnogram.push({
        epoch: i,
        tMs: rec.t0Ms != null ? rec.t0Ms + i * EPOCH_SEC * 1000 : null,
        stage: st2,
        conf: null,
        absentReason: st2 == null ? epochAbsence(sig, i * spe, (i + 1) * spe, fs) : null
      });
      if (st2 == null) nNull++;
      else counts[st2]++;
    }

    var scored = nEp - nNull;
    /* The TALLY beside the count, so a reader sees WHICH refusal ran rather than only how often. */
    var absentReasons = {};
    for (i = 0; i < hypnogram.length; i++) {
      var ar = hypnogram[i].absentReason;
      if (ar) absentReasons[ar] = (absentReasons[ar] || 0) + 1;
    }
    /* The twelve architecture numbers come from ONE function over the stage series, so the four
       this engine published before unit B and the eight it adds now cannot drift apart. */
    var archPair = sleepArchitecture(stages),
      arch = archPair.arch;

    return {
      version: VERSION,
      fs: fs,
      nEpochs: nEp,
      absentReasons: absentReasons,
      epochSec: EPOCH_SEC,
      hypnogram: hypnogram,
      stageCounts: counts,
      architecture: arch,
      /* ∅ · one entry per architecture key that is null, each naming its own reason. */
      architectureAbsence: archPair.absence,
      /* The SWA fall across NREM stretches, measured over the per-epoch bands this function
         already computed, so the night is spectrally analysed exactly once. */
      swa: swaTrend(bands, stages),
      /* The spindle answer over the epochs THIS function staged, so the density and the hypnogram
         it is a density over can never come from two different stagings. */
      spindles: detectSpindles(sig, fs, hypnogram),
      /* ∅ · a lead the caller passed but could not be read, each with its own reason. A lead the
         caller never passed is not listed: that is a frame without the lead, not a refusal. */
      leadAbsence: {
        emg: rec.emg && !(rec.emgFs > 0) ? 'emg-rate-undeclared' : null,
        eog: rec.eog && !(rec.eogFs > 0) ? 'eog-rate-undeclared' : null
      },
      quality: {
        analyzablePct: +((100 * scored) / nEp).toFixed(1),
        nUnscorable: nNull
      }
    };
  }

  /* ── §∅ WHAT THIS ENGINE CANNOT MEASURE, AND WHY EACH ONE IS ABSENT ────────────────────────────
     The node registry declares three metrics that ONE EEG channel over an EDF ingest cannot produce.
     Each refusal carries its OWN reason, never a borrowed one: a null with no reason reads downstream
     as "the recording was absent", which is a different fact from "this instrument cannot see it".

     Two of them are absent BY DESIGN rather than pending a fix. `contactPct` is the headband contact
     metric and `frontalAsym` needs the two frontal electrodes of that montage; the module header
     above records the owner's park on that front end, so no ingest here will ever supply them. The
     third is a composite over the two above, so it inherits their absence and says so.

     `spindleDensity` LEFT THIS BLOCK when `detectSpindles` landed. Its refusal read
     `no-spindle-detector`, and that reason is now false, so the row had to go rather than stand as a
     stale claim. The metric is computed, its tier is `heuristic`, and its own `reason` field carries
     every night the detector cannot answer for. */
  var REFUSALS = {
    contactPct: 'no-contact-sidecar',
    frontalAsym: 'single-channel-ingest',
    calmScore: 'depends-on-refused-inputs'
  };

  function refusalBlock() {
    var out = {},
      keys = Object.keys(REFUSALS);
    for (var i = 0; i < keys.length; i++) out[keys[i]] = { value: null, reason: REFUSALS[keys[i]] };
    return out;
  }

  function pct1(x) {
    return x == null || !isFinite(x) ? null : +(100 * x).toFixed(1);
  }
  function round3(x) {
    return x == null || !isFinite(x) ? null : +x.toFixed(3);
  }
  function p2(n) {
    return (n < 10 ? '0' : '') + n;
  }
  /* §🔒.5 — display and the export's date-less `t` read `getUTC*` off the floating `tMs`. A
     formatter is not a parser, and this node now has TWO readers with two stamp sources: the EDF
     ingest parses its header through `CpapEdf.parseEdfClock`, while `ingestMuseRaw` parses each raw
     row's host stamp through `DexClock.parseTimestamp` and builds the host axis from it. So the
     bundle carries `clock.js`, which it did not before, and the earlier note here saying nothing in
     this node needs `DexClock` is no longer true. */
  function fmtClockUTC(tMs) {
    if (tMs == null || !isFinite(tMs)) return null;
    var d = new Date(tMs);
    return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
  }

  /* ── THE NIGHT-LEVEL BAND SUMMARY ──────────────────────────────────────────────────────────────
     The registry declares `totalPower`, `alphaRel`, `thetaRel` and `alphaTheta` as night metrics;
     `epochBands` measures them per 30 s epoch. The aggregate is a MEDIAN over the epochs that
     produced bands, never a mean: one disconnected or artefact epoch moves a mean of absolute power
     by orders of magnitude, and the per-epoch refusals (a hole, a flat stretch, zero total power)
     already remove the worst of them by returning null.

     `alphaTheta` is the MEDIAN OF THE PER-EPOCH RATIOS, not the ratio of the two medians. The two
     are different numbers, and only the first answers "what does a typical epoch's alpha/theta look
     like". An epoch whose theta power is zero is EXCLUDED from that one metric and counted in
     `ratioEpochs`, because a division by zero is not an infinity anybody measured.

     Every value carries its own population, so a reader can never mistake a one-epoch median for a
     night. */
  function nightBands(sig, fs, opts) {
    /* `opts.series` is an OUT-PARAMETER object rather than a return key, because `buildNodeExport`
       copies `summary.bands` WHOLE onto the bus. A per-epoch 45-bin vector has no place in a node
       export, so the series never touches this function's return value. The caller that wants it
       passes an object and reads `series`, `binHz`, `ceilHz` and `epochSec` back out of it. */
    var sink = opts && opts.series && typeof opts.series === 'object' ? opts.series : null;
    if (sink) {
      sink.series = null;
      sink.reason = null;
      sink.binHz = 1;
      sink.ceilHz = SEF_CEIL_HZ;
      sink.epochSec = EPOCH_SEC;
    }
    var out = {
      totalPower: null,
      alphaRel: null,
      thetaRel: null,
      alphaTheta: null,
      rel: null,
      relSum: null,
      reason: null,
      ratioReason: null,
      sef95: null,
      sefReason: null,
      population: { epochs: 0, withBands: 0, ratioEpochs: 0, sefEpochs: 0 }
    };
    if (!sig || !sig.length) {
      out.reason = 'no-samples';
      return out;
    }
    if (!(fs > 0)) {
      out.reason = 'no-sample-rate';
      return out;
    }
    var step = Math.round(EPOCH_SEC * fs);
    if (!(step > 0)) {
      out.reason = 'no-sample-rate';
      return out;
    }
    var nEp = Math.floor(sig.length / step);
    out.population.epochs = nEp;
    var tot = [],
      per = { delta: [], theta: [], alpha: [], sigma: [], beta: [] },
      ratio = [],
      sefs = [],
      k;
    var rows = sink ? [] : null;
    for (var i = 0; i < nEp; i++) {
      var b = epochBands(sig, i * step, (i + 1) * step, fs, sink ? { bins: true } : null);
      if (!b) {
        /* ∅ · an epoch with no spectrum enters the series as an absence that NAMES ITSELF, out of
           the same vocabulary `epochAbsence` gives the hypnogram. A chart then draws a gap with a
           reason beside it, never a zero column. */
        if (rows) rows.push({ epoch: i, reason: epochAbsence(sig, i * step, (i + 1) * step, fs), rel: null, total: null, sef95: null, bins: null });
        continue;
      }
      if (rows) rows.push({ epoch: i, reason: null, rel: b.rel, total: b.total, sef95: b.sef95, bins: b.bins });
      tot.push(b.total);
      for (k in per) per[k].push(b.rel[k]);
      if (b.rel.theta > 0) ratio.push(b.rel.alpha / b.rel.theta);
      if (b.sef95 != null) sefs.push(b.sef95);
    }
    if (sink) sink.series = rows;
    out.population.withBands = tot.length;
    out.population.ratioEpochs = ratio.length;
    out.population.sefEpochs = sefs.length;
    if (!tot.length) {
      out.reason = 'no-analyzable-epoch';
      return out;
    }
    out.totalPower = round3(median(tot));
    /* ONE MEDIAN PER BAND, each over the same epochs but taken independently, so the five shares do
       NOT sum to 100 %. A consumer drawing them as one stacked whole has to scale them by their own
       sum and say so, which is why `relSum` is PUBLISHED here rather than left to be re-derived from
       five rounded numbers. `alphaRel` and `thetaRel` stay as their own keys: they are registry
       metrics with their own grades, and `rel` is a projection beside them, never their source. */
    out.rel = { delta: null, theta: null, alpha: null, sigma: null, beta: null };
    out.relSum = 0;
    for (k in per) {
      out.rel[k] = pct1(median(per[k]));
      out.relSum += out.rel[k];
    }
    out.relSum = +out.relSum.toFixed(1);
    out.alphaRel = out.rel.alpha;
    out.thetaRel = out.rel.theta;
    if (ratio.length) out.alphaTheta = round3(median(ratio));
    else out.ratioReason = 'no-epoch-with-theta-power';
    /* ∅ · an epoch whose cumulative power never reaches 95 % inside the ceiling yields NO edge, so
       it is left out and counted rather than entered at the ceiling. The ceiling is not an answer. */
    if (sefs.length) out.sef95 = +median(sefs).toFixed(2);
    else out.sefReason = 'no-epoch-with-a-spectral-edge';
    return out;
  }

  /* ── THE SPINDLE DETECTOR ──────────────────────────────────────────────────────────────────────
     The registry declared `spindleDensity` from the start and this engine REFUSED it, for the
     reason `no-spindle-detector`: a sigma-band share is not a spindle count. This is the detector,
     and it is a RELATIVE-ENVELOPE rule rather than a published algorithm.

     WHY A RELATIVE THRESHOLD, AND WHY PER EPOCH. A spindle is a 0.5 s to 3 s burst in the 11-16 Hz
     band, and its amplitude against the background is what an expert sees. An absolute microvolt
     threshold cannot travel between an EDF whose channel is in µV and a synthetic frame whose unit
     is undeclared, so every threshold here is a MULTIPLE of the enclosing epoch's own median
     envelope. The epoch is the baseline unit because the background itself moves with the stage:
     N2 carries a standing sigma rhythm and N3 carries almost none, so one night-wide threshold
     would fire continuously in N2 and never in N3.

     THE RULE CAN RETURN ZERO, and that is the point of a multiple rather than a percentile. A
     percentile threshold puts a fixed share of every night above the line, so it manufactures a
     density over a signal with no spindle in it. A multiple of the median finds nothing in a
     uniform envelope.

     ∅ · A HOLE ENTERS THE FILTER AS ZERO AND ENTERS THE MASK. An IIR filter needs a finite input,
     and one non-finite sample would otherwise poison every later output. So a non-finite sample is
     filtered as 0 and recorded in `mask`, and every detection that touches a masked sample, or sits
     within `SPINDLE.holeGuardSec` of one, is DROPPED. No substituted zero reaches a reported
     number; `population.excludedByHole` counts what the guard removed.

     WHAT THIS DETECTOR HAS NOT BEEN JUDGED BY. Its multiples are tuned against the overnight
     simulator's planted spindles, which ride a constant 13.5 Hz carrier in N2. No expert-scored
     spindle has judged it, so the metric is `heuristic` and never `emerging`, whatever its
     agreement with our own generator. */
  var SPINDLE = {
    loHz: 11,
    hiHz: 16,
    envSec: 0.25,
    hiMult: 2.0,
    loMult: 1.4,
    minSec: 0.4,
    maxSec: 3.0,
    mergeSec: 0.2,
    holeGuardSec: 1.0,
    stages: { N2: 1, N3: 1 }
  };

  /* An RBJ bandpass biquad, constant 0 dB peak gain, centred on the spindle band. ONE section: at
     Q = f0/(hi-lo) its skirts already put the N2 delta carrier under 4 % of its passband gain, and a
     cascade would narrow the -3 dB band away from the 11-16 Hz the metric names. */
  function spindleBiquad(fs) {
    var f0 = (SPINDLE.loHz + SPINDLE.hiHz) / 2,
      q = f0 / (SPINDLE.hiHz - SPINDLE.loHz),
      w0 = (2 * Math.PI * f0) / fs,
      alpha = Math.sin(w0) / (2 * q),
      a0 = 1 + alpha;
    return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 };
  }

  /* The 11-16 Hz envelope: one biquad pass, then a centred moving RMS. `mask[i]` is 1 where the
     input sample was not finite. */
  function spindleEnvelope(sig, fs) {
    var n = sig.length,
      c = spindleBiquad(fs),
      band = new Float64Array(n),
      mask = new Uint8Array(n),
      x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0,
      i,
      x,
      y;
    for (i = 0; i < n; i++) {
      x = sig[i];
      if (!isFinite(x)) {
        mask[i] = 1;
        x = 0;
      }
      y = c.b0 * x + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      band[i] = y;
    }
    var w = Math.max(1, Math.round(SPINDLE.envSec * fs)),
      half = w >> 1,
      env = new Float64Array(n),
      acc = 0;
    for (i = 0; i < n; i++) {
      acc += band[i] * band[i];
      if (i >= w) acc -= band[i - w] * band[i - w];
      if (i >= w - 1) env[i - half] = Math.sqrt(acc / w);
    }
    for (i = 0; i < half; i++) env[i] = env[half];
    for (i = n - half; i < n; i++) env[i] = env[n - half - 1];
    return { env: env, mask: mask, width: w };
  }

  function detectSpindles(sig, fs, hypnogram) {
    var out = {
      spindles: [],
      density: null,
      byStage: { N2: null, N3: null },
      reason: null,
      population: { eligibleEpochs: 0, eligibleMin: 0, stageEpochs: { N2: 0, N3: 0 }, excludedByHole: 0, detections: 0 }
    };
    if (!sig || !sig.length) {
      out.reason = 'no-samples';
      return out;
    }
    if (!(fs > 0)) {
      out.reason = 'no-sample-rate';
      return out;
    }
    if (!hypnogram || !hypnogram.length) {
      out.reason = 'no-hypnogram';
      return out;
    }
    var spe = Math.round(EPOCH_SEC * fs),
      e = spindleEnvelope(sig, fs),
      env = e.env,
      mask = e.mask,
      guard = Math.round(SPINDLE.holeGuardSec * fs),
      minN = Math.round(SPINDLE.minSec * fs),
      maxN = Math.round(SPINDLE.maxSec * fs),
      mergeN = Math.round(SPINDLE.mergeSec * fs),
      ep,
      i,
      j;
    for (ep = 0; ep < hypnogram.length; ep++) {
      var st = hypnogram[ep] ? hypnogram[ep].stage : null;
      if (!st || !SPINDLE.stages[st]) continue;
      var from = ep * spe,
        to = Math.min(sig.length, from + spe);
      if (to - from < minN) continue;
      /* The epoch's OWN median envelope is the baseline, over a 4-sample decimation: a median is a
         rank statistic, so a regular quarter of the epoch moves it by less than its own rounding. */
      var samp = [];
      for (i = from; i < to; i += 4) samp.push(env[i]);
      var base = median(samp);
      if (!(base > 0)) continue;
      out.population.eligibleEpochs++;
      out.population.stageEpochs[st]++;
      var hi = SPINDLE.hiMult * base,
        lo = SPINDLE.loMult * base;
      /* Runs above the LOW threshold, merged across a short dip, then kept only when one sample
         inside the run passes the HIGH threshold and the width lands in the duration window. */
      var runs = [],
        inRun = false,
        s0 = 0;
      for (i = from; i < to; i++) {
        if (env[i] > lo) {
          if (!inRun) {
            inRun = true;
            s0 = i;
          }
        } else if (inRun) {
          inRun = false;
          runs.push([s0, i]);
        }
      }
      if (inRun) runs.push([s0, to]);
      var merged = [];
      for (i = 0; i < runs.length; i++) {
        if (merged.length && runs[i][0] - merged[merged.length - 1][1] <= mergeN) merged[merged.length - 1][1] = runs[i][1];
        else merged.push([runs[i][0], runs[i][1]]);
      }
      for (i = 0; i < merged.length; i++) {
        var a = merged[i][0],
          b = merged[i][1],
          w2 = b - a;
        if (w2 < minN || w2 > maxN) continue;
        var peak = 0,
          holed = false;
        for (j = a; j < b; j++) if (env[j] > peak) peak = env[j];
        for (j = Math.max(0, a - guard); j < Math.min(sig.length, b + guard); j++) {
          if (mask[j]) {
            holed = true;
            break;
          }
        }
        if (peak <= hi) continue;
        if (holed) {
          out.population.excludedByHole++;
          continue;
        }
        out.spindles.push({
          atSec: +(a / fs).toFixed(3),
          durSec: +(w2 / fs).toFixed(3),
          peakRatio: +(peak / base).toFixed(2),
          epoch: ep,
          stage: st
        });
      }
    }
    out.population.detections = out.spindles.length;
    out.population.eligibleMin = +((out.population.eligibleEpochs * EPOCH_SEC) / 60).toFixed(2);
    if (!out.population.eligibleEpochs) {
      out.reason = 'no-staged-nrem-epoch';
      return out;
    }
    out.density = +(out.spindles.length / out.population.eligibleMin).toFixed(3);
    var perStage = { N2: 0, N3: 0 };
    for (i = 0; i < out.spindles.length; i++) perStage[out.spindles[i].stage]++;
    for (var k in perStage) {
      var mins = (out.population.stageEpochs[k] * EPOCH_SEC) / 60;
      out.byStage[k] = mins > 0 ? +(perStage[k] / mins).toFixed(3) : null;
    }
    return out;
  }

  /* ── INGEST: EDF, the format the fleet already reads ───────────────────────────────────────────
     Public sleep-EEG ships as EDF/EDF+, and `cpapdex-edf.js` already holds a general EDF reader plus
     the EDF clock rule (the two-digit-year clipping at 85 and a round-trip check that rejects a
     Feb-30). This node reads its EEG channel out of that reader instead of parsing the bytes twice.

     NO SILENT FALLBACK. The reader lives in another module, so a realm that did not load it gets a
     NAMED refusal. A guard that quietly returned null here would turn a load-order bug into "this
     file has no EEG", which is the same class of lie one layer up. */
  var EEG_LABEL_RE = /\b(EEG|C3|C4|O1|O2|F3|F4|F7|F8|Fp1|Fp2|Fpz|Cz|Pz|AF7|AF8|TP9|TP10)\b/i;

  function ingestEDF(arrayBuffer, opts) {
    opts = opts || {};
    var lib = opts.edf || (typeof global !== 'undefined' && global ? global.CpapEdf : null);
    if (!lib || typeof lib.readEDF !== 'function') return { ok: false, reason: 'edf-reader-absent' };
    var edf = lib.readEDF(arrayBuffer);
    if (!edf || !edf.signals) return { ok: false, reason: 'edf-unreadable' };
    var labels = Object.keys(edf.signals),
      pick = null,
      i;
    if (opts.channel) {
      if (labels.indexOf(opts.channel) < 0) return { ok: false, reason: 'named-channel-absent', channels: labels };
      pick = opts.channel;
    } else {
      for (i = 0; i < labels.length; i++) {
        if (EEG_LABEL_RE.test(labels[i])) {
          pick = labels[i];
          break;
        }
      }
    }
    if (!pick) return { ok: false, reason: 'no-eeg-channel', channels: labels };
    var ch = edf.signals[pick];
    /* §∅ — the reader writes `fs: null` when the record duration is zero, which means "no periodic
       sampling", not "zero hertz". A rate we do not have is not recoverable from a sample count. */
    if (!ch || !(ch.fs > 0)) return { ok: false, reason: 'no-sample-rate', channel: pick, channels: labels };
    if (!ch.data || !ch.data.length) return { ok: false, reason: 'channel-empty', channel: pick, channels: labels };
    var clk = typeof lib.parseEdfClock === 'function' ? lib.parseEdfClock(edf.startDate, edf.startTime) : null;
    return {
      ok: true,
      samples: ch.data,
      fs: ch.fs,
      /* §🔒.6 — an unparseable header stamp is `null`, never now() and never a date invented from the
         file. Each epoch's `tMs` is then null too, and the export says so rather than guessing. */
      t0Ms: clk ? clk.t0Ms : null,
      offsetMin: clk ? clk.offsetMin : null,
      t0Reason: clk ? null : 'edf-header-stamp-unparseable',
      channel: pick,
      channels: labels,
      unit: ch.dim || null,
      truncated: edf.truncated === true,
      source: 'edf'
    };
  }

  /* ── THE RAW MUSE FRAME INGEST ─────────────────────────────────────────────────────────────────
     The capture host writes one notification per line of `<base>_RAW.txt` as
     `<host stamp>;<device ns>;<packet counter>;<payload length>;<payload hex>`, and `muse-frame.js`
     tokenises a payload into records. This function turns that file into the SAME frame `compute`
     already consumes from `ingestEDF`, so the analysis path below is reached by two readers and
     written once.

     NO SILENT FALLBACK, for the same reason `ingestEDF` has none: both the frame reader and the
     clock live in other modules, so a realm that did not load one gets a NAMED refusal rather than
     "this file has no EEG".

     §∅ — A LOST RECORD BECOMES NaN, NOT A NUMBER. The samples inside a dropped notification were
     never measured, so this writes `NaN` at each absent sample index and advances the position.
     `epochAbsence` already scans `!isFinite` and answers `partial-hole` or `signal-absent`, so a
     dropout reaches the node's existing refusal vocabulary and needs no new reason key. Dropping the
     gap instead would splice two stretches of signal into one epoch and move every stamp after it.

     THE GAP IS MEASURED FROM THE EEG RECORD'S OWN INDEX, NOT THE NOTIFICATION COUNTER. One
     notification carries records of several tags, so a gap of k notifications is NOT k EEG records.
     The per-tag `index` steps by one from one record of THAT tag to the next, modulo 256, so on its
     own it cannot tell a loss of 924 records from a loss of 156. The device time in the packet header
     gives the whole count. The two must agree modulo 256, and a step the index does not confirm is a
     stale header and not a gap (`museGap`).

     TWO EVENTS ARE NOT A LOSS. The link can deliver one packet twice. Its records step the index AND
     the device time back by the same count, so they are old copies and are dropped: the modulo alone
     turns that step back into 254 lost records. A stream
     that restarts inside a file puts the counter and the index back to 0, so no counter measures the
     silence and the device time alone does, held against the host stamps. */
  var MUSE_GAP_HOST_TOL_NS = 10e9, // a counted loss past one index cycle sits this close to the host gap
    MUSE_RESTART_TOL_NS = 2e9; // past this the device clock itself moved at the restart

  /* One EEG record against the one before it: `{ missed, spanNs, restart }`. `missed` is the count of
     records between the two. `spanNs` is the device time between them, or `null` when the header does
     not confirm one and the fold of the tick is the only reading left. */
  function museGap(lib, prev, cur) {
    var m8 = lib.lostBetween(prev ? prev.index : null, cur.index),
      out = { missed: m8, spanNs: null, restart: false, old: false };
    if (!prev || !(prev.base > 0) || !(cur.base > 0)) return out;
    var dNs = (cur.base - prev.base) * lib.WRAP_NS + (lib.signedTick(cur.tick) - lib.signedTick(prev.tick)) * lib.NS_PER_TICK,
      hostNs = prev.hostMs == null || cur.hostMs == null ? null : (cur.hostMs - prev.hostMs) * 1e6,
      n = Math.round(dNs / lib.EEG_RECORD_NS);
    var agree = (n - 1 - m8) % 256 === 0;
    if (agree && n < 1 && n > -256) out.old = true;
    else if (agree && n >= 1 && (n <= 256 || (hostNs !== null && Math.abs(hostNs - dNs) <= MUSE_GAP_HOST_TOL_NS))) {
      out.missed = n - 1;
      out.spanNs = dNs;
    } else if (cur.seqBroken && hostNs !== null) {
      out.spanNs = Math.abs(hostNs - dNs) > MUSE_RESTART_TOL_NS ? hostNs : dNs;
      out.missed = Math.max(0, Math.round(out.spanNs / lib.EEG_RECORD_NS) - 1);
      out.restart = true;
    }
    return out;
  }

  function ingestMuseRaw(text, opts) {
    opts = opts || {};
    var lib = opts.frame || (typeof global !== 'undefined' && global ? global.MuseFrame : null);
    if (!lib || typeof lib.parseRawRows !== 'function') return { ok: false, reason: 'frame-reader-absent' };
    /* §🔒.2 — ONE parser. The row's host stamp is handed out as text by the frame reader precisely so
       that this node parses it through `DexClock` and nothing hand-rolls a second stamp reader. */
    var ckLib = opts.clock || (typeof global !== 'undefined' && global ? global.DexClock : null);
    if (!ckLib || typeof ckLib.parseTimestamp !== 'function') return { ok: false, reason: 'clock-absent' };

    /* ONE NIGHT, SEVERAL FILES. The recorder starts a new `<base>_RAW.txt` at each reconnect, so a
       night arrives as an array of texts in file order. Each seam BREAKS BOTH CHAINS, exactly as an
       unreadable row does: the packet counter restarts with the link, so its step is no loss count, and
       the restart branch below measures the silence from the host stamps instead of joining the files. */
    var texts = Array.isArray(text) ? text : [text],
      parsed = { rows: [], refused: {} },
      seams = {},
      part,
      key,
      f,
      q;
    for (f = 0; f < texts.length; f++) {
      part = lib.parseRawRows(texts[f]);
      if (f > 0 && part.rows.length && parsed.rows.length) seams[parsed.rows.length] = true;
      for (q = 0; q < part.rows.length; q++) parsed.rows.push(part.rows[q]);
      for (key in part.refused) parsed.refused[key] = (parsed.refused[key] || 0) + part.refused[key]; // absence-ok: a refusal tally starts at zero
    }
    if (!parsed.rows.length) return { ok: false, reason: 'no-row', refusedRows: parsed.refused };

    var names = [],
      i;
    for (i = 0; i < lib.EEG_CHANNELS; i++) names.push(lib.EEG_ELECTRODES[i] || 'unidentified-' + i);
    /* The default is the FIRST electrode in the order the device packs them, which is a packing fact
       and not a clinical choice: four of the eight channels are identified and the other four are
       not, so no surface here may imply a montage. `opts.channel` selects by name. */
    var pick = opts.channel == null ? names[0] : opts.channel;
    var ci = names.indexOf(pick);
    if (ci < 0) return { ok: false, reason: 'named-channel-absent', channels: names };

    var clk = new lib.TickClock(),
      out = [],
      steps = [],
      anchors = [],
      gaps = [],
      unparsable = {},
      eegRecords = 0,
      lostRecords = 0,
      lostFrames = 0,
      gapCount = 0,
      repeats = 0,
      restarts = 0,
      prev = null,
      prevSeq = null,
      prevTick = null,
      seqBroken = false,
      pendingLost = 0,
      seq,
      base,
      cur,
      gap,
      before,
      row,
      pkt,
      rec,
      smp,
      tsec,
      missed,
      rowTick,
      hostMs,
      ck,
      r,
      s,
      k;

    for (i = 0; i < parsed.rows.length; i++) {
      row = parsed.rows[i];
      if (seams[i]) {
        prevSeq = null;
        seqBroken = true;
      }
      pkt = lib.tokenise(row.bytes);
      if (!pkt.packet) {
        unparsable[pkt.reason] = (unparsable[pkt.reason] || 0) + 1;
        /* §∅ — an unreadable notification breaks BOTH chains. The next row's step is then unexamined
           rather than read across a frame nobody decoded, which is what a null does here. */
        prevSeq = null;
        seqBroken = true;
        continue;
      }
      seq = lib.packetSeq(pkt.packet);
      if (row.counter == null) prevSeq = null;
      else {
        if (prevSeq !== null && seq !== prevSeq && seq !== (prevSeq + 1) % 65536) {
          seqBroken = true;
          pendingLost += (seq - prevSeq - 1 + 65536) % 65536;
        }
        prevSeq = seq;
      }
      base = lib.headerBase(pkt.packet);
      ck = ckLib.parseTimestamp(row.hostRaw, {});
      hostMs = ck && isFinite(ck.tMs) ? ck.tMs : null;
      rowTick = null;
      for (r = 0; r < pkt.packet.records.length; r++) {
        rec = pkt.packet.records[r];
        if (rec.tag !== lib.TAG_EEG) continue;
        smp = lib.eegSamples(rec);
        if (!smp) {
          unparsable['eeg-undecodable'] = (unparsable['eeg-undecodable'] || 0) + 1;
          prev = null;
          prevTick = null;
          continue;
        }
        cur = { index: rec.index, tick: rec.tick, base: base, hostMs: hostMs, seqBroken: seqBroken };
        gap = museGap(lib, prev, cur);
        if (gap.old) {
          repeats++; // the link delivered one record twice
          continue;
        }
        missed = gap.missed;
        /* A restart puts the packet counter back to 0, so its step across the restart is no loss count. */
        if (gap.restart) restarts++;
        else lostFrames += pendingLost;
        pendingLost = 0;
        seqBroken = false;
        if (missed) {
          gapCount++;
          if (gaps.length < 64) gaps.push({ firstSample: out.length, records: missed, samples: missed * lib.EEG_SAMPLES });
          lostRecords += missed;
          for (k = missed * lib.EEG_SAMPLES; k > 0; k--) out.push(NaN);
        }
        before = clk.nsNow;
        clk.feed(rec.tick);
        /* The tick alone folds at 0.268 s. The header time restores the whole folds of a longer step. */
        if (gap.spanNs !== null) clk.nsNow += Math.round((gap.spanNs - (clk.nsNow - before)) / lib.WRAP_NS) * lib.WRAP_NS;
        tsec = clk.nsNow / 1e9;
        /* The rate is MEASURED from the device clock, over consecutive records with no gap between
           them. A step across a gap spans the missing records and is not an inter-record interval. */
        if (prevTick !== null && !missed) steps.push(tsec - prevTick);
        prevTick = tsec;
        prev = cur;
        for (s = 0; s < smp.length; s++) out.push(smp[s][ci]);
        if (rowTick === null) rowTick = tsec;
        eegRecords++;
      }
      if (rowTick === null) continue;
      /* §🔒.7 — an anchor is `{ devMs, hostMs }` from the SAME row, and a row with no parseable host
         stamp contributes none rather than a fabricated one. */
      if (hostMs !== null) anchors.push({ devMs: rowTick * 1000, hostMs: hostMs });
    }

    lostFrames += pendingLost;
    if (!eegRecords) return { ok: false, reason: 'no-eeg-record', rows: parsed.rows.length, refusedRows: parsed.refused, unparsable: unparsable };
    /* A rate from one or two intervals is not a rate. The floor is the three `DexClock.hostAxis`
       refuses below, for the same reason: two points cannot disagree. */
    if (steps.length < 3) return { ok: false, reason: 'no-sample-rate', eegRecords: eegRecords, cleanSteps: steps.length };
    var medSec = median(steps);
    if (!(medSec > 0)) return { ok: false, reason: 'no-sample-rate', eegRecords: eegRecords, cleanSteps: steps.length };
    var fs = +(lib.EEG_SAMPLES / medSec).toFixed(4);

    /* §🔒.7 — the axis is REPORTED, NEVER APPLIED here. ECGDex gates its own `fs` correction at a
       2400 s span, and that knee is a measurement of the H10's crystal over the H10's own fragments
       (`ecgdex-dsp.js`, `ECG_AXIS_MIN_SPAN_MS`). It is not a number about this device, and spending
       it here would be the borrowed reason §∅ forbids. Nothing has measured this device's drift, so
       the node keeps the device axis and says so through the block below. Read `independent` before
       `ppm`: a host column that is the device time rounded is not a second clock. */
    var ax = typeof ckLib.hostAxis === 'function' ? ckLib.hostAxis(anchors, {}) : { ok: false, reason: 'host-axis-absent' };
    var ck0 = ckLib.parseTimestamp(parsed.rows[0].hostRaw, {});

    return {
      ok: true,
      samples: out,
      fs: fs,
      /* §🔒.6 — an unparseable first stamp is `null` with a named reason, never now() and never a
         stamp borrowed from a later row. */
      t0Ms: ck0 ? ck0.tMs : null,
      offsetMin: ck0 ? ck0.offsetMin : null,
      t0Reason: ck0 ? null : 'host-stamp-unparseable',
      channel: pick,
      channels: names,
      /* The device's own reader states the 14-bit EEG field is raw counts and that the scale is not
         measured, so the amplitude unit is UNDECLARED. A renderer then says so instead of printing
         µV² over a number nobody calibrated. */
      unit: null,
      truncated: gapCount > 0 || Object.keys(unparsable).length > 0 || Object.keys(parsed.refused).length > 0,
      source: 'muse-raw',
      frames: {
        rows: parsed.rows.length,
        files: texts.length,
        eegRecords: eegRecords,
        lostRecords: lostRecords,
        lostFrames: lostFrames,
        repeats: repeats,
        restarts: restarts,
        gapCount: gapCount,
        gaps: gaps,
        refusedRows: parsed.refused,
        unparsable: unparsable
      },
      fsBasis: { source: 'device-tick-median', cleanSteps: steps.length, medianSec: +medSec.toFixed(9), samplesPerRecord: lib.EEG_SAMPLES },
      hostAxis: {
        ok: ax.ok === true,
        anchors: anchors.length,
        n: ax.n == null ? null : ax.n,
        ppm: ax.ppm == null ? null : ax.ppm,
        independent: ax.independent == null ? null : ax.independent,
        /* ── THE FIVE FIELDS A TRIMMED AXIS DROPS, AND WHAT DROPPING THEM PUBLISHES ──────────────
           Measured 2026-11-15 against `dex-export.js timingBlock`, which is the one consumer of an
           axis on a node-export. It reads `deviceDrawn` to choose `timingSource`, and it treats an
           axis that publishes NO such field as unmeasured: `drawn` goes null, the `drawn !== false`
           branch takes it, and the builder's own comment calls that an UNDER-CLAIM to `host`. So a
           summary carrying `ok` and `independent` alone would publish `timingSource: 'host'` over a
           stream this reader never disciplines — the host axis here is a diagnostic and never moves
           `fs`. These five travel for that reason, so a later consumer states the device-rate
           verdict instead of inferring one from an absence. `deviceDrawn` is a tri-state and takes
           an `undefined` test, because `false` is one of its answers. */
        deviceDrawn: ax.deviceDrawn === undefined ? null : ax.deviceDrawn,
        drawnShare: ax.drawnShare == null ? null : ax.drawnShare,
        spreadMs: ax.spreadMs == null ? null : ax.spreadMs,
        drawnReason: ax.drawnReason == null ? null : ax.drawnReason,
        inertReason: ax.inertReason == null ? null : ax.inertReason,
        reason: ax.reason == null ? null : ax.reason
      }
    };
  }

  /* ── THE ADAPTER ENTRY POINT ───────────────────────────────────────────────────────────────────
     `signal-spec.js` declares the `eeg` route's frame as `['samples','fs','t0Ms','offsetMin']` and
     resolves its dsp to `EEGDSP`, while `analyze` reads `rec.eeg`. Those two shapes never met,
     because the route has resolved to `undefined` in every shipped bundle since it was written, so
     nothing ever exercised the mismatch. `compute` is the function that route needs, and it speaks
     the frame. It also accepts the engine's own `{ eeg, fs }` shape, which the suite already uses. */
  function compute(frame, opts) {
    frame = frame || {};
    opts = opts || {};
    var sig = frame.samples || frame.eeg || null;
    var fs = frame.fs;
    if (!sig || !sig.length) return { err: 'no EEG signal', reason: 'no-samples' };
    if (!(fs > 0)) return { err: 'no EEG signal', reason: 'no-sample-rate' };
    var res = analyze({ eeg: sig, fs: fs, t0Ms: frame.t0Ms, emg: frame.emg, eog: frame.eog, emgFs: frame.emgFs, eogFs: frame.eogFs }, opts);
    if (!res || res.err) return res || { err: 'no EEG signal', reason: 'analyze-returned-nothing' };
    /* The per-epoch spectrum rides its OWN key. `buildNodeExport` copies `bands` whole, so a
       45-bin vector an epoch would otherwise reach the bus, where no consumer asked for it. */
    var spec = {};
    res.bands = nightBands(sig, fs, { series: spec });
    if (!spec.series && !spec.reason) spec.reason = res.bands.reason || 'no-epoch-with-a-spectrum';
    res.spectra = spec;
    res.t0Ms = frame.t0Ms == null ? null : frame.t0Ms;
    res.offsetMin = frame.offsetMin == null ? null : frame.offsetMin;
    res.t0Reason = frame.t0Ms == null ? frame.t0Reason || 'no-start-stamp' : null;
    res.channel = frame.channel || null;
    /* The EDF header's own physical dimension for this channel, carried through so a surface can
       print the power unit it actually has. A synthetic frame declares none, and a renderer then
       says the amplitude unit is undeclared instead of asserting µV². */
    res.unit = frame.unit || null;
    res.durSec = +(sig.length / fs).toFixed(1);
    res.source = frame.source || null;
    res.refused = refusalBlock();
    return res;
  }

  /* THE FIVE BLOCKS, each written to satisfy ONE branch of `stageEpoch` in the order that function
     tests them. `emg` and `eog` are per-block amplitudes, and the stager normalises each to the
     RECORDING's own median, so what matters is their rank across the five rows and not the absolute
     numbers: the median of both columns is the N1 row, which puts Wake above the tone threshold and
     REM below it while leaving N2 excluded from REM by tone rather than by eye movement. */
  var BLOCKS = [
    // delta 0.08, beta+alpha 0.92, quiet spindle band, high tone -> the Wake arm
    {
      stage: 'W',
      comps: [
        [20, 14],
        [10, 10],
        [1.2, 5]
      ],
      emg: 3.0,
      eog: 1.5
    },
    // theta-dominant, fast share under the Wake floor, tone at the median -> falls through to N1
    {
      stage: 'N1',
      comps: [
        [6, 14],
        [1.2, 7],
        [10, 5]
      ],
      emg: 1.0,
      eog: 0.8
    },
    // the spindle band lifted against a moderate delta background -> the N2 arm
    {
      stage: 'N2',
      comps: [
        [1.2, 12],
        [14, 10],
        [6, 8]
      ],
      emg: 0.8,
      eog: 0.7
    },
    // slow-wave dominance over the 0.65 relative-delta floor -> the N3 arm, tested first
    {
      stage: 'N3',
      comps: [
        [1.2, 40],
        [10, 4]
      ],
      emg: 0.5,
      eog: 0.5
    },
    // low delta with low tone and eye movement present -> the REM conjunction
    {
      stage: 'REM',
      comps: [
        [6, 10],
        [10, 10],
        [1.2, 8],
        [20, 6]
      ],
      emg: 0.6,
      eog: 3.0
    }
  ];

  /* ── A DETERMINISTIC SYNTHETIC NIGHT ──────────────────────────────────────────────────────────
     For the demo path and the render-coverage rig. It is authored arithmetic, NOT a corpus night and
     no substitute for one: it proves the wiring, the units and the refusals, and it says nothing
     about the stager's accuracy. The stager's accuracy is the held-out kappa in the TUNED block
     above, measured against expert staging.

     The signal alternates a slow-wave-dominant block and a fast-dominant block, so the hypnogram
     holds more than one stage; a single-stage hypnogram would let a broken stager pass the rig. */
  function genSynthetic(opts) {
    opts = opts || {};
    var fs = opts.hz > 0 ? opts.hz : 100;
    var sec = opts.sec > 0 ? opts.sec : 1800;
    var n = Math.round(fs * sec);
    var nb = BLOCKS.length;
    var blockSec = sec / nb;
    var sig = new Float32Array(n),
      emg = new Float32Array(n),
      eog = new Float32Array(n);
    var s = (opts.seed == null ? 7 : opts.seed) >>> 0 || 1;
    var TAU = 2 * Math.PI;
    for (var i = 0; i < n; i++) {
      var t = i / fs;
      var blk = BLOCKS[Math.min(nb - 1, Math.floor(t / blockSec))];
      var v = 0;
      for (var c = 0; c < blk.comps.length; c++) v += blk.comps[c][1] * Math.sin(TAU * blk.comps[c][0] * t);
      s = (s * 1664525 + 1013904223) >>> 0;
      sig[i] = v + 4 * (s / 4294967296 - 0.5);
      s = (s * 1664525 + 1013904223) >>> 0;
      emg[i] = blk.emg * (s / 4294967296 - 0.5);
      s = (s * 1664525 + 1013904223) >>> 0;
      eog[i] = blk.eog * (s / 4294967296 - 0.5);
    }
    return {
      samples: sig,
      fs: fs,
      /* The two channels the stager's REM and Wake arms read. They are emitted because an ABSENT
         channel makes those arms permissive, so a frame without them drives every low-delta epoch
         into REM and three of the five branches become unreachable — the demo would then show a
         two-stage night and a broken stager could pass the rig. */
      emg: emg,
      eog: eog,
      emgFs: fs,
      eogFs: fs,
      /* A FLOATING wall-clock t0 (§🔒.1), fixed so the demo and the rig are reproducible. */
      t0Ms: opts.t0Ms == null ? Date.UTC(2026, 0, 1, 23, 0, 0) : opts.t0Ms,
      offsetMin: null,
      channel: 'SYNTH-C4',
      source: 'synthetic'
    };
  }

  /* ── AN OVERNIGHT SIMULATOR WITH A GROUND-TRUTH HYPNOGRAM ─────────────────────────────────────
     Owner order 2026-11-14 (board #6256): EEGDex ships a labelled simulator, so the surface can be
     exercised before a real overnight recording exists. It is AUTHORED ARITHMETIC, never a
     recording, and every surface that draws it says so. It states nothing about the stager's
     accuracy against people — that number is the held-out kappa in the TUNED block above.

     `genSynthetic` above STAYS UNTOUCHED and keeps the render-coverage rig. Its five blocks are
     pinned by a known-answer band test (`every band publishes its own median share`), so a new PRNG
     or a new block order there would move the numbers those legs exist to hold. That one is the
     fixture; this one is the night.

     WHAT IT RETURNS BESIDE THE SIGNAL. `truth` holds the hypnogram the generator USED, one entry per
     30 s epoch, plus the spindles, the K-complexes, the artefacts and the absent spans it wrote.
     ECGDex returns its ground-truth RR the same way, so a test can hold the stager against the thing
     that produced the signal rather than against itself.

     ABSENCE IS NaN, NEVER ZERO (§∅). Zero is a legal EEG sample, so a zero run is a value no
     consumer can tell from signal. `epochBands` already refuses an epoch holding a non-finite sample
     — "a hole is not a zero" — so an absent span reaches the hypnogram as `stage: null`, and
     `epochAbsence` names `signal-absent` beside it.

     NO TIME ANCHOR UNLESS THE CALLER GIVES ONE. A synthetic run has no file, so §🔒.4 offers it no
     date in the data, no 14-digit filename and no `lastModified`. The anchor is therefore `null`,
     and `t0Reason` says so. A caller that wants a clock states its own `t0Ms`, which is what the
     demo does. Stamping `Date.now()` here would fabricate the one value §🔒.2 item 6 forbids. */

  /* xorshift32, the PRNG `ecgdex-dsp.js genSynthetic` uses. One seed gives one night, byte for byte. */
  function xs32(ref) {
    var x = ref.s >>> 0;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    ref.s = x;
    return x / 4294967296;
  }

  /* ONE SPECTRUM PER STAGE, each written to reach ONE arm of `stageEpoch` in that function's own
     order, and each shaped like the stage it names:

       W    alpha with beta over it, high muscle tone      → the `bt + a > wFast` arm
       N1   theta-dominant, low fast share, mid tone       → falls through to N1
       N2   slow background with the spindle band lifted   → the `sg >= n2s && d >= n2d` arm
       N3   high-amplitude delta                           → the `d >= n3` arm
       REM  low-voltage mixed, lowest tone, active eyes    → the `d < remD` arm

     The amplitudes are authored, not fitted. `emg` and `eog` are compared to their own per-night
     MEDIAN by the stager, so what matters is the ORDER of the five tones, never their absolute size. */
  var EEG_NIGHT_SPECTRA = {
    W: {
      comps: [
        [10, 13],
        [20, 9],
        [1.0, 3]
      ],
      emg: 3.0,
      eog: 1.6,
      noise: 4
    },
    N1: {
      comps: [
        [6, 13],
        [1.2, 6],
        [10, 4]
      ],
      emg: 1.2,
      eog: 0.9,
      noise: 3.5
    },
    N2: {
      comps: [
        [1.2, 13],
        [13.5, 9],
        [6, 6]
      ],
      emg: 0.9,
      eog: 0.5,
      noise: 3
    },
    N3: {
      comps: [
        [1.0, 36],
        [2.2, 14],
        [6, 4]
      ],
      emg: 0.8,
      eog: 0.4,
      noise: 3
    },
    REM: {
      comps: [
        [6, 9],
        [18, 5],
        [1.0, 3]
      ],
      emg: 0.45,
      eog: 2.4,
      noise: 3
    }
  };

  /* THE CYCLE PLAN, AASM-shaped rather than fitted: about 90 min per cycle, N3 shrinking across the
     night and REM growing, with a short arousal closing each cycle. That decay is the one
     architectural fact a single repeating cycle gets wrong (Carskadon and Dement, Principles and
     Practice of Sleep Medicine, 6th edition, chapter 2 — a textbook description of sleep
     architecture, cited as the shape this plan follows and not as a measurement of this code).

     An arousal is 60 s, which is TWO epochs on purpose: `smoothHypnogram` replaces a SINGLE
     isolated epoch with its neighbours, so a 30 s arousal would be smoothed away and the plan would
     then name a stage the hypnogram cannot hold. */
  function nightPlan(durSec, opts) {
    opts = opts || {};
    var onset = opts.onsetSec >= 0 ? opts.onsetSec : 300;
    var raw = [{ stage: 'W', sec: Math.min(onset, durSec) }],
      used = raw[0].sec,
      c = 0,
      i;
    while (used < durSec && c < 12) {
      var cyc = [
        { stage: 'N1', sec: 90 },
        { stage: 'N2', sec: 2250 + c * 120 },
        { stage: 'N3', sec: Math.max(0, 1500 - c * 450) },
        { stage: 'N2', sec: 900 },
        { stage: 'REM', sec: 600 + c * 300 },
        { stage: 'W', sec: 60 }
      ];
      for (i = 0; i < cyc.length; i++) {
        if (cyc[i].sec <= 0 || used >= durSec) continue;
        var take = Math.min(cyc[i].sec, durSec - used);
        raw.push({ stage: cyc[i].stage, sec: take });
        used += take;
      }
      c++;
    }
    var out = [],
      at = 0;
    for (i = 0; i < raw.length; i++) {
      if (raw[i].sec <= 0) continue;
      out.push({ stage: raw[i].stage, fromSec: at, toSec: at + raw[i].sec });
      at += raw[i].sec;
    }
    return out;
  }

  /* The planted SWA decline, as a fraction of the initial sub-delta POWER lost per hour, and the
     floor its multiplier cannot pass. Both are generator facts, never thresholds: no measurement
     compares against them, and a test reads the planted slope from `truth` rather than from here. */
  var EEG_SWA_SLOPE_PER_H = -0.1;
  var EEG_SWA_FLOOR = 0.2;

  function genOvernight(opts) {
    opts = opts || {};
    var fs = opts.fs > 0 ? opts.fs : opts.hz > 0 ? opts.hz : 100;
    var durSec = opts.durSec > 0 ? opts.durSec : opts.sec > 0 ? opts.sec : 8 * 3600;
    var scenario = opts.scenario === 'clean' ? 'clean' : 'artefactual';
    var seed = (opts.seed == null ? 20261115 : opts.seed) >>> 0 || 1;
    var ref = { s: seed };
    var plan = nightPlan(durSec, opts);
    var n = Math.round(fs * durSec);
    var t0 = opts.t0Ms == null ? null : opts.t0Ms;
    var i, j, k;

    /* ── 1 · the events, chosen BEFORE the signal, so each one is also ground truth ── */
    var spindles = [],
      kcx = [],
      artefacts = [],
      absent = [];
    for (i = 0; i < plan.length; i++) {
      var seg = plan[i],
        span = seg.toSec - seg.fromSec;
      if (seg.stage === 'N2' || seg.stage === 'N3') {
        /* Spindle density, per minute of the stage: N2 carries them, N3 fewer. */
        var cnt = Math.floor((span / 60) * (seg.stage === 'N2' ? 3 : 1));
        for (k = 0; k < cnt; k++) {
          var at = seg.fromSec + ((k + 0.5) * span) / (cnt || 1) + (xs32(ref) - 0.5) * 8;
          var fast = xs32(ref) > 0.35;
          spindles.push({
            atSec: +at.toFixed(3),
            durSec: +(0.5 + xs32(ref)).toFixed(3),
            freqHz: fast ? 13.5 : 11.5,
            kind: fast ? 'fast' : 'slow',
            stage: seg.stage
          });
        }
      }
      if (seg.stage === 'N2') {
        var kc = Math.floor(span / 60);
        for (k = 0; k < kc; k++) {
          kcx.push({
            atSec: +(seg.fromSec + ((k + 0.5) * span) / (kc || 1) + (xs32(ref) - 0.5) * 10).toFixed(3),
            durSec: 0.6,
            stage: 'N2'
          });
        }
      }
      if (scenario === 'artefactual' && (seg.stage === 'W' || seg.stage === 'N1')) {
        /* Blinks ride the EOG lead and propagate to a frontal EEG lead. They belong to wake. */
        var bl = Math.floor((span / 60) * 12);
        for (k = 0; k < bl; k++) {
          artefacts.push({
            kind: 'blink',
            atSec: +(seg.fromSec + ((k + 0.5) * span) / (bl || 1) + (xs32(ref) - 0.5) * 2).toFixed(3),
            durSec: 0.3,
            stage: seg.stage
          });
        }
      }
    }
    if (scenario === 'artefactual') {
      for (k = 0; k < 3; k++) {
        artefacts.push({ kind: 'movement', atSec: +(durSec * (0.18 + 0.27 * k) + xs32(ref) * 30).toFixed(3), durSec: 4, stage: null });
      }
      for (k = 0; k < 5; k++) {
        artefacts.push({ kind: 'pop', atSec: +(durSec * (0.1 + 0.17 * k) + xs32(ref) * 60).toFixed(3), durSec: 1 / fs, stage: null });
      }
      /* TWO absent spans, and the pair is deliberate: the long one is SNAPPED to an epoch boundary
         and runs 90 s, so it costs whole epochs at any duration, while the short one sits inside an
         epoch. A consumer then sees both refusals — the whole-epoch `signal-absent` and the
         `partial-hole` — and neither depends on where the night happens to end. An unsnapped 45 s
         span landed mid-epoch at one duration and whole-epoch at another, which made the reason a
         function of `durSec` rather than of the hole. */
      var longAt = Math.floor((durSec * 0.33) / EPOCH_SEC) * EPOCH_SEC;
      absent.push({ fromSec: longAt, toSec: longAt + 3 * EPOCH_SEC, reason: 'electrode-off' });
      absent.push({ fromSec: +(durSec * 0.71 + EPOCH_SEC / 2).toFixed(3), toSec: +(durSec * 0.71 + EPOCH_SEC / 2 + 20).toFixed(3), reason: 'electrode-off' });
    }

    /* ── 2 · the base signal, one stage spectrum at a time ── */
    var sig = new Float32Array(n),
      emg = new Float32Array(n),
      eog = new Float32Array(n);
    var TAU = 2 * Math.PI,
      pi = 0;
    /* THE OVERNIGHT SWA DECLINE, PLANTED SO `swaTrend` HAS SOMETHING TO FIND. The stage spectra
       above are constant, so without this the delta power of the last NREM period equals the first
       and the slope reads zero over every night. A metric measured only against a signal that
       cannot vary has examined nothing, so the generator plants the variation and `truth` records
       the slope it planted.

       The plant scales the AMPLITUDE of every sub-delta component inside N2 and N3 by
       `sqrt(1 + slope * hours)`, so the POWER of those components falls linearly at `|slope|` of
       its initial value per hour. The floor stops a recording longer than 10 h driving the
       multiplier through zero. `swaSlopePerH: 0` disables the plant, which is the CONTROL a test
       needs: a trend detector that reports a decline over a flat night is the failure worth
       catching, and only the flat night can catch it. */
    var swaSlope = opts.swaSlopePerH == null ? EEG_SWA_SLOPE_PER_H : opts.swaSlopePerH;
    for (i = 0; i < n; i++) {
      var t = i / fs;
      while (pi < plan.length - 1 && t >= plan[pi].toSec) pi++;
      var sp = EEG_NIGHT_SPECTRA[plan[pi].stage];
      var swaMul = swaSlope && (plan[pi].stage === 'N2' || plan[pi].stage === 'N3') ? Math.sqrt(Math.max(EEG_SWA_FLOOR, 1 + swaSlope * (t / 3600))) : 1;
      var v = 0;
      for (j = 0; j < sp.comps.length; j++) {
        var amp = sp.comps[j][0] < BANDS.delta[1] ? sp.comps[j][1] * swaMul : sp.comps[j][1];
        v += amp * Math.sin(TAU * sp.comps[j][0] * t);
      }
      sig[i] = v + sp.noise * (xs32(ref) - 0.5);
      emg[i] = sp.emg * (xs32(ref) - 0.5);
      eog[i] = sp.eog * (xs32(ref) - 0.5);
    }

    /* ── 3 · the overlays, in the order a reader would draw them ── */
    function hann(rel) {
      return 0.5 * (1 - Math.cos(TAU * rel));
    }
    for (i = 0; i < spindles.length; i++) {
      var s0 = Math.round(spindles[i].atSec * fs),
        sN = Math.round(spindles[i].durSec * fs);
      for (j = 0; j < sN; j++) {
        if (s0 + j < 0 || s0 + j >= n) continue;
        sig[s0 + j] += 16 * hann(j / sN) * Math.sin(TAU * spindles[i].freqHz * ((s0 + j) / fs));
      }
    }
    for (i = 0; i < kcx.length; i++) {
      var k0 = Math.round(kcx[i].atSec * fs),
        kN = Math.round(kcx[i].durSec * fs);
      /* One full cycle over 0.6 s: a sharp negative deflection, then the positive return. */
      for (j = 0; j < kN; j++) {
        if (k0 + j < 0 || k0 + j >= n) continue;
        sig[k0 + j] += -45 * Math.sin(TAU * (j / kN));
      }
    }
    for (i = 0; i < artefacts.length; i++) {
      var a0 = Math.round(artefacts[i].atSec * fs),
        aN = Math.max(1, Math.round(artefacts[i].durSec * fs)),
        kind = artefacts[i].kind;
      for (j = 0; j < aN; j++) {
        var at2 = a0 + j;
        if (at2 < 0 || at2 >= n) continue;
        if (kind === 'blink') {
          eog[at2] += 120 * hann(j / aN) * Math.sin(TAU * 1.5 * (j / fs));
          sig[at2] += 40 * hann(j / aN) * Math.sin(TAU * 1.5 * (j / fs));
        } else if (kind === 'movement') {
          sig[at2] += 80 * (xs32(ref) - 0.5);
          emg[at2] += 6 * (xs32(ref) - 0.5);
        } else {
          sig[at2] += 400;
        }
      }
    }
    /* ── 4 · absence LAST, so no overlay writes a value back over a hole ── */
    for (i = 0; i < absent.length; i++) {
      var f0 = Math.max(0, Math.round(absent[i].fromSec * fs)),
        f1 = Math.min(n, Math.round(absent[i].toSec * fs));
      for (j = f0; j < f1; j++) sig[j] = NaN;
    }

    /* ── 5 · the ground-truth hypnogram, one entry per epoch ── */
    var nEp = Math.floor(durSec / EPOCH_SEC),
      truth = [];
    for (i = 0; i < nEp; i++) {
      var mid = i * EPOCH_SEC + EPOCH_SEC / 2,
        st = null;
      for (j = 0; j < plan.length; j++) {
        if (mid >= plan[j].fromSec && mid < plan[j].toSec) {
          st = plan[j].stage;
          break;
        }
      }
      var ab = false;
      for (j = 0; j < absent.length; j++) {
        if (absent[j].toSec > i * EPOCH_SEC && absent[j].fromSec < (i + 1) * EPOCH_SEC) ab = true;
      }
      /* `absent` marks an epoch whose SIGNAL this generator removed. The stage beside it is still
         the stage the sleeper was in, so an agreement measurement excludes these epochs and says
         how many it excluded, rather than counting a refusal as a disagreement. */
      truth.push({ epoch: i, stage: st, absent: ab, tMs: t0 == null ? null : t0 + i * EPOCH_SEC * 1000 });
    }

    return {
      samples: sig,
      fs: fs,
      emg: emg,
      eog: eog,
      emgFs: fs,
      eogFs: fs,
      t0Ms: t0,
      offsetMin: null,
      t0Reason: t0 == null ? 'synthetic-no-anchor' : null,
      channel: 'SYNTH-C4',
      source: 'synthetic',
      unit: null,
      synthetic: true,
      scenario: scenario,
      seed: seed,
      durSec: durSec,
      truth: {
        epochSec: EPOCH_SEC,
        hypnogram: truth,
        plan: plan,
        /* The planted SWA slope, so a test holds the recovered trend against the generator's own
           number instead of a constant typed twice. */
        swaSlopePerH: swaSlope,
        spindles: spindles,
        kComplexes: kcx,
        artefacts: artefacts,
        absentSpans: absent
      }
    };
  }

  /* ── THE NODE EXPORT ───────────────────────────────────────────────────────────────────────────
     `ganglior.node-export` v2.0, the envelope the other eight nodes emit. `recording.startEpochMs`
     is the floating `t0Ms`; `sleep` and `quality` are declared envelope bags, so their inner keys
     survive the scrub (`export-schema.js` recurses into `schema` and `recording` only).

     ONE STAGE IMPULSE PER TRANSITION, named `stage_<stage>` because ECGDex already emits that
     spelling for its HRV-derived stages. The Integrator can then hold an EEG stage against the
     proxy for the same minute instead of reading two vocabularies for one fact.

     `conf` is null, and that is deliberate. The hypnogram's own per-epoch `conf` is null too, for
     the reason `analyze` states: a band-power rule set has no posterior to report. ECGDex's 0.7 on
     the same impulse IS still a constant, and it rides the bus. Either number would put a
     confidence on the bus that no instrument here produced, and `conf` is declared 0..1 OR null, so
     null is the value that states what we know. */
  function buildNodeExport(summary, opts) {
    summary = summary || {};
    opts = opts || {};
    var dk = typeof global !== 'undefined' && global ? global.DexKernel : null;
    var kern = opts.kernel || dk || null;
    var kfmt = kern ? { version: kern.VERSION, hash: kern.HASH } : null;
    var arch = summary.architecture || {};
    /* ∅ · an ABSENT spindle answer is not an empty one: a summary from an older engine carries no
       `spindles` key at all, and the export then says `no-spindle-answer` rather than publishing a
       null that reads as a night with no spindle in it. */
    var sp = summary.spindles || { density: null, byStage: null, reason: 'no-spindle-answer', population: null };
    var swa = summary.swa || { decayPctPerPeriod: null, reason: 'no-swa-answer', periods: [] };
    var hyp = summary.hypnogram || [];
    var events = [],
      prev = null,
      i;
    for (i = 0; i < hyp.length; i++) {
      var ep = hyp[i];
      if (!ep || ep.stage == null) {
        /* An unscorable epoch BREAKS the run: the next scored epoch is a fresh transition, never a
           continuation across a span nobody staged. */
        prev = null;
        continue;
      }
      if (ep.stage !== prev) {
        events.push({
          t: fmtClockUTC(ep.tMs),
          tMs: ep.tMs == null ? null : ep.tMs,
          impulse: 'stage_' + String(ep.stage).toLowerCase(),
          node: 'EEGDex',
          conf: null,
          meta: { stage: ep.stage, epoch: ep.epoch }
        });
        prev = ep.stage;
      }
    }
    return {
      kernel: kfmt,
      schema: { name: 'ganglior.node-export', version: '2.0', node: 'EEGDex', nodeVersion: '1.0', bus: 'ganglior' },
      recording: {
        /* A SEMANTIC TAG, never a path: `export-schema.js` guards `recording.source` with a
           path-shaped predicate and drops a filename. The ingest sets it to 'edf' or 'synthetic'. */
        source: summary.source || null,
        startEpochMs: summary.t0Ms == null ? null : summary.t0Ms,
        offsetMin: summary.offsetMin == null ? null : summary.offsetMin,
        durSec: summary.durSec == null ? null : summary.durSec,
        sampleRateHz: summary.fs == null ? null : summary.fs,
        channel: summary.channel || null,
        /* ── THE SHARED TIMING BLOCK (DEVICE-TIME-HANDLING-2026-10-29-BRIEF U5) ──────────────────
           One shape on every node-export, built by one function (`dex-export.js timingBlock`, which
           carries the field list and the null discipline). An EDF header and a synthetic frame each
           carry ONE clock — the start stamp plus the record geometry — and no host stamp column, so
           there is no second clock here to discipline the device rate against. This node looks for
           neither device-clock resyncs nor axis seams either, so the bare call publishes both counts
           as unknown rather than zero.
           Guarded like every other `DexExport` reach in this file; `dex-export.js` is inlined in
           every bundle that builds an export and co-loaded by every realm that does, so a `null`
           here is a load-order bug and the export-parity group reds on it. */
        timing: typeof DexExport !== 'undefined' && DexExport && DexExport.timingBlock ? DexExport.timingBlock({}) : null
      },
      sleep: {
        epochSec: summary.epochSec == null ? EPOCH_SEC : summary.epochSec,
        hypnogram: hyp.map(function (e) {
          return { tMs: e.tMs, stage: e.stage };
        }),
        stageCounts: summary.stageCounts || null,
        tstHours: arch.TST == null ? null : arch.TST,
        sleepEfficiencyPct: arch.SE == null ? null : arch.SE,
        n3Pct: arch.n3Pct == null ? null : arch.n3Pct,
        remPct: arch.remPct == null ? null : arch.remPct,
        /* THE FOUR KEYS ABOVE STAY WHERE CONSUMERS ALREADY READ THEM, and the eight unit B adds
           arrive under `architecture` beside the per-key absence map. A consumer that reads only
           `tstHours` keeps working, and one that wants the whole picture reads one object whose
           every null names its own reason. */
        n1Pct: arch.n1Pct == null ? null : arch.n1Pct,
        n2Pct: arch.n2Pct == null ? null : arch.n2Pct,
        wakePct: arch.wakePct == null ? null : arch.wakePct,
        latencySleepMin: arch.latencySleepMin == null ? null : arch.latencySleepMin,
        latencyRemMin: arch.latencyRemMin == null ? null : arch.latencyRemMin,
        wasoMin: arch.wasoMin == null ? null : arch.wasoMin,
        stageShifts: arch.stageShifts == null ? null : arch.stageShifts,
        remPeriods: arch.remPeriods == null ? null : arch.remPeriods,
        architectureAbsence: summary.architectureAbsence || {},
        /* A density with its population beside it: the staged NREM minutes it is a rate over, the
           detections it counted, and the reason when it answers nothing. */
        spindleDensity: sp.density,
        spindlesPerMin: { N2: sp.byStage ? sp.byStage.N2 : null, N3: sp.byStage ? sp.byStage.N3 : null },
        spindleReason: sp.reason || null,
        spindlePopulation: sp.population || null,
        swaDecayPctPerPeriod: swa.decayPctPerPeriod == null ? null : swa.decayPctPerPeriod,
        swaReason: swa.reason || null,
        swaPeriods: swa.periods || [],
        bands: summary.bands || null
      },
      quality: {
        analyzablePct: summary.quality ? summary.quality.analyzablePct : null,
        nUnscorable: summary.quality ? summary.quality.nUnscorable : null,
        nEpochs: summary.nEpochs == null ? null : summary.nEpochs,
        /* The reason the start stamp is absent, beside the absence itself. */
        t0Reason: summary.t0Reason || null,
        refused: summary.refused || refusalBlock()
      },
      ganglior_events: events
    };
  }

  /* ── THE STAGE FORMULA, A SECOND STAGE SOURCE ───────────────────────────────────────────────────
     OFF unless the reader turns it on, and the band-power stager above stays this node's answer
     (@kestrel, #8464 rule 3). This function is the whole of the formula path inside the engine: it
     prepares the 35 columns with `EEGFEAT.eegBlockExtract`, evaluates them with `EEGSTAGE`, and
     hands back the evaluator's own per-epoch answer UNCHANGED.

     IT MAPS NO CLASS ONTO THE BAND-POWER VOCABULARY. The formula names four classes — wake, light,
     deep and REM — and renaming `light` to `N2` would claim a distinction that nobody fitted. The
     two hypnograms are two series, never one series from two engines.

     THE MODEL IS DATA AND THE READER SUPPLIES IT (board decision, this PR). No coefficient is
     inlined into the page: a model file arrives through the same drop zone as the recording, is
     recognised by its own `schema` field, and this function refuses BY NAME when a precondition is
     absent. That is also what makes "a second model loads with no code change" true for the reader
     and not only for the test lane (@kestrel, #8464 rule 6).

     §∅ — an epoch the evaluator refused carries `stage: null` and the evaluator's own reason. This
     function invents no stage for it and drops no epoch. */
  /* The reach of the second pass of `tepna.stage-formula/1`: the longest look-back and look-ahead
     its posterior columns read. It is a property of the schema and not of one model file. */
  var SECOND_PASS_REACH = 160;

  function hasSecondPass(model) {
    var passes = (model && model.passes) || [],
      i;
    for (i = 0; i < passes.length; i++) if (passes[i] && passes[i].posterior_columns) return true;
    return false;
  }

  function formulaStages(rec, model) {
    var F = global.EEGFEAT,
      S = global.EEGSTAGE;
    if (!F || !S) return { err: 'the stage-formula modules are not loaded' };
    if (!model) return { err: 'no model file — the formula scores nothing without one' };
    if (model.schema !== 'tepna.stage-formula/1') {
      return { err: 'the model file reads schema ' + model.schema + ', not tepna.stage-formula/1' };
    }
    /* It takes the SAME shape `compute` takes, and reads the samples under either key, because the
       app holds the frame it ingested rather than the rec that `analyze` saw. */
    var sig = (rec && (rec.samples || rec.eeg)) || null;
    if (!sig || !sig.length || !(rec.fs > 0)) return { err: 'no EEG signal' };
    var fs = rec.fs,
      nEp = Math.floor(sig.length / Math.round(EPOCH_SEC * fs));
    if (nEp < 2) return { err: 'under two epochs of EEG' };
    /* A SECOND PASS NEEDS THE WHOLE NIGHT. Its posterior columns read up to SECOND_PASS_REACH
       epochs each way, so on a shorter import NO epoch carries the look-back the fit used: every
       window is then cut at an end that is not the end of the night. The arithmetic still answers,
       and it agrees with the reference at 5e-8 over a 60-epoch vector, which is the trap: the
       answer sits outside the population the coefficients were fitted on. §∅ reads this as a
       DISCONTINUITY of the window rather than reduced coverage, so it refuses and names the model
       (@kestrel, board #8687). */
    if (nEp < SECOND_PASS_REACH && hasSecondPass(model)) {
      return {
        err:
          'the model ' +
          (model.id || 'unnamed') +
          ' scores a second pass that reads up to ' +
          SECOND_PASS_REACH +
          ' epochs away, and this import holds ' +
          nEp +
          '. Give it the whole night, or score with a one-pass model'
      };
    }
    /* THE NAMES ARE THE JOINT, so a mismatch refuses instead of reading column 7 as column 7 of a
       different list. The evaluator checks the 12 names it reads directly; this checks all 35, in
       order, because the rows below are positional. */
    var names = (model.inputs && model.inputs.names) || [],
      block = F.EEG_NAMES,
      k;
    if (names.length !== block.length) {
      return { err: 'the model names ' + names.length + ' inputs and the feature block gives ' + block.length };
    }
    for (k = 0; k < block.length; k++) {
      if (names[k] !== block[k]) {
        return { err: 'the model names input ' + k + ' as ' + names[k] + ' and the feature block gives ' + block[k] };
      }
    }
    var got = F.eegBlockExtract({ nEpochs: nEp, signals: { eeg: { fs: fs, data: sig } } }),
      rows = [],
      i,
      j,
      r;
    for (i = 0; i < nEp; i++) {
      r = [];
      for (j = 0; j < got.cols.length; j++) r.push(got.cols[j][i]);
      rows.push(r);
    }
    var out;
    try {
      out = S.stages(model, rows);
    } catch (e) {
      /* The evaluator's refusals are named, and the message is the reader's. A throw here is a
         model the page cannot evaluate, never a night it cannot score. */
      return { err: 'the evaluator refused the model: ' + ((e && e.message) || String(e)) };
    }
    return {
      id: out.id,
      classes: out.classes,
      epochs: out.epochs,
      scored: out.scored,
      refused: out.refused,
      nEpochs: nEp,
      modelSha16: (model.source && model.source.sha256_16) || null
    };
  }

  global.EEGDSP = {
    VERSION: VERSION,
    BANDS: BANDS,
    EPOCH_SEC: EPOCH_SEC,
    REFUSALS: REFUSALS,
    epochBands: epochBands,
    stageEpoch: stageEpoch,
    smoothHypnogram: smoothHypnogram,
    TUNED: TUNED,
    rms: rms,
    median: median,
    analyze: analyze,
    /* the SECOND stage source, off unless the reader turns it on and supplies a model file */
    formulaStages: formulaStages,
    /* the app-facing surface: the adapter entry point, the EDF ingest, the night band summary,
       the node export and the deterministic demo frame */
    compute: compute,
    ingestEDF: ingestEDF,
    ingestMuseRaw: ingestMuseRaw,
    nightBands: nightBands,
    buildNodeExport: buildNodeExport,
    genSynthetic: genSynthetic,
    /* the overnight simulator, its plan and the absence-reason helper the hypnogram now carries */
    genOvernight: genOvernight,
    nightPlan: nightPlan,
    epochAbsence: epochAbsence,
    sleepArchitecture: sleepArchitecture,
    swaTrend: swaTrend,
    remPeriodSpans: remPeriodSpans,
    detectSpindles: detectSpindles,
    spindleEnvelope: spindleEnvelope,
    SPINDLE: SPINDLE,
    ARCH_KEYS: ARCH_KEYS,
    EEG_NIGHT_SPECTRA: EEG_NIGHT_SPECTRA,
    EEG_SWA_SLOPE_PER_H: EEG_SWA_SLOPE_PER_H,
    SEF_CEIL_HZ: SEF_CEIL_HZ,
    fmtClock: fmtClockUTC,
    _fft: fft
  };
})(typeof window !== 'undefined' ? window : this);

// ESM-from-birth dual-mode (mirrors motiondex-render / glucodex-dsp): the IIFE above attaches
// window.EEGDSP for every classic co-load consumer — the two test lanes, which classic-load this file
// through tools/build-core.js `classicify`, and tools/eegdex-selftest.mjs, which does the same. This
// re-export lets the owned ESM graph's eegdex-app.js `import { EEGDSP }` instead of reading window.
export const EEGDSP = window.EEGDSP;
