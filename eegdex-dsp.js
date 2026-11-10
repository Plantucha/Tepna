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
      /* §∅ · `conf` IS NULL ON EVERY EPOCH, and that is the contract rather than a gap.
         `hypno-export.js` states it for the whole fleet: `confidence` is "the posterior of the
         decoded stage", and "a stager without posteriors (ECGDex's rule set) reports
         `confidence: null`, and the card says so". This stager is a band-power rule set with no
         posterior, so there is no number to state. The flat 0.5 that stood here until 2026-11-10 was
         an in-range sentinel: `confidenceSvg` draws "darker = surer", so a constant drew a uniform
         strip that read as a measured confidence at every epoch. A consumer now reads the absence. */
      hypnogram.push({ epoch: i, tMs: rec.t0Ms != null ? rec.t0Ms + i * EPOCH_SEC * 1000 : null, stage: st2, conf: null });
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

  /* ── §∅ WHAT THIS ENGINE CANNOT MEASURE, AND WHY EACH ONE IS ABSENT ────────────────────────────
     The node registry declares four metrics that ONE EEG channel over an EDF ingest cannot produce.
     Each refusal carries its OWN reason, never a borrowed one: a null with no reason reads downstream
     as "the recording was absent", which is a different fact from "this instrument cannot see it".

     Two of them are absent BY DESIGN rather than pending a fix. `contactPct` is the headband contact
     metric and `frontalAsym` needs the two frontal electrodes of that montage; the module header
     above records the owner's park on that front end, so no ingest here will ever supply them. The
     other two are honest gaps in this engine: there is no spindle DETECTOR (a sigma-band power is not
     a spindle count), and the calm score is a composite over the three above. */
  var REFUSALS = {
    contactPct: 'no-contact-sidecar',
    frontalAsym: 'single-channel-ingest',
    spindleDensity: 'no-spindle-detector',
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
  /* §🔒.5 — display and the export's date-less `t` read `getUTC*` off the floating `tMs`. Local to
     this node: the EDF ingest parses its stamps through `CpapEdf.parseEdfClock`, so nothing here
     needs `DexClock`, and a formatter is not a parser. */
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
  function nightBands(sig, fs) {
    var out = {
      totalPower: null,
      alphaRel: null,
      thetaRel: null,
      alphaTheta: null,
      rel: null,
      relSum: null,
      reason: null,
      ratioReason: null,
      population: { epochs: 0, withBands: 0, ratioEpochs: 0 }
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
      k;
    for (var i = 0; i < nEp; i++) {
      var b = epochBands(sig, i * step, (i + 1) * step, fs);
      if (!b) continue;
      tot.push(b.total);
      for (k in per) per[k].push(b.rel[k]);
      if (b.rel.theta > 0) ratio.push(b.rel.alpha / b.rel.theta);
    }
    out.population.withBands = tot.length;
    out.population.ratioEpochs = ratio.length;
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
    res.bands = nightBands(sig, fs);
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
        channel: summary.channel || null
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
    /* the app-facing surface: the adapter entry point, the EDF ingest, the night band summary,
       the node export and the deterministic demo frame */
    compute: compute,
    ingestEDF: ingestEDF,
    nightBands: nightBands,
    buildNodeExport: buildNodeExport,
    genSynthetic: genSynthetic,
    fmtClock: fmtClockUTC,
    _fft: fft
  };
})(typeof window !== 'undefined' ? window : this);

// ESM-from-birth dual-mode (mirrors motiondex-render / glucodex-dsp): the IIFE above attaches
// window.EEGDSP for every classic co-load consumer — the two test lanes, which classic-load this file
// through tools/build-core.js `classicify`, and tools/eegdex-selftest.mjs, which does the same. This
// re-export lets the owned ESM graph's eegdex-app.js `import { EEGDSP }` instead of reading window.
export const EEGDSP = window.EEGDSP;
