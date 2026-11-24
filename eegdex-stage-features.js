/*
 * eegdex-stage-features.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * EEGDex — the feature block of the stage formula. `window.EEGFEAT`.
 *
 * ── A PORT, NOT A DESIGN ─────────────────────────────────────────────────────
 * One EEG derivation in, 35 columns per 30 s epoch out, in the order of
 * `EEG_NAMES`. The arithmetic is a port of the files that FIT the coefficients
 * the evaluator reads, so every column here must reproduce the number the fit
 * saw. This file therefore invents nothing: a change to any constant or to any
 * order of operations below makes the coefficients describe a different
 * quantity, and that is a silent error rather than a failing test. The parity
 * assertion in `tests/dex-tests.js` holds all 35 columns against a committed
 * synthetic vector at 1e-9 relative, which is the only thing that keeps the two
 * sides one quantity.
 *
 * THE SOURCE IS NOT IN THIS REPOSITORY, so this file carries no `@port-from`
 * declaration and `tools/port-parity.mjs` reads nothing about it. That instrument
 * pins a copy against a source TEXT the tree holds; here the pin is the committed
 * vector instead, which is the stronger of the two: it compares the two sides'
 * NUMBERS rather than noticing that a source file moved. A port declaration naming
 * a path outside the tree would assert a reconciliation no gate can check.
 *
 * ── WHAT THIS FILE IS NOT ────────────────────────────────────────────────────
 * It is not the stager. `eegdex-dsp.js` holds the band-power stager that EEGDex
 * SHIPS, and that stays the default. This file is one half of a second,
 * switched-off path: the features here, the coefficient evaluation next. It
 * reads no label, decides no stage, and surfaces no number.
 *
 * ── EVERY COLUMN IS FREE OF THE SIGNAL'S UNIT ────────────────────────────────
 * The device's µV scale is not verified, so a night multiplied by any constant
 * must give the same row. Three means carry that:
 *   · a share, a ratio and a frequency need no scale;
 *   · a log power has the NIGHT's median of that column subtracted;
 *   · the event detectors run on the night in a per-night amplitude form (the
 *     night times `AMP72.refUv` over its own median absolute amplitude).
 *
 * ── ABSENCE (§∅) ─────────────────────────────────────────────────────────────
 * NaN is "not measured" throughout, and it is the ONE absent value this layer
 * speaks: an epoch with fewer than `EEGBLOCK.minSeconds` measured seconds, or a
 * night with no signal, carries NaN in that column and never a 0. A measured 0
 * is a legal value in every one of these columns, so the tests read finiteness
 * and never truthiness. The conversion of NaN to the suite's `null` happens one
 * layer out, in the evaluator, where the contract is JSON.
 */

(function (root) {
  'use strict';

  /* The band edges and the window of the per-second spectrum. This section's choice of 2 s: it puts
     0.5 Hz bins on the grid, so the delta band starts ON a bin rather than inside one. */
  const EEG_BANDS = [
    ['delta', 0.5, 4],
    ['theta', 4, 8],
    ['alpha', 8, 11],
    ['sigma', 11, 16],
    ['beta', 16, 30],
    ['gamma', 30, 45]
  ];
  const EEG_SEC_WIN_S = 2;

  /* An epoch measured for less than half of its samples carries no event value. The fit's rule
     stager read the same floor; the formula arm keeps the number and not the stager. */
  const FEAT_MIN_MEASURED = 0.5;

  /* The per-night amplitude form. `refUv` is the median of the median absolute amplitude of 230
     nights of published, openly licensed sleep recordings, in 0.5–30 Hz — a REFERENCE amplitude, not
     a calibration: it only puts every night on one scale so that an absolute threshold means the
     same thing on all of them. */
  const AMP72 = { band: [0.5, 30], refUv: 7.7, refNights: 230 };

  /* A night's median absolute amplitude in 0.5–30 Hz over its measured samples (same unit as x). */
  function nightAmplitude(x, fs) {
    const { y, bad } = bandpass(x, fs, AMP72.band[0], AMP72.band[1]);
    let m = 0;
    for (let i = 0; i < y.length; i++) if (!bad[i]) y[m++] = Math.abs(y[i]);
    if (!m) return NaN;
    const a = y.subarray(0, m).sort();
    return m % 2 ? a[(m - 1) / 2] : (a[m / 2 - 1] + a[m / 2]) / 2;
  }

  /* Slow oscillation — the published zero-crossing criteria: band-pass 0.1–4 Hz; a negative-going
     zero crossing and the next positive-going one 0.3–1.0 s apart; a negative peak below −80 µV; a
     negative-to-positive peak-to-peak above 140 µV. `aasm` is the scoring manual's own amplitude
     figure (75 µV peak-to-peak, with no separate negative-peak figure), which is the form a
     calibrated frontal-to-mastoid derivation takes, and the form this block uses. */
  const SLOW = {
    band: [0.1, 4],
    halfWaveS: [0.3, 1.0],
    published: { negUv: -80, p2pUv: 140 },
    aasm: { negUv: 0, p2pUv: 75 }
  };

  /* One second-order Butterworth section (Q = 1/√2) as a biquad; `kind` 'hp' or 'lp'. This section's choice of filter:
   the sources give the band, not the filter. */
  function biquad(kind, f0, fs, Q = Math.SQRT1_2) {
    const w = (2 * Math.PI * f0) / fs,
      c = Math.cos(w),
      al = Math.sin(w) / (2 * Q),
      a0 = 1 + al;
    const b = kind === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    return { b: b.map((v) => v / a0), a: [(-2 * c) / a0, (1 - al) / a0] };
  }
  function run(q, x) {
    const y = new Float64Array(x.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = q.b[0] * x[i] + q.b[1] * x1 + q.b[2] * x2 - q.a[0] * y1 - q.a[1] * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  }
  const rev = (x) => Float64Array.from(x).reverse();

  /* Zero-phase band-pass: high-pass at lo and low-pass at hi, each run forward and backward. A sample that is not finite
   enters the filter as 0 (after the record's mean is removed); the caller gets the mask back and must not use an event that touches it. */
  function bandpass(x, fs, lo, hi, order = 2) {
    const bad = new Uint8Array(x.length),
      z = new Float64Array(x.length);
    let sum = 0,
      m = 0;
    for (let i = 0; i < x.length; i++)
      if (Number.isFinite(x[i])) {
        sum += x[i];
        m++;
      }
    const mean = m ? sum / m : 0; // the record's own offset is removed first: a step of an electrode offset into a 0.1 Hz high-pass rings for ~20 s
    for (let i = 0; i < x.length; i++) {
      if (Number.isFinite(x[i])) z[i] = x[i] - mean;
      else bad[i] = 1;
    }
    let y = z;
    /* order 2 (the slow-oscillation band, wide): one section per edge at the nominal edge.
     order N > 2 (the narrow spindle bands): a Butterworth of order N per edge as N/2 sections, with each cutoff moved
     by (sqrt(2) - 1)^(1/(2N)) so that the forward-and-backward response is -3 dB exactly AT the nominal edge. */
    const secs = [];
    if (order === 2) secs.push(biquad('hp', lo, fs), biquad('lp', hi, fs));
    else {
      const k = Math.pow(Math.SQRT2 - 1, 1 / (2 * order));
      for (let j = 0; j < order / 2; j++) {
        const Q = 1 / (2 * Math.cos((Math.PI * (2 * j + 1)) / (2 * order)));
        secs.push(biquad('hp', lo * k, fs, Q), biquad('lp', hi / k, fs, Q));
      }
    }
    for (const q of secs) y = rev(run(q, rev(run(q, y))));
    return { y, bad };
  }

  /* The slow oscillations of x (µV, fs Hz) by the criteria `crit` ({ negUv, p2pUv }). Each event: t0 = the negative-going
   zero crossing, tz = the positive-going one, t1 = the end of the positive half-wave (the next negative-going crossing,
   at most 1 s after tz), neg = the negative peak, p2p = positive peak minus negative peak. An event within `guardS`
   of a sample that was not measured is dropped. */
  function detectSlowWaves(x, fs, crit = SLOW.published, guardS = 1) {
    const { y, bad } = bandpass(x, fs, SLOW.band[0], SLOW.band[1]),
      cum = new Int32Array(y.length + 1),
      out = [],
      g = Math.round(guardS * fs),
      maxPos = Math.round(1.0 * fs);
    for (let i = 0; i < y.length; i++) cum[i + 1] = cum[i] + bad[i];
    let i = 1;
    while (i < y.length) {
      if (!(y[i - 1] >= 0 && y[i] < 0)) {
        i++;
        continue;
      }
      const a = i;
      let j = a,
        neg = 0;
      while (j < y.length && y[j] < 0) {
        if (y[j] < neg) neg = y[j];
        j++;
      }
      if (j >= y.length) break;
      let k = j,
        pos = 0;
      while (k < y.length && y[k] >= 0 && k - j < maxPos) {
        if (y[k] > pos) pos = y[k];
        k++;
      }
      const half = (j - a) / fs;
      if (half >= SLOW.halfWaveS[0] && half <= SLOW.halfWaveS[1] && neg < crit.negUv && pos - neg > crit.p2pUv) {
        const lo = Math.max(0, a - g),
          hi = Math.min(y.length, k + g);
        if (cum[hi] - cum[lo] === 0) out.push({ t0: a / fs, tz: j / fs, t1: k / fs, neg, p2p: pos - neg });
      }
      i = j;
    }
    return out;
  }

  /* Share of each 30 s epoch covered by slow oscillations (t0…t1), the quantity the manual's "20 % of the epoch" refers to. */
  function slowWaveFraction(events, nEpochs, epochS = 30) {
    const f = new Float64Array(nEpochs);
    for (const e of events)
      for (let ep = Math.max(0, Math.floor(e.t0 / epochS)); ep <= Math.min(nEpochs - 1, Math.floor(e.t1 / epochS)); ep++)
        f[ep] += Math.max(0, Math.min(e.t1, (ep + 1) * epochS) - Math.max(e.t0, ep * epochS)) / epochS;
    return f;
  }

  /* Sleep spindle — the published single-channel four-feature detector, its four constants read at the paper:
   sigma band 11–16 Hz, broadband 0.3–30 Hz, windows of 0.3 s stepped 0.1 s;
     abs  = log10 of the mean squared sigma signal                                   threshold 1.25 (log10 µV²)
     rel  = log10 (sigma power / 4.5–30 Hz power), z-scored against a 30 s baseline  threshold 1.6
     cov  = log10 of the covariance of the broadband and the sigma signal, z-scored  threshold 1.3
     corr = that covariance over the product of the two standard deviations          threshold 0.69
   The baseline mean and SD use only the values between the 10th and the 90th percentile of the 30 s around a window.
   A spindle = consecutive windows passing all four, extended while abs and cov still pass, kept when 0.3–2.5 s long.
   The thresholds were set by their authors on a central derivation and are valid for 11–16 Hz only.
   This section's choices (the paper's supplement was not read): the filters (Butterworth of order 8 per edge, zero-phase,
   -3 dB at the nominal edges; a 13 Hz sine keeps 0.92 of its power), band
   powers taken in the time domain, and the baseline statistics recomputed once per second instead of once per window. */
  const A7 = {
    sigma: [11, 16],
    broad: [0.3, 30],
    relBand: [4.5, 30],
    winS: 0.3,
    stepS: 0.1,
    baselineS: 30,
    pct: [0.1, 0.9],
    thr: { abs: 1.25, rel: 1.6, cov: 1.3, corr: 0.69 },
    durS: [0.3, 2.5],
    order: 8 // this section's choice: a second-order section per edge halves a 13 Hz spindle and passes 20 Hz (selftest)
  };

  /* The four features per window. NaN where a window holds a sample that was not measured, or a logarithm has no value. */
  function a7Features(x, fs) {
    const sg = bandpass(x, fs, A7.sigma[0], A7.sigma[1], A7.order),
      bb = bandpass(x, fs, A7.broad[0], A7.broad[1], A7.order).y,
      rb = bandpass(x, fs, A7.relBand[0], A7.relBand[1], A7.order).y,
      s = sg.y,
      W = Math.round(A7.winS * fs),
      step = Math.round(A7.stepS * fs),
      n = Math.max(0, Math.floor((x.length - W) / step) + 1),
      cum = new Int32Array(x.length + 1),
      abs = new Float64Array(n).fill(NaN),
      relRaw = new Float64Array(n).fill(NaN),
      covRaw = new Float64Array(n).fill(NaN),
      corr = new Float64Array(n).fill(NaN);
    for (let i = 0; i < x.length; i++) cum[i + 1] = cum[i] + sg.bad[i];
    for (let w = 0; w < n; w++) {
      const i0 = w * step;
      if (cum[i0 + W] - cum[i0] > 0) continue;
      let ss = 0,
        rr = 0,
        ms = 0,
        mb = 0;
      for (let i = i0; i < i0 + W; i++) {
        ss += s[i] * s[i];
        rr += rb[i] * rb[i];
        ms += s[i];
        mb += bb[i];
      }
      ms /= W;
      mb /= W;
      let c = 0,
        vs = 0,
        vb = 0;
      for (let i = i0; i < i0 + W; i++) {
        const ds = s[i] - ms,
          db = bb[i] - mb;
        c += ds * db;
        vs += ds * ds;
        vb += db * db;
      }
      c /= W;
      if (ss > 0) abs[w] = Math.log10(ss / W);
      if (ss > 0 && rr > 0) relRaw[w] = Math.log10(ss / rr);
      if (c > 0) covRaw[w] = Math.log10(c);
      if (vs > 0 && vb > 0) corr[w] = c / Math.sqrt((vs / W) * (vb / W));
    }
    const half = Math.round(A7.baselineS / A7.stepS / 2),
      perS = Math.round(1 / A7.stepS);
    const z = (raw) => {
      const out = new Float64Array(n).fill(NaN);
      for (let b = 0; b < n; b += perS) {
        const v = [];
        for (let k = Math.max(0, b - half); k < Math.min(n, b + half); k++) if (Number.isFinite(raw[k])) v.push(raw[k]);
        if (v.length < 20) continue;
        v.sort((p, q) => p - q);
        const lo = Math.floor(A7.pct[0] * v.length),
          hi = Math.ceil(A7.pct[1] * v.length);
        let m = 0,
          sd = 0;
        for (let k = lo; k < hi; k++) m += v[k];
        m /= hi - lo;
        for (let k = lo; k < hi; k++) sd += (v[k] - m) * (v[k] - m);
        sd = Math.sqrt(sd / (hi - lo));
        if (!(sd > 0)) continue;
        for (let k = b; k < Math.min(n, b + perS); k++) if (Number.isFinite(raw[k])) out[k] = (raw[k] - m) / sd;
      }
      return out;
    };
    return { n, stepS: step / fs, winS: W / fs, abs, rel: z(relRaw), cov: z(covRaw), corr, relRaw, covRaw };
  }

  /* The spindles of x (µV, fs Hz): [{ t0, t1 }] in seconds. `thr` may replace a threshold: the absolute one has
   no meaning on a signal whose unit is not microvolts, and the caller then passes its per-night form. */
  function detectSpindles(x, fs, thr = A7.thr) {
    const f = a7Features(x, fs),
      core = (w) => f.abs[w] >= thr.abs && f.rel[w] >= thr.rel && f.cov[w] >= thr.cov && f.corr[w] >= thr.corr,
      ext = (w) => w >= 0 && w < f.n && f.abs[w] >= thr.abs && f.cov[w] >= thr.cov,
      out = [];
    let w = 0;
    while (w < f.n) {
      if (!core(w)) {
        w++;
        continue;
      }
      let a = w,
        b = w;
      while (b + 1 < f.n && core(b + 1)) b++;
      while (ext(a - 1)) a--;
      while (ext(b + 1)) b++;
      const t0 = a * f.stepS,
        t1 = b * f.stepS + f.winS,
        d = t1 - t0;
      if (d >= A7.durS[0] && d <= A7.durS[1] && !(out.length && t0 < out[out.length - 1].t1)) out.push({ t0, t1 });
      w = b + 1;
    }
    return out;
  }

  /* ── THE EVIDENCE PER EPOCH, MEASURED FROM THE SIGNAL ───────────────────────────────────────────────────────────────
   Every constant below is a choice of the detector's author unless the line marks it "manual" (the scoring manual).
   All of them were fixed before any labelled night was opened, and none of them is fitted. Every spectral test is a
   ratio, so none of them depends on the signal's unit. */
  const EVID72 = {
    winS: 2, // spectrum of a second: 2 s Hann window centred on the second (0.5 Hz bins)
    alphaBand: [8, 13], // manual: alpha rhythm 8–13 Hz
    lowSide: [4, 8],
    highSide: [16, 30],
    alphaPeak: 2, // a second carries alpha when the power density in 8–13 Hz is at least twice that of each side band
    hfBand: [30, 45], // the muscle-tone proxy
    fastBand: [18, 45], // manual: an arousal may show as frequencies above 16 Hz; the band starts 2 Hz above the sigma band so that a spindle's own leakage cannot make a second fast
    fastRise: 3, // a second is "fast" when its 18–45 Hz power is at least 3 times the median of the 10 s before the run
    arousalMinS: 3, // manual: at least 3 s
    arousalQuietS: 10, // manual: at least 10 s of stable sleep before
    arousalQuietAlpha: 2, // "stable": at most 2 alpha seconds in those 10 s
    hfMinSeconds: 15, // an epoch's 30–45 Hz power needs at least 15 measured seconds
    kcMinS: 0.5, // manual: a K complex lasts at least 0.5 s
    kcIsolS: 2, // isolated: no other slow wave within 2 s before or after
    kcEyeS: 0.5, // not a K-complex candidate when an eye movement lies within 0.5 s (separate eye derivation only)
    eye: { winS: 0.5, gapS: 0.3, k: 6, flat: 0.3, sharp: 0.7, edgeS: 0.1, refractoryS: 0.5 }
  };

  const medianOf = (v) => {
    const a = Float64Array.from(v).sort();
    return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
  };

  /* Per second: mean power density in the alpha band and in its two side bands, and the summed power in the 30–45 Hz and
   18–45 Hz bands (arbitrary common unit). NaN when the window leaves the record, holds a sample that was not measured,
   or is flat. A band holds the bins lo ≤ f < hi. */
  function secondSpectra(x, fs, C = EVID72) {
    const N = Math.round(C.winS * fs);
    if (!(fs >= 100) || Math.abs(N - C.winS * fs) > 1e-9) throw new Error('secondSpectra: fs must be at least 100 Hz with a whole number of samples per window');
    const S = Math.floor(x.length / fs),
      k0 = Math.ceil(C.lowSide[0] * C.winS),
      k1 = Math.ceil(C.hfBand[1] * C.winS) - 1,
      w = new Float64Array(N),
      cos = [],
      sin = [],
      cb = new Int32Array(x.length + 1),
      v = new Float64Array(N),
      P = new Float64Array(k1 + 1);
    let sw = 0;
    for (let i = 0; i < N; i++) sw += w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    for (let k = k0; k <= k1; k++) {
      const c = new Float64Array(N),
        s = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        c[i] = Math.cos((2 * Math.PI * k * i) / N);
        s[i] = Math.sin((2 * Math.PI * k * i) / N);
      }
      cos[k] = c;
      sin[k] = s;
    }
    for (let i = 0; i < x.length; i++) cb[i + 1] = cb[i] + (Number.isFinite(x[i]) ? 0 : 1);
    const mk = () => new Float64Array(S).fill(NaN),
      out = { alpha: mk(), low: mk(), high: mk(), hf: mk(), fast: mk() },
      band = ([lo, hi], mean) => {
        let sum = 0,
          n = 0;
        for (let k = Math.max(k0, Math.ceil(lo * C.winS)); k <= k1 && k / C.winS < hi; k++) {
          sum += P[k];
          n++;
        }
        return mean ? sum / n : sum;
      };
    for (let s = 0; s < S; s++) {
      const a = Math.round((s + 0.5) * fs) - N / 2;
      if (a < 0 || a + N > x.length || cb[a + N] - cb[a] > 0) continue;
      let m = 0,
        e = 0;
      for (let i = 0; i < N; i++) m += w[i] * x[a + i];
      m /= sw;
      for (let i = 0; i < N; i++) {
        v[i] = w[i] * (x[a + i] - m);
        e += v[i] * v[i];
      }
      if (!(e > 0)) continue;
      for (let k = k0; k <= k1; k++) {
        let re = 0,
          im = 0;
        const c = cos[k],
          q = sin[k];
        for (let i = 0; i < N; i++) {
          re += v[i] * c[i];
          im += v[i] * q[i];
        }
        P[k] = re * re + im * im;
      }
      out.alpha[s] = band(C.alphaBand, true);
      out.low[s] = band(C.lowSide, true);
      out.high[s] = band(C.highSide, true);
      out.hf[s] = band(C.hfBand, false);
      out.fast[s] = band(C.fastBand, false);
    }
    return out;
  }

  /* Rapid eye movements on a frontal bipolar derivation: a step that holds. At a sample i, with means over 0.5 s:
     pp = [i−1.0, i−0.5)   pre = [i−0.5, i)   post = [i+0.3, i+0.8)   late = [i+0.8, i+1.3)      D = post − pre
   an eye movement when |D| ≥ A, the signal was flat before (|pre − pp| ≤ 0.3 |D|) and stays after (|late − post| ≤
   0.3 |D|), and the change is sharp (the 0.1 s mean ending at i+0.3 minus the 0.1 s mean starting at i covers at least
   0.7 |D|). A = 6 times the night's median absolute change between adjacent 0.5 s means: no unit enters. A wave that
   swings back (a slow wave, a K complex) fails the two flatness tests. Movements closer than the windows (bursts) are
   under-counted; the decision list needs only one per epoch. Returns [{ t, d }], t in seconds, d the signed step. */
  function detectEyeMovements(x, fs, E = EVID72.eye) {
    const n = x.length,
      cs = new Float64Array(n + 1),
      cb = new Int32Array(n + 1),
      h = Math.round(E.winS * fs),
      g = Math.round(E.gapS * fs),
      q = Math.max(1, Math.round(E.edgeS * fs)),
      mean = (a, b) => (cs[b] - cs[a]) / (b - a),
      ds = [],
      out = [];
    for (let i = 0; i < n; i++) {
      const fin = Number.isFinite(x[i]);
      cs[i + 1] = cs[i] + (fin ? x[i] : 0);
      cb[i + 1] = cb[i] + (fin ? 0 : 1);
    }
    for (let i = h; i + h <= n; i += h) if (cb[i + h] - cb[i - h] === 0) ds.push(Math.abs(mean(i, i + h) - mean(i - h, i)));
    if (ds.length < 20) return out;
    const A = E.k * medianOf(ds);
    if (!(A > 0)) return out;
    let best = null,
      first = 0;
    for (let i = 2 * h; i + g + 2 * h <= n; i++) {
      if (cb[i + g + 2 * h] - cb[i - 2 * h] > 0) continue;
      const pre = mean(i - h, i),
        post = mean(i + g, i + g + h),
        D = post - pre,
        aD = Math.abs(D);
      if (aD < A || Math.abs(pre - mean(i - 2 * h, i - h)) > E.flat * aD || Math.abs(mean(i + g + h, i + g + 2 * h) - post) > E.flat * aD) continue;
      if ((mean(i + g - q, i + g) - mean(i, i + q)) * Math.sign(D) < E.sharp * aD) continue;
      const t = (i + g / 2) / fs;
      if (best && t - first <= E.refractoryS) {
        if (aD > Math.abs(best.d)) best = { t, d: D };
      } else {
        if (best) out.push(best);
        best = { t, d: D };
        first = t;
      }
    }
    if (best) out.push(best);
    return out;
  }

  /* The evidence records of a night, one per 30 s epoch, in the form `stageNight` reads.
     x     the staging derivation (µV when `crit` is an absolute criterion), NaN = not measured
     eye   the frontal bipolar derivation for eye movements, or null (then rem = null); it may be x itself
     crit  the slow-wave amplitude criterion ({ negUv, p2pUv }); SLOW.aasm on a calibrated derivation */
  function epochEvidence(x, fs, { eye = null, crit = SLOW.aasm, C = EVID72, minMeasured = FEAT_MIN_MEASURED } = {}) {
    const L = Math.round(30 * fs),
      nE = Math.floor(x.length / L),
      sp = secondSpectra(x, fs, C),
      S = sp.alpha.length,
      alphaSec = new Uint8Array(S),
      ev = [];
    for (let s = 0; s < S; s++) alphaSec[s] = sp.alpha[s] > 0 && sp.alpha[s] >= C.alphaPeak * sp.low[s] && sp.alpha[s] >= C.alphaPeak * sp.high[s] ? 1 : 0;
    /* Runs of at least 3 fast seconds. A second is fast when its 18–45 Hz power is at least 3 times the median of the
     10 s before the run began, or when `extra` says so. [start, end, stable]: stable = 10 s before the run with at
     least half of them measured and at most 2 of them `quietMark`ed. */
    const runsOf = (extra, quietMark) => {
      const out = [];
      for (let s = 0; s < S; ) {
        const before = [];
        let marked = 0;
        for (let t = Math.max(0, s - C.arousalQuietS); t < s; t++) {
          if (Number.isFinite(sp.fast[t])) before.push(sp.fast[t]);
          marked += quietMark(t) ? 1 : 0;
        }
        const enough = before.length >= C.arousalQuietS / 2,
          ref = enough ? medianOf(before) : NaN,
          fast = (t) => extra(t) || sp.fast[t] >= C.fastRise * ref;
        if (!fast(s)) {
          s++;
          continue;
        }
        let e = s;
        while (e < S && fast(e)) e++;
        if (e - s >= C.arousalMinS) out.push([s, e, s >= C.arousalQuietS && enough && marked <= C.arousalQuietAlpha]);
        s = e;
      }
      return out;
    };
    // 1. broadband bursts (power alone). Manual: the fast activity of an arousal is "not spindles" — what the spindle
    //    detector reads inside such a burst is not counted.
    const bursts = runsOf(
        () => false,
        () => false
      ),
      spind = detectSpindles(x, fs).filter((e) => !bursts.some(([a, b]) => (e.t0 + e.t1) / 2 >= a && (e.t0 + e.t1) / 2 < b)),
      spSec = new Uint8Array(S);
    // 2. a spindle near 13 Hz also fills the alpha band of the seconds whose window it touches: for the arousal test
    //    (not for the alpha share) those seconds are not alpha.
    for (const e of spind) for (let t = Math.max(0, Math.floor(e.t0) - 1); t <= Math.min(S - 1, Math.floor(e.t1) + 1); t++) spSec[t] = 1;
    const alphaA = (t) => alphaSec[t] === 1 && spSec[t] === 0;
    // 3. arousals: a fast run (power or alpha) after 10 s of stable signal; it belongs to the epoch in which it starts
    const arousal = new Uint8Array(nE);
    for (const [s, , stable] of runsOf(alphaA, alphaA)) if (stable && Math.floor(s / 30) < nE) arousal[Math.floor(s / 30)] = 1;
    const sw = detectSlowWaves(x, fs, crit),
      swShare = slowWaveFraction(sw, nE),
      eyes = eye ? detectEyeMovements(eye, fs, C.eye) : null,
      separateEye = eye && eye !== x,
      count = (times) => {
        const c = new Int32Array(nE);
        for (const t of times) {
          const ep = Math.floor(t / 30);
          if (ep >= 0 && ep < nE) c[ep]++;
        }
        return c;
      },
      kcT = [];
    for (let i = 0; i < sw.length; i++) {
      const e = sw[i];
      if (e.t1 - e.t0 < C.kcMinS) continue;
      if (i > 0 && sw[i - 1].t1 > e.t0 - C.kcIsolS) continue;
      if (i + 1 < sw.length && sw[i + 1].t0 < e.t1 + C.kcIsolS) continue;
      if (separateEye && eyes.some((m) => m.t >= e.t0 - C.kcEyeS && m.t <= e.t1 + C.kcEyeS)) continue;
      kcT.push(e.t0);
    }
    const nSp = count(spind.map((e) => (e.t0 + e.t1) / 2)),
      nKc = count(kcT),
      nEye = eyes ? count(eyes.map((m) => m.t)) : null,
      hf = new Float64Array(nE).fill(NaN),
      measured = new Float64Array(nE);
    for (let ep = 0; ep < nE; ep++) {
      let fin = 0;
      for (let i = ep * L; i < (ep + 1) * L; i++) if (Number.isFinite(x[i])) fin++;
      measured[ep] = fin / L;
      let sum = 0,
        m = 0;
      for (let s = ep * 30; s < (ep + 1) * 30 && s < S; s++)
        if (Number.isFinite(sp.hf[s])) {
          sum += sp.hf[s];
          m++;
        }
      if (m >= C.hfMinSeconds) hf[ep] = sum / m;
    }
    const med = medianOf(Array.from(hf).filter((v, ep) => Number.isFinite(v) && measured[ep] >= minMeasured));
    for (let ep = 0; ep < nE; ep++) {
      let al = 0;
      for (let s = ep * 30; s < (ep + 1) * 30 && s < S; s++) al += alphaSec[s];
      ev.push({
        measured: measured[ep],
        alphaShare: al / 30,
        hfRatio: med > 0 ? hf[ep] / med : NaN,
        swShare: swShare[ep],
        spindles: nSp[ep],
        kc: nKc[ep],
        rem: nEye ? nEye[ep] : null,
        arousal: arousal[ep] === 1
      });
    }
    return ev;
  }

  const EEGBLOCK = {
    band: [EEG_BANDS[0][1], EEG_BANDS[EEG_BANDS.length - 1][2]], // 0.5–45 Hz
    minSeconds: 15, // an epoch needs 15 measured seconds for a spectral value, the same floor the 30–45 Hz power takes
    minMeasured: 0.5, // … and half of its samples for an event value
    sef: 0.95, // spectral edge: the lowest bin at which the summed power reaches 95 % of the band's power
    ratios: [
      ['delta', 'beta'],
      ['theta', 'alpha'],
      ['delta', 'theta']
    ]
  };
  const EPOCH_S = 30,
    BN = EEG_BANDS.map((b) => b[0]);

  const EEG_NAMES = [
    ...BN.map((b) => `eeg.lp.${b}`), // mean over the epoch's seconds of log10 band power, minus the night's median
    ...BN.map((b) => `eeg.sd.${b}`), // SD over the epoch's seconds of log10 band power
    ...BN.map((b) => `eeg.rel.${b}`), // share of the band in the 0.5–45 Hz power of the epoch's mean spectrum
    ...EEGBLOCK.ratios.map(([a, b]) => `eeg.r.${a}_${b}`), // log10 of the ratio of two band powers (mean spectrum)
    'eeg.hj.act', // log10 of the 0.5–45 Hz power, minus the night's median
    'eeg.hj.mob', // sqrt(sum f^2 P / sum P), Hz
    'eeg.hj.cmp', // sqrt(sum f^4 P / sum f^2 P) / mobility
    'eeg.sef95', // Hz
    'eeg.sent', // Shannon entropy of the bin shares, divided by ln(number of bins)
    'eeg.ev.alpha', // share of the epoch's seconds that carry alpha
    'eeg.ev.sw', // share of the epoch inside slow waves
    'eeg.ev.spn', // spindles (count)
    'eeg.ev.spd', // spindles per measured minute
    'eeg.ev.kc', // isolated long slow waves (count)
    'eeg.ev.eye', // eye-movement events read from the same series (count)
    'eeg.ev.hf', // log10 of the epoch's 30–45 Hz power over the night's median
    'eeg.ev.arousal', // 1 when an arousal starts in the epoch
    'eeg.meas' // share of the epoch's samples that were measured
  ];

  /* Per second k < S: the power of each 0.5 Hz bin in EEGBLOCK.band (a sine of amplitude A on a bin gives A^2/2 over its
   three bins). ok[k] = 0 when the window leaves the record, holds a sample that is not finite, or is flat. */
  function secondBins(x, fs, S) {
    const N = Math.round(EEG_SEC_WIN_S * fs);
    if (!(fs >= 100) || Math.abs(N - EEG_SEC_WIN_S * fs) > 1e-9) throw new Error(`secondBins: ${fs} Hz, expected >= 100 Hz and a whole number of samples per window`);
    const df = fs / N,
      m0 = Math.round(EEGBLOCK.band[0] / df),
      m1 = Math.round(EEGBLOCK.band[1] / df),
      nm = m1 - m0,
      w = new Float64Array(N),
      C = new Float64Array(nm * N),
      Sn = new Float64Array(nm * N);
    let sw = 0,
      sw2 = 0;
    for (let i = 0; i < N; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      sw += w[i];
      sw2 += w[i] * w[i];
    }
    for (let j = 0; j < nm; j++)
      for (let i = 0; i < N; i++) {
        const a = (2 * Math.PI * (m0 + j) * i) / N;
        C[j * N + i] = Math.cos(a);
        Sn[j * N + i] = Math.sin(a);
      }
    const bad = new Int32Array(x.length + 1);
    for (let i = 0; i < x.length; i++) bad[i + 1] = bad[i] + (Number.isFinite(x[i]) ? 0 : 1);
    const P = new Float64Array(S * nm).fill(NaN),
      ok = new Uint8Array(S),
      y = new Float64Array(N),
      norm = 2 / (N * sw2);
    for (let k = 0; k < S; k++) {
      const i0 = Math.round((k + 0.5) * fs) - (N >> 1);
      if (i0 < 0 || i0 + N > x.length || bad[i0 + N] - bad[i0] > 0) continue;
      let mu = 0,
        lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < N; i++) {
        const v = x[i0 + i];
        mu += w[i] * v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!(hi > lo)) continue;
      mu /= sw;
      for (let i = 0; i < N; i++) y[i] = (x[i0 + i] - mu) * w[i];
      for (let j = 0; j < nm; j++) {
        let re = 0,
          im = 0;
        const o = j * N;
        for (let i = 0; i < N; i++) {
          re += y[i] * C[o + i];
          im += y[i] * Sn[o + i];
        }
        P[k * nm + j] = (re * re + im * im) * norm;
      }
      ok[k] = 1;
    }
    const f = Float64Array.from({ length: nm }, (_, j) => (m0 + j) * df),
      band = Int8Array.from(f, (v) => EEG_BANDS.findIndex((b) => v >= b[1] - 1e-9 && v < b[2] - 1e-9));
    return { P, ok, nm, f, band };
  }

  /* The spectral columns of n epochs, before any night median is removed. Arrays of length n, NaN where an epoch has
   fewer than EEGBLOCK.minSeconds measured seconds. */
  function epochSpectral(sb, n) {
    const nb = EEG_BANDS.length,
      arr = () => new Float64Array(n).fill(NaN),
      out = { lp: BN.map(arr), sd: BN.map(arr), rel: BN.map(arr), ratio: EEGBLOCK.ratios.map(arr), act: arr(), mob: arr(), cmp: arr(), sef: arr(), sent: arr(), seconds: new Int32Array(n) },
      { P, ok, nm, f, band } = sb,
      S = ok.length,
      Pm = new Float64Array(nm),
      pb = new Float64Array(nb),
      s1 = new Float64Array(nb),
      s2 = new Float64Array(nb),
      cnt = new Int32Array(nb);
    for (let e = 0; e < n; e++) {
      Pm.fill(0);
      s1.fill(0);
      s2.fill(0);
      cnt.fill(0);
      let m = 0;
      for (let k = e * EPOCH_S; k < (e + 1) * EPOCH_S && k < S; k++) {
        if (!ok[k]) continue;
        m++;
        pb.fill(0);
        for (let j = 0; j < nm; j++) {
          const v = P[k * nm + j];
          Pm[j] += v;
          if (band[j] >= 0) pb[band[j]] += v;
        }
        for (let b = 0; b < nb; b++)
          if (pb[b] > 0) {
            const l = Math.log10(pb[b]);
            s1[b] += l;
            s2[b] += l * l;
            cnt[b]++;
          }
      }
      out.seconds[e] = m;
      if (m < EEGBLOCK.minSeconds) continue;
      let tot = 0,
        m2 = 0,
        m4 = 0;
      pb.fill(0);
      for (let j = 0; j < nm; j++) {
        Pm[j] /= m;
        tot += Pm[j];
        m2 += f[j] * f[j] * Pm[j];
        m4 += f[j] ** 4 * Pm[j];
        if (band[j] >= 0) pb[band[j]] += Pm[j];
      }
      if (!(tot > 0)) continue;
      for (let b = 0; b < nb; b++) {
        if (cnt[b] >= EEGBLOCK.minSeconds) {
          out.lp[b][e] = s1[b] / cnt[b];
          out.sd[b][e] = Math.sqrt(Math.max(0, s2[b] / cnt[b] - (s1[b] / cnt[b]) ** 2));
        }
        out.rel[b][e] = pb[b] / tot;
      }
      EEGBLOCK.ratios.forEach(([a, b], r) => {
        const pa = pb[BN.indexOf(a)],
          q = pb[BN.indexOf(b)];
        if (pa > 0 && q > 0) out.ratio[r][e] = Math.log10(pa / q);
      });
      out.act[e] = Math.log10(tot);
      out.mob[e] = Math.sqrt(m2 / tot);
      out.cmp[e] = m2 > 0 ? Math.sqrt(m4 / m2) / out.mob[e] : NaN;
      let cum = 0,
        H = 0;
      out.sef[e] = f[nm - 1];
      for (let j = 0, found = false; j < nm; j++) {
        const p = Pm[j] / tot;
        if (p > 0) H -= p * Math.log(p);
        cum += p;
        if (!found && cum >= EEGBLOCK.sef - 1e-12) {
          out.sef[e] = f[j];
          found = true;
        }
      }
      out.sent[e] = H / Math.log(nm);
    }
    return out;
  }

  function minusNightMedian(src, dst) {
    const med = medianOf(Array.from(src).filter(Number.isFinite));
    for (let e = 0; e < src.length; e++) dst[e] = Number.isFinite(src[e]) ? src[e] - med : NaN;
  }

  /* The block: night.signals.eeg = { fs, data } (one derivation, NaN = not measured) → { names, cols }. */
  function eegBlockExtract(night) {
    const n = night.nEpochs,
      g = night.signals && night.signals.eeg,
      cols = EEG_NAMES.map(() => new Float64Array(n).fill(NaN)),
      col = Object.fromEntries(EEG_NAMES.map((nm, i) => [nm, cols[i]]));
    if (!g || !g.data) return { names: EEG_NAMES, cols };
    const x = g.data,
      fs = g.fs,
      L = Math.round(EPOCH_S * fs),
      sp = epochSpectral(secondBins(x, fs, n * EPOCH_S), n);
    BN.forEach((b, i) => {
      minusNightMedian(sp.lp[i], col[`eeg.lp.${b}`]);
      col[`eeg.sd.${b}`].set(sp.sd[i]);
      col[`eeg.rel.${b}`].set(sp.rel[i]);
    });
    EEGBLOCK.ratios.forEach(([a, b], r) => col[`eeg.r.${a}_${b}`].set(sp.ratio[r]));
    minusNightMedian(sp.act, col['eeg.hj.act']);
    col['eeg.hj.mob'].set(sp.mob);
    col['eeg.hj.cmp'].set(sp.cmp);
    col['eeg.sef95'].set(sp.sef);
    col['eeg.sent'].set(sp.sent);
    const meas = col['eeg.meas'];
    for (let e = 0; e < n; e++) {
      let fin = 0;
      for (let i = e * L; i < (e + 1) * L && i < x.length; i++) if (Number.isFinite(x[i])) fin++;
      meas[e] = fin / L;
    }
    const amp = nightAmplitude(x, fs);
    if (amp > 0) {
      const k = AMP72.refUv / amp,
        xs = Float64Array.from(x, (v) => v * k),
        ev = epochEvidence(xs, fs, { eye: xs });
      for (let e = 0; e < n && e < ev.length; e++) {
        const r = ev[e];
        if (!(r.measured >= EEGBLOCK.minMeasured)) continue;
        col['eeg.ev.alpha'][e] = r.alphaShare;
        col['eeg.ev.sw'][e] = r.swShare;
        col['eeg.ev.spn'][e] = r.spindles;
        col['eeg.ev.spd'][e] = r.spindles / (0.5 * r.measured);
        col['eeg.ev.kc'][e] = r.kc;
        col['eeg.ev.eye'][e] = r.rem === null ? NaN : r.rem;
        col['eeg.ev.hf'][e] = r.hfRatio > 0 ? Math.log10(r.hfRatio) : NaN;
        col['eeg.ev.arousal'][e] = r.arousal ? 1 : 0;
      }
    }
    return { names: EEG_NAMES, cols };
  }

  root.EEGFEAT = {
    EEG_BANDS: EEG_BANDS,
    EEG_SEC_WIN_S: EEG_SEC_WIN_S,
    FEAT_MIN_MEASURED: FEAT_MIN_MEASURED,
    AMP72: AMP72,
    SLOW: SLOW,
    A7: A7,
    EVID72: EVID72,
    EEGBLOCK: EEGBLOCK,
    EEG_NAMES: EEG_NAMES,
    nightAmplitude: nightAmplitude,
    bandpass: bandpass,
    detectSlowWaves: detectSlowWaves,
    slowWaveFraction: slowWaveFraction,
    a7Features: a7Features,
    detectSpindles: detectSpindles,
    secondSpectra: secondSpectra,
    detectEyeMovements: detectEyeMovements,
    epochEvidence: epochEvidence,
    secondBins: secondBins,
    epochSpectral: epochSpectral,
    eegBlockExtract: eegBlockExtract
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
