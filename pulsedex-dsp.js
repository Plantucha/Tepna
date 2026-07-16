/* ════ PulseDex · DSP (pulsedex-dsp.js) ────────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   RR signal math: time/frequency-domain HRV, Poincaré, Welltory-calibrated
   estimates, VO₂/BP proxies, advanced metrics (Lomb–Scargle, DFA α1, SampEn,
   fragmentation, PRSA), RR parsing, artifact correction, recording classifier,
   windowed analysis & the SVG line-chart helper. Function declarations only.
   Plain global script (matches pulsedex-overview.js convention). Globals: math/metric fns + `lastResult` state.
   No external libraries. ════════════════════════════════════════════════════ */

/* ════ NAMESPACED BUILD (SIGNAL-ADAPTER-FOLLOWUPS §3) ═══════════════════════════
   The whole DSP body is wrapped in ONE IIFE so its math/clock helpers (mean, std,
   rmssd, parseTimestamp, the interval parser …) stay closure-LOCAL and never leak
   as bare globals. This lets the Data Unifier / OverDex co-load this DSP in the
   SAME realm as oxydex/hrvdex/integrator-dsp.js (which declare colliding bare
   names) WITHOUT the per-node isolation iframe. The public surface hangs off
   root.PulseDex. App back-compat: the sibling files (render/overview/cross/app)
   call the bare helpers, so UNLESS root.__DEX_NAMESPACED__ is set (the co-load
   realm sets it) every helper is re-exported onto the global at the end — identical
   to the pre-wrap behavior. Mutable cross-file state (lastResult, written by the
   app) is proxied via an accessor so the app's bare `lastResult = …` keeps
   targeting the in-closure binding. ════════════════════════════════════════════ */
(function (root) {
  // ─── MATH ─────────────────────────────────────────────────────────────────────

  /* ════ CANONICAL CLOCK · CLOCK-UNIFY (duplicated locally per app) ═══════════
   tMs = floating wall-clock ms: the recording's LOCAL civil time encoded as if
   it were UTC. ALWAYS read back via getUTC* getters. Viewer-timezone-independent.
   parseTimestamp(raw,opts) → { tMs, offsetMin } | null. See CLOCK-UNIFY-BRIEF.md §1. */
  /* ── §1 CLOCK CONTRACT — single-sourced in clock.js (A5, owner-ratified 2026-07-03;
   OWN-THE-BUILD-FOLLOWUPS §3). The former verbatim mirror block lived here; clock.js now
   carries THE canonical tzOffset + _ckP2/_ckNumEpoch/_ckZoneMin/_ckDMY + parseTimestamp and
   loads BEFORE this file in every
   host + bundle (dex-coload.js / *.src.html). Local aliases keep every internal call site
   and the back-compat re-export tail byte-compatible. ── */
  var tzOffset = DexClock.tzOffset,
    _ckP2 = DexClock._ckP2,
    _ckNumEpoch = DexClock._ckNumEpoch,
    _ckZoneMin = DexClock._ckZoneMin,
    _ckDMY = DexClock._ckDMY,
    parseTimestamp = DexClock.parseTimestamp;
  function fmtClock(ms) {
    var d = new Date(ms);
    return _ckP2(d.getUTCHours()) + ':' + _ckP2(d.getUTCMinutes());
  }
  function fmtDate(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + _ckP2(d.getUTCMonth() + 1) + '-' + _ckP2(d.getUTCDate());
  }
  function fmtDateTime(ms) {
    return fmtDate(ms) + ' ' + fmtClock(ms);
  }

  /* §B1 · interval-likeness ceiling. An interval series must CONSERVE TIME — the gaps between beats
   sum to the time they span. Measured on the real corpus: 19/19 genuine RR/PPI recordings land at
   1.00–1.01. The H10 accelerometer read as RR claims 24.6×, the Verity 15.6×. 2.0 sits ~8× above the
   worst genuine file and ~8× below the nearest offender, and it can only fire on the IMPOSSIBLE side
   (dropped beats shrink the sum, never grow it). Not a variability floor: a genuinely flat recording
   still conserves time. */
  const PD_MAX_TIME_RATIO = 2.0;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const std = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - m;
      s += d * d;
    }
    return Math.sqrt(s / (a.length - 1));
  }; // sample SD (÷N−1) — HRV Task Force / Kubios convention, unified fleet-wide 2026-06-24
  const rmssd = (a) => {
    const d = [];
    for (let i = 1; i < a.length; i++) d.push((a[i] - a[i - 1]) ** 2);
    return Math.sqrt(mean(d));
  };
  const pnn50 = (a) => {
    let n = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - a[i - 1]) > 50) n++;
    return (n / (a.length - 1)) * 100;
  };
  const nn50c = (a) => {
    let n = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - a[i - 1]) > 50) n++;
    return n;
  };
  const minmax = (a) => {
    let mn = Infinity,
      mx = -Infinity;
    for (const v of a) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return { mn, mx };
  };
  const mxdmn = (a) => {
    const { mn, mx } = minmax(a);
    return mx - mn;
  };
  const quant = (a, q) => {
    const s = [...a].sort((x, y) => x - y),
      i = (s.length - 1) * q,
      l = Math.floor(i),
      h = Math.ceil(i);
    return +(s[l] + (s[h] - s[l]) * (i - l)).toFixed(1);
  };
  const modeV = (a) => {
    const f = {};
    a.forEach((v) => {
      const k = Math.round(v / 10) * 10;
      f[k] = (f[k] || 0) + 1;
    });
    return +Object.entries(f).sort((x, y) => y[1] - x[1])[0][0];
  };
  const amo50 = (a, mo) => (a.filter((v) => Math.abs(v - mo) <= 25).length / a.length) * 100;
  const sd1 = (r) => r / Math.sqrt(2);
  const sd2 = (s, r) => Math.sqrt(Math.max(0, 2 * s * s - (r * r) / 2));
  // §8 (DEEP-AUDIT-2026-07-14): the Poincaré SD1 spread is SDSD — the SAMPLE SD (÷N−1) of the successive-
  // difference series — NOT rMSSD (the RMS of those differences, ÷N, no mean-centering). They differ only by
  // mean(Δ)² ≈ 0, so this is numerically negligible, but it unifies the SD1 definition with ECGDex/PpgDex
  // (both SDSD/√2) so the three nodes can never drift definitionally. sd1/sd2 keep the geometric identity —
  // pass SDSD in place of rMSSD: SD1²=SDSD²/2, SD2=√(2·SDNN²−SD1²) hold exactly as before.
  const sdsd = (a) => {
    if (a.length < 3) return 0;
    const d = [];
    for (let i = 1; i < a.length; i++) d.push(a[i] - a[i - 1]);
    return std(d);
  };
  const lnR = (r) => Math.log(r);
  const lfHf = (lf, hf) => (hf ? lf / hf : 0);
  const nu = (v, tp) => (tp ? (v / tp) * 100 : 0);

  // spectral() (crude rmssd²-proxy PSD: hf≈rmssd², arbitrary 0.35/0.1 LF split) REMOVED 2026-06-30
  // (DEEP-AUDIT-FIXES §1). It was the pre–Lomb–Scargle estimator; its only surfaced use — the
  // "VLF (night)"/"Total Pwr (night)" display rows — mis-stated VLF (4–11× the real LS VLF) and
  // borrowed a `validated` grade. lombScargle() is the single spectral source. Closes SIGNAL-ADAPTER §622.
  function ansBalance(hf, lf) {
    const ratio = lf / (hf || 1); // LF/HF (sympathovagal)
    const x = Math.log(ratio || 0.0001);
    const sns = Math.round(100 / (1 + Math.exp(-x * 1.3))); // 0–100, rises with LF/HF (≈50 at balance)
    const psns = 100 - sns; // parasympathetic complement (non-saturating)
    return {
      sns,
      psns,
      snsBal: +ratio.toFixed(3),
      psnsBal: +(1 / ratio).toFixed(3)
    };
  }
  // Welltory-style composite estimates — calibrated to 30+ Welltory readings (least-squares)
  function stressEst(sd, rm) {
    return Math.round(Math.max(0, Math.min(100, 107.68 - 0.2525 * sd - 1.2295 * rm)));
  } // R²=0.92 vs Welltory Stress(HRV)
  function hrvEst(sd, rm, pn) {
    return Math.round(Math.max(0, Math.min(100, 1.494 * rm - 13.37)));
  } // calibrated to Welltory HRV Score: linear in rMSSD, R²=0.997
  function energyEst(sd, rm) {
    return Math.round(Math.max(0, Math.min(100, 1.27 + 0.4314 * sd + 0.485 * rm)));
  } // R²=0.67 vs Welltory Energy(HRV)
  function focusEst(sd, rm) {
    return Math.round(Math.max(0, Math.min(100, -67.51 + 31.94 * Math.log(sd))));
  } // R²=0.45 vs Welltory Focus (SDNN-driven)
  function cohEst(rm, sd) {
    return Math.round(Math.min(100, (rm / sd) * 100 * 0.7));
  } // PulseDex-native — Welltory Coherence index is not derivable from summary HRV (R²≈0)
  // VO2 / BP / cognitive
  function vo2Base(hrRest, hrmax) {
    return (15.3 * hrmax) / hrRest;
  } // Uth-Sørensen (2004): VO₂max ≈ 15.3 × HRmax/HRrest
  function vo2Adj(base, lnrm) {
    const d = lnrm - 3.4;
    return base * (1 + Math.max(-0.08, Math.min(0.08, d * 0.1)));
  }
  // Altitude VO₂max correction: aerobic capacity falls ~1% per 300 m above ~1500 m (Buskirk; Wehrlin & Hallén 2006)
  function altVO2Factor(elevM) {
    return elevM <= 1500 ? 1 : Math.max(0.55, 1 - ((elevM - 1500) / 300) * 0.01);
  }
  // Periodic-breathing index from the RR tachogram: power concentration in the
  // 0.01–0.05 Hz band (30–100 s cycle) relative to total LF/VLF — the cyclic-HR
  // signature of high-altitude periodic breathing / Cheyne-Stokes.
  function periodicBreathingIndex(a) {
    const N = a.length;
    if (N < 120) return null;
    const t = [];
    let acc = 0;
    for (let i = 0; i < N; i++) {
      t.push(acc / 1000);
      acc += a[i];
    }
    const dt = linfit(t, a),
      x = a.map((v, i) => v - (dt.slope * t[i] + dt.intercept));
    const band = (lo, hi) => {
      let p = 0;
      const nf = 48,
        df = (hi - lo) / (nf - 1);
      for (let k = 0; k < nf; k++) {
        const w = 2 * Math.PI * (lo + k * df);
        let cs = 0,
          ss = 0,
          cc = 0,
          sc2 = 0;
        for (let i = 0; i < N; i++) {
          const c = Math.cos(w * t[i]),
            s = Math.sin(w * t[i]);
          cs += x[i] * c;
          ss += x[i] * s;
          cc += c * c;
          sc2 += s * s;
        }
        p += ((cs * cs) / (cc || 1) + (ss * ss) / (sc2 || 1)) * 0.5 * df;
      } // ×df → integrated power, bands comparable
      return p;
    };
    const pb = band(0.01, 0.05),
      lf = band(0.04, 0.15),
      tot = band(0.003, 0.4) || 1;
    const frac = Math.min(1, pb / tot);
    return { frac: +frac.toFixed(3), strong: frac > 0.4 && pb > lf }; // PB dominates the low band
  }
  function siCalc(amo, mo, mx) {
    return mo && mx ? amo / (2 * (mo / 1000) * (mx / 1000)) : 0;
  } // Baevsky SI — Mo & MxDMn in SECONDS (Welltory units)
  // BP-from-HRV (bpEst) and HTN-pattern (htnScore) REMOVED 2026-06-22 — "blood pressure from HRV"
  // has no validity (DEX-SUITE-EXTERNAL-REVIEW-v2 §🔴; same standing rule that retired ANS Age and
  // the OxyDex/HRVDex BP projection: a metric that needs a "NOT a cuff" disclaimer does not earn a
  // surfaced card). Do not reintroduce — the render rows, CSV columns and result fields are gone too.
  function efcIdx(en, fo, co) {
    return en * 0.4 + fo * 0.3 + co * 0.3;
  }
  function crsIdx(co, rm, pn, st) {
    return st ? (co * rm * pn) / (st * 1000) : 0;
  }
  function absIdx(ps, sn) {
    return ps + sn ? (ps - sn) / (ps + sn) : 0;
  }

  // ─── ADVANCED / RESEARCH METRICS ───────────────────────────────────────────────
  // Simple OLS line fit → {slope, intercept}
  function linfit(x, y) {
    const n = x.length,
      mx = mean(x),
      my = mean(y);
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      num += (x[i] - mx) * (y[i] - my);
      den += (x[i] - mx) ** 2;
    }
    const slope = den ? num / den : 0;
    return { slope, intercept: my - slope * mx };
  }

  // DFA short-term scaling exponent alpha1 (Peng et al., classic linear-detrend; box 4..16)
  function dfaAlpha1(a) {
    const N = a.length;
    if (N < 16) return null;
    const m = mean(a);
    let acc = 0;
    const y = [];
    for (let i = 0; i < N; i++) {
      acc += a[i] - m;
      y.push(acc);
    } // integrated profile
    const logn = [],
      logF = [];
    for (let n = 4; n <= 16; n++) {
      const nB = Math.floor(N / n);
      if (nB < 1) continue;
      let sumSq = 0,
        cnt = 0;
      const xs = [];
      for (let i = 0; i < n; i++) xs.push(i);
      for (let b = 0; b < nB; b++) {
        const seg = y.slice(b * n, (b + 1) * n);
        const { slope, intercept } = linfit(xs, seg);
        for (let i = 0; i < n; i++) {
          const r = seg[i] - (slope * i + intercept);
          sumSq += r * r;
          cnt++;
        }
      }
      const F = Math.sqrt(sumSq / cnt);
      if (F > 0) {
        logn.push(Math.log10(n));
        logF.push(Math.log10(F));
      }
    }
    if (logn.length < 3) return null;
    return +linfit(logn, logF).slope.toFixed(3);
  }

  // Sample Entropy (m=2, r=0.2*SDNN) — canonical, excludes self-matches.
  // O(N²) pair-counting. Defensive length guard (SYNTH-TEXTURE-FOLLOWUPS §2, verify-not-fix):
  // the sole in-app caller (pulsedex-app.js) passes a BOUNDED series — a single 5-min
  // representative window for long/overnight recordings, or a <90-min short recording otherwise —
  // so this never triggers today. It only caps a future caller that hands SampEn a full multi-hour
  // night (~25k+ beats), where N² would jank the main thread. Deterministic uniform decimation to
  // MAXN preserves the interval distribution; r (tolerance) stays the caller's, scaled to the original SD.
  function sampEn(a, m, r) {
    let N = a.length;
    if (N < m + 2) return null;
    const MAXN = 20000;
    if (N > MAXN) {
      const stride = Math.ceil(N / MAXN),
        dec = [];
      for (let i = 0; i < N; i += stride) dec.push(a[i]);
      a = dec;
      N = a.length;
    }
    let B = 0,
      A = 0;
    for (let i = 0; i < N - m; i++) {
      for (let j = i + 1; j < N - m; j++) {
        let k = 0;
        while (k < m && Math.abs(a[i + k] - a[j + k]) <= r) k++;
        if (k === m) {
          B++;
          if (Math.abs(a[i + m] - a[j + m]) <= r) A++;
        }
      }
    }
    if (B === 0 || A === 0) return null;
    return +(-Math.log(A / B)).toFixed(3);
  }

  // Heart Rate Fragmentation (Costa & Goldberger 2017): PIP, IALS, PSS, PAS
  function fragmentation(a) {
    const N = a.length;
    if (N < 4) return null;
    const d = [];
    for (let i = 1; i < N; i++) d.push(a[i] - a[i - 1]);
    // sign of each increment; carry previous sign across zero-differences
    const s = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    for (let i = 0; i < s.length; i++) {
      if (s[i] === 0) s[i] = i > 0 ? s[i - 1] : 1;
    }
    // inflection points: sign change between consecutive increments
    let ip = 0;
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) ip++;
    const PIP = (ip / N) * 100;
    // run lengths of constant acceleration sign (= acceleration/deceleration segments)
    const runs = [];
    let len = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === s[i - 1]) len++;
      else {
        runs.push(len);
        len = 1;
      }
    }
    runs.push(len);
    const nSeg = runs.length;
    const IALS = nSeg / N; // inverse average segment length (segments per NN)
    let tot = 0,
      shortNN = 0,
      pasNN = 0,
      altRun = 0;
    runs.forEach((L) => {
      tot += L;
      if (L < 3) shortNN += L;
    });
    for (let i = 0; i < runs.length; i++) {
      if (runs[i] === 1) altRun++;
      else {
        if (altRun >= 4) pasNN += altRun;
        altRun = 0;
      }
    }
    if (altRun >= 4) pasNN += altRun;
    return {
      pip: +PIP.toFixed(1),
      ials: +IALS.toFixed(3),
      pss: +((shortNN / tot) * 100).toFixed(1),
      pas: +((pasNN / tot) * 100).toFixed(1)
    };
  }

  // Deceleration / Acceleration Capacity via Phase-Rectified Signal Averaging (Bauer 2006)
  // sign=+1 → deceleration (RR lengthening anchors), sign=-1 → acceleration
  function prsaCapacity(a, sign) {
    const N = a.length,
      L = 2;
    const win = [];
    for (let i = L; i < N - L; i++) {
      const isAnchor = sign > 0 ? a[i] > a[i - 1] : a[i] < a[i - 1];
      if (!isAnchor) continue;
      if (Math.abs(a[i] - a[i - 1]) / a[i - 1] > 0.05) continue; // artifact guard (>5% jump)
      win.push(a.slice(i - L, i + L + 1)); // [-2,-1,0,+1,+2]
    }
    if (win.length < 3) return null;
    const X = [];
    for (let k = 0; k < 2 * L + 1; k++) {
      let s = 0;
      win.forEach((w) => (s += w[k]));
      X.push(s / win.length);
    }
    // Haar-wavelet quantification: (X[0]+X[+1] - X[-1] - X[-2]) / 4
    return +((X[2] + X[3] - X[1] - X[0]) / 4).toFixed(2);
  }

  // HRV Triangular Index (geometric): total NN / modal-bin count, bin = 1/128 s
  function triangularIndex(a) {
    const binW = 1000 / 128; // ≈7.8125 ms
    const f = {};
    let maxC = 0;
    a.forEach((v) => {
      const k = Math.round(v / binW);
      f[k] = (f[k] || 0) + 1;
      if (f[k] > maxC) maxC = f[k];
    });
    return +(a.length / maxC).toFixed(2);
  }

  // Lomb–Scargle periodogram for unevenly-sampled RR → true VLF/LF/HF + resp-rate proxy
  // Power normalized so the band integral equals signal variance (Parseval).
  function lombScargle(a, nf) {
    const N = a.length;
    const t = [];
    let acc = 0;
    for (let i = 0; i < N; i++) {
      t.push(acc / 1000);
      acc += a[i];
    } // beat times in seconds
    const dt = linfit(t, a);
    const x = a.map((v, i) => v - (dt.slope * t[i] + dt.intercept)); // linear detrend (Task Force) — stops slow drift leaking into VLF/LF
    const fLo = 0.003,
      fHi = 0.4;
    nf = nf || 512;
    const df = (fHi - fLo) / (nf - 1);
    // peakF/peakP = peak within the HF band (RSA) → respRate (back-compat contract).
    // gPeakF/gPeakP = GLOBAL peak across the WHOLE analysed band. The old code tracked the
    // peak ONLY inside the HF branch, so a dominant oscillation BELOW 0.15 Hz (Cheyne-Stokes /
    // periodic breathing — the corpus plants CSR at ~0.017 Hz) was invisible: respRate reported
    // the tiny residual HF peak and the sub-HF rhythm vanished. Track it globally and expose where
    // the dominant component actually sits (SYNTH-TEXTURE-FOLLOWUPS §1).
    let tp = 0,
      vlf = 0,
      lf = 0,
      hf = 0,
      peakF = 0,
      peakP = 0,
      gPeakF = 0,
      gPeakP = 0;
    for (let kf = 0; kf < nf; kf++) {
      const f = fLo + kf * df,
        w = 2 * Math.PI * f;
      let s2 = 0,
        c2 = 0;
      for (let i = 0; i < N; i++) {
        s2 += Math.sin(2 * w * t[i]);
        c2 += Math.cos(2 * w * t[i]);
      }
      const tau = Math.atan2(s2, c2) / (2 * w);
      let nC = 0,
        nS = 0,
        dC = 0,
        dS = 0;
      for (let i = 0; i < N; i++) {
        const wt = w * (t[i] - tau),
          cw = Math.cos(wt),
          sw = Math.sin(wt);
        nC += x[i] * cw;
        dC += cw * cw;
        nS += x[i] * sw;
        dS += sw * sw;
      }
      const P = 0.5 * ((nC * nC) / (dC || 1) + (nS * nS) / (dS || 1));
      const e = P * df;
      tp += e;
      if (P > gPeakP) {
        gPeakP = P;
        gPeakF = f;
      } // GLOBAL peak (whole band) — surfaces sub-HF CSR/PB
      if (f < 0.04) vlf += e;
      else if (f < 0.15) lf += e;
      else {
        hf += e;
        if (P > peakP) {
          peakP = P;
          peakF = f;
        }
      } // HF-only peak → respRate (RSA frequency)
    }
    const variance = x.reduce((s, v) => s + v * v, 0) / N;
    const sc = tp > 0 ? variance / tp : 1; // calibrate ∫PSD = variance
    // DEEP-AUDIT-2026-07-14 §3: tp is the band SUM, so vlf+lf+hf==totalPower holds EXACTLY rather than to
    // within rounding — mirrors ECGDex:601 / PpgDex. (Immaterial here vs the ±1–2 ms² rounding, but keeps
    // the definition identical on both PulseDex spectral paths so the identity can never drift back.)
    const _v = Math.round(vlf * sc),
      _l = Math.round(lf * sc),
      _h = Math.round(hf * sc);
    return {
      tp: _v + _l + _h,
      vlf: _v,
      lf: _l,
      hf: _h,
      lfhf: +(lf / (hf || 1)).toFixed(3),
      peakHz: +gPeakF.toFixed(4), // frequency (Hz) of the GLOBAL spectral peak
      peakBand: gPeakF < 0.04 ? 'VLF' : gPeakF < 0.15 ? 'LF' : 'HF',
      peakBelowHF: gPeakF > 0 && gPeakF < 0.15, // dominant oscillation sits BELOW the HF/RSA band — combine with periodicBreathingIndex (band-fraction) for a PB/CSR judgment; on its own it can also be slow VLF drift
      respBelowHF: gPeakF > 0 && gPeakF < 0.15 && gPeakP > peakP * 2, // STRICT: the sub-HF peak clearly dominates the HF peak → the HF-derived respRate is unreliable
      respRate: +(peakF * 60).toFixed(1) // breaths/min from HF peak
    };
  }

  // ─── MAIN CALCULATE ───────────────────────────────────────────────────────────
  let lastResult = null;

  // Parse RR input. Supports two shapes:
  //   1) Delimited timestamp exports — "Phone timestamp;RR-interval [ms]" rows
  //      (Polar Flow / Welltory / Elite HRV style), one record per line, where
  //      the RR value is the last ';' / tab / comma-separated field.
  //   2) Free-form — space / newline / comma-separated RR values in ms.
  // CLOCK-UNIFY: every stamp goes through parseTimestamp → floating wall-clock ms.
  // Returns { vals:[ms…], tsMs:[ms…]|null, t0Ms:Number|null, offsetMin:Number|null }.
  // A row with no parseable stamp yields NaN (never now()).
  // ── interval-column locators (so PPI exports parse the PP-interval, not HR) ──
  // PpgDex self-PPI and Polar *_PPI.txt put PP-interval in an INNER column and HR
  // in the LAST column. Header label wins; else pick the column whose values sit
  // in the physiological interval band.
  function _pdIntervalColFromHeader(parts) {
    const pats = [/pp[\s_\-]*interval/i, /rr[\s_\-]*interval/i, /nn[\s_\-]*interval/i, /\bppi\b/i, /\brri\b/i, /\bnni\b/i, /interval\s*\[?\s*ms/i, /^\s*rr\s*$/i, /^\s*pp\s*$/i];
    for (const pat of pats) {
      for (let i = 0; i < parts.length; i++) {
        if (pat.test(parts[i] || '')) return i;
      }
    }
    return -1;
  }
  /* A column whose header DECLARES a foreign unit is not an interval column, whatever its values do.
   DEEP-AUDIT-FOLLOWUPS §B1. The H10 accelerometer's Z axis rails at ~973 mg — squarely inside the
   300–2000 "looks like an RR interval" window — and was read as 973 ms beats. Polar Sensor Logger
   always declares the unit in the header (`X [mg]`, `Gyro [dps]`, `[uV]`, `[nT]`), so this is a
   deterministic veto with no threshold and no judgement call. Milliseconds are the only unit an
   interval may carry. */
  const _PD_FOREIGN_UNIT = /\[\s*(mg|g|dps|deg\/s|uv|mv|nt|ut|hpa|lux|celsius|°c)\s*\]/i;
  function _pdForeignUnitCol(headerLine, c) {
    if (!headerLine || c < 0 || c >= headerLine.length) return false;
    return _PD_FOREIGN_UNIT.test(String(headerLine[c] || ''));
  }
  function _pdIntervalColByRange(rows, headerLine) {
    if (!rows.length) return -1;
    let ncol = 0;
    for (const r of rows) ncol = Math.max(ncol, r.length);
    let best = -1,
      bestScore = -1;
    for (let c = 0; c < ncol; c++) {
      if (_pdForeignUnitCol(headerLine, c)) continue; // §B1: a declared [mg]/[dps]/[uV] column is never RR
      const nums = [];
      for (const r of rows) {
        const v = parseFloat(String(r[c] || '').replace(',', '.'));
        if (isFinite(v)) nums.push(v);
      }
      if (nums.length < rows.length * 0.5) continue;
      const med = medianOf(nums);
      if (med >= 300 && med <= 2000) {
        const inRange = nums.filter((v) => v >= 250 && v <= 2500).length / nums.length; // interval-like fraction
        if (inRange > bestScore) {
          bestScore = inRange;
          best = c;
        }
      }
    }
    return best;
  }
  // ── multi-part split files (Polar Sensor Logger) ───────────────────────────
  // `…_RR_part01of03.txt` / `…_PPI_part…`. Each part repeats the header. Group by
  // part-stripped base, concatenate in numeric part order (header from part 1
  // only) so a split RR/PPI capture becomes ONE recording, not N fragments.
  // Mirror of the PpgDex/ECGDex fix (parseTimestamp-style local duplication).
  function partKey(name) {
    var m = String(name || '').match(/^(.*)_part(\d+)of(\d+)(\.[^.]*)?$/i);
    return m ? { base: m[1] + (m[4] || ''), part: +m[2], total: +m[3] } : null;
  }
  function mergeMultipart(parsed) {
    // parsed = [{name,text}]
    var groups = new Map(),
      singles = [];
    parsed.forEach(function (f) {
      var pk = partKey(f.name);
      if (!pk) {
        singles.push(f);
        return;
      }
      if (!groups.has(pk.base)) groups.set(pk.base, []);
      groups.get(pk.base).push(Object.assign({}, f, { _part: pk.part }));
    });
    var merged = [];
    groups.forEach(function (arr, base) {
      arr.sort(function (a, b) {
        return a._part - b._part;
      }); // numeric → part2 before part10
      var text = arr[0].text;
      for (var i = 1; i < arr.length; i++) {
        var lines = arr[i].text.split(/\r?\n/);
        lines.shift(); // drop repeated header
        text += (text.endsWith('\n') ? '' : '\n') + lines.join('\n');
      }
      merged.push({ name: base, text: text, parts: arr.length });
    });
    return singles.concat(merged);
  }
  function parseRRInput(raw) {
    const lines = raw.split(/\r?\n/);
    const nonEmpty = lines.filter((l) => l.trim());
    // Delimited if ≥2 lines carry a ';' or tab AND a clock/ISO timestamp.
    const delimHits = nonEmpty.filter((l) => /[;\t]/.test(l) && /(\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2})/.test(l)).length;
    const vals = [];
    const tsMs = [];
    let t0Ms = null,
      offsetMin = null,
      tsOK = true;
    let prevTMs = null,
      dateAnchorMs = null;
    let sourceFormat = 'rr',
      intervalCol = -1,
      headerLine = null;

    if (delimHits >= 2) {
      const rows = nonEmpty.map((l) => l.split(/[;\t]/));
      // header = first row whose 2nd field isn't numeric (a label row)
      for (const p of rows) {
        if (p.length >= 2 && !isFinite(parseFloat((p[1] || '').replace(',', '.')))) {
          headerLine = p;
          break;
        }
      }
      if (headerLine) {
        intervalCol = _pdIntervalColFromHeader(headerLine);
        if (/pp[\s_\-]*interval|\bppi\b/i.test(headerLine.join(';'))) sourceFormat = 'ppi';
      }
      if (intervalCol < 0) {
        // no usable header → pick by physiological range
        const dataRows = rows.filter((p) => p !== headerLine && p.length >= 2 && isFinite(parseFloat((p[p.length - 1] || '').replace(',', '.'))));
        intervalCol = _pdIntervalColByRange(dataRows, headerLine); // §B1: never pick a [mg]/[dps]/[uV] column
      }

      for (const parts of rows) {
        if (parts === headerLine) continue;
        if (parts.length < 2) continue;
        const col = intervalCol >= 0 && intervalCol < parts.length ? intervalCol : parts.length - 1;
        const v = parseFloat((parts[col] || '').replace(',', '.').trim());
        if (!isFinite(v)) continue; // leftover header / label rows fall out here
        vals.push(v);
        const ts = parts[0].trim();
        const p = parseTimestamp(ts, { dateAnchorMs, prevTMs }); // floating wall-clock
        if (p) {
          tsMs.push(p.tMs);
          prevTMs = p.tMs;
          if (dateAnchorMs == null) {
            const d = new Date(p.tMs);
            dateAnchorMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
          }
          if (t0Ms === null) {
            t0Ms = p.tMs;
            offsetMin = p.offsetMin;
          } // anchor + capture zone (Polar RR is zoned ISO)
        } else {
          tsMs.push(NaN);
          tsOK = false; // missing stamp → NaN, NEVER fabricate now()
        }
      }
    }

    if (!vals.length) {
      // fallback: scrape bare RR numbers (no timestamps)
      const m = raw.match(/-?\d+(\.\d+)?/g);
      if (m) m.forEach((s) => vals.push(Number(s)));
    }
    const tsValid = !!(tsOK && tsMs.length === vals.length && tsMs.length);
    // §3 ingest honesty: a device onboard stream that logged no usable beats
    // (header-only PPI, all-zero HR/PPI) must surface explicitly — never a
    // silently-empty or fabricated analysis. Count physiological RR/PPI intervals.
    let nUsable = 0;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (isFinite(v) && v >= 250 && v <= 3000) nUsable++;
    }

    /* ── §B1 · INTERVAL-LIKENESS: intervals must CONSERVE TIME ────────────────────────────────────
     The range check above asks "is each value the size of a beat?" — which an accelerometer's
     gravity rail (~973 mg) passes trivially. It never asks the question that DEFINES an interval
     series: RR intervals are the gaps BETWEEN beats, so they must sum to the elapsed recording
     time. That is a conservation law, not a heuristic — and unlike a variability floor it cannot
     reject a genuinely flat recording (a sick heart's RR still sums to the elapsed time, which is
     exactly why the "SDNN 9.5 ms is impossible" framing would have been the wrong test: the Verity
     ACC's SDNN is 69.5 ms, sitting comfortably inside the real-RR range).

     Measured on the real corpus: every one of 19 real RR/PPI recordings conserves time to within
     1 % (ratio 1.00–1.01). The H10 accelerometer read as RR claims 24.6× the elapsed time; the
     Verity accelerometer 15.6×. We reject above 2.0 — a 15× margin below the nearest offender, and
     it can only ever fire on the IMPOSSIBLE side: dropped beats and paused recordings make the sum
     SMALLER than the span, never larger, so a gappy-but-genuine file cannot trip it. */
    let timeRatio = null;
    if (tsOK && tsMs.length === vals.length && tsMs.length >= 10) {
      const spanMs = tsMs[tsMs.length - 1] - tsMs[0];
      if (isFinite(spanMs) && spanMs > 0) {
        let sumMs = 0;
        for (let i = 0; i < vals.length; i++) {
          const v = vals[i];
          if (isFinite(v) && v >= 250 && v <= 3000) sumMs += v;
        }
        timeRatio = sumMs / spanMs;
      }
    }
    const timeImplausible = timeRatio != null && timeRatio > PD_MAX_TIME_RATIO;
    if (timeImplausible) nUsable = 0; // not an interval series at all — nothing here is a beat

    const usable = nUsable >= 10;
    let reason = null;
    if (timeImplausible)
      reason =
        'the selected column does not behave like an interval series: its values sum to ' +
        /** @type {number} */ (timeRatio).toFixed(1) +
        "× the recording's elapsed time (intervals must SUM to the time they span). " +
        'This is what a non-beat sensor channel (e.g. an accelerometer axis in mg) looks like when read as RR — set aside, never guessed';
    else if (!vals.length) reason = headerLine || delimHits >= 2 ? 'columns present but no interval rows — the device logged no usable beats' : 'no numeric intervals found in the file';
    else if (nUsable === 0) reason = 'all ' + vals.length + ' values are outside the physiological range (e.g. an all-zero HR/PPI stream) — the device logged no usable beats';
    else if (!usable) reason = 'only ' + nUsable + ' usable interval' + (nUsable === 1 ? '' : 's') + ' found (need ≥10)';
    return {
      vals,
      t0Ms: tsValid ? t0Ms : null,
      offsetMin: tsValid ? offsetMin : null,
      tsMs: tsValid ? tsMs : null,
      sourceFormat,
      intervalCol,
      nRaw: vals.length,
      nUsable: nUsable,
      usable: usable,
      reason: reason,
      timeRatio: timeRatio
    };
  }

  // ─── ARRAY HELPERS (stack-safe on huge 24/7 files; spread overflows ~125k) ───
  function arrMin(a) {
    let m = Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
    return m;
  }
  function arrMax(a) {
    let m = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m;
  }
  function medianOf(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y),
      n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // ─── ARTIFACT CORRECTION ─────────────────────────────────────────────────────
  // Flag beats outside physiology (300–2200ms) or deviating >20% from a local
  // 11-beat median; replace with that median so timing stays aligned for windowing.
  function artifactClean(vals) {
    const n = vals.length,
      out = vals.slice(),
      flags = new Uint8Array(n),
      W = 5;
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - W),
        hi = Math.min(n, i + W + 1),
        seg = [];
      for (let j = lo; j < hi; j++) if (j !== i) seg.push(vals[j]);
      seg.sort((x, y) => x - y);
      const med = seg[seg.length >> 1] || vals[i];
      const dev = med ? Math.abs(vals[i] - med) / med : 0;
      if (vals[i] < 300 || vals[i] > 2200 || dev > 0.2) {
        flags[i] = 1;
        out[i] = med;
      }
    }
    let nArt = 0;
    for (let i = 0; i < n; i++) nArt += flags[i];
    return { clean: out, flags, nArt, pct: +((nArt / n) * 100).toFixed(2) };
  }

  // Beat times (seconds): real wall-clock if present, else cumulative RR.
  function beatTimes(a, tsEpoch) {
    const t = new Array(a.length);
    if (tsEpoch && tsEpoch.length === a.length && isFinite(tsEpoch[0])) {
      const t0 = tsEpoch[0];
      for (let i = 0; i < a.length; i++) t[i] = (tsEpoch[i] - t0) / 1000;
    } else {
      let acc = 0;
      for (let i = 0; i < a.length; i++) {
        t[i] = acc / 1000;
        acc += a[i];
      }
    }
    return t;
  }

  // ─── RECORDING-TYPE CLASSIFIER (feature-based, overridable) ──────────────────
  const MODE_LABEL = { morning: '🌅 Morning spot', exercise: '🏃 Exercise', overnight: '🌙 Overnight', continuous: '🕓 24/7 Continuous', spot: '⏱ Spot reading' };
  function classifyRecording(a, t0Ms, durSec) {
    const n = a.length,
      hr = 60000 / mean(a),
      durMin = durSec / 60;
    const hour = t0Ms != null && isFinite(t0Ms) ? new Date(t0Ms).getUTCHours() : null;
    const k = Math.max(1, Math.floor(n * 0.2));
    const rising = 60000 / mean(a.slice(-k)) - 60000 / mean(a.slice(0, k)); // HR drift last-fifth vs first-fifth
    let mode, conf, why;
    if (durMin >= 20 * 60) {
      mode = 'continuous';
      conf = 0.95;
      why = (durMin / 60).toFixed(1) + ' h continuous record';
    } else if (durMin >= 90) {
      mode = 'overnight';
      conf = 0.9;
      why = (durMin / 60).toFixed(1) + ' h' + (hour != null ? ' from ' + String(hour).padStart(2, '0') + ':00' : '');
    } else if (hr >= 100 || rising > 15) {
      mode = 'exercise';
      conf = 0.75;
      why = 'mean HR ' + hr.toFixed(0) + ' bpm' + (rising > 15 ? ', HR rising ' + rising.toFixed(0) : '');
    } else if (durMin <= 8 && (hour == null || hour < 11)) {
      mode = 'morning';
      conf = 0.7;
      why = durMin.toFixed(1) + ' min' + (hour != null ? ' at ' + String(hour).padStart(2, '0') + ':00' : '') + ' spot';
    } else {
      mode = 'spot';
      conf = 0.6;
      why = durMin.toFixed(1) + ' min reading';
    }
    return { mode, conf, why, durMin: +durMin.toFixed(1), hour, rising: +rising.toFixed(1) };
  }

  // ─── WINDOWED ANALYSIS (overnight / long recordings) ─────────────────────────
  // 5-min time windows → per-window short-term metrics. Aggregate with median+IQR.
  function windowAnalysis(a, t, winSec) {
    const N = a.length;
    let i = 0;
    const tEnd = t[N - 1];
    const wins = [],
      segs = [];
    for (let w0 = 0; w0 <= tEnd; w0 += winSec) {
      const w1 = w0 + winSec,
        seg = [];
      while (i < N && t[i] < w1) {
        seg.push(a[i]);
        i++;
      }
      if (seg.length >= 20) {
        // need enough beats for a valid window
        const m = mean(seg);
        wins.push({ tMin: +(w0 / 60).toFixed(1), hr: +(60000 / m).toFixed(1), rmssd: +rmssd(seg).toFixed(1), sdnn: +std(seg).toFixed(1), pnn: +pnn50(seg).toFixed(1), meanRR: +m.toFixed(1) });
        segs.push(seg);
      }
    }
    return { wins, segs };
  }

  // ─── SIMPLE SVG LINE CHART (no external libs, x in minutes) ──────────────────
  function lineChartSVG(pts, color, medVal) {
    const W = 680,
      H = 150,
      P = { l: 46, r: 14, t: 14, b: 26 },
      n = pts.length;
    if (!n) return '';
    let ymn = Infinity,
      ymx = -Infinity,
      xmn = Infinity,
      xmx = -Infinity;
    for (const p of pts) {
      if (p.y < ymn) ymn = p.y;
      if (p.y > ymx) ymx = p.y;
      if (p.x < xmn) xmn = p.x;
      if (p.x > xmx) xmx = p.x;
    }
    if (ymx === ymn) ymx = ymn + 1;
    if (xmx === xmn) xmx = xmn + 1;
    const sx = (x) => P.l + ((x - xmn) / (xmx - xmn)) * (W - P.l - P.r);
    const sy = (y) => H - P.b - ((y - ymn) / (ymx - ymn)) * (H - P.t - P.b);
    const line = pts.map((p, k) => (k ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1)).join(' ');
    const my = sy(medVal).toFixed(1);
    const xt = [];
    for (let h = Math.ceil(xmn / 60) * 60; h <= xmx; h += 60) xt.push(h);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="rgba(255,255,255,.12)"/>
    <line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="rgba(255,255,255,.12)"/>
    <line x1="${P.l}" y1="${my}" x2="${W - P.r}" y2="${my}" stroke="${color}" stroke-dasharray="4 4" opacity=".55"/>
    <text x="${P.l - 6}" y="${(sy(ymx) + 4).toFixed(1)}" fill="#6F8096" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${ymx.toFixed(0)}</text>
    <text x="${P.l - 6}" y="${(sy(ymn) + 4).toFixed(1)}" fill="#6F8096" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">${ymn.toFixed(0)}</text>
    ${xt.map((h) => `<text x="${sx(h).toFixed(1)}" y="${H - 8}" fill="#6F8096" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">${(h / 60).toFixed(0)}h</text>`).join('')}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CROSS-SIGNAL COMPARISON  (PPI ↔ RR · PRV ↔ HRV)
  //  Two interval series for the SAME recording (e.g. ECG-RR + PPG-PPI). Beat-match
  //  on floating wall-clock tMs (Clock Contract — both nodes emit the same tMs for
  //  the same wall minute), fall back to index alignment when stamps are absent.
  //  Returns: per-series HRV, beat-level agreement (Bland–Altman), Pearson r, and
  //  the PRV↔HRV discrepancy → pulse-transit-time-variability surrogate.
  // ═══════════════════════════════════════════════════════════════════════════
  function _pdPearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 3) return null;
    let sx = 0,
      sy = 0;
    for (let i = 0; i < n; i++) {
      sx += x[i];
      sy += y[i];
    }
    const mx = sx / n,
      my = sy / n;
    let sxy = 0,
      sxx = 0,
      syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx,
        dy = y[i] - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    const d = Math.sqrt(sxx * syy);
    return d > 0 ? +(sxy / d).toFixed(3) : null;
  }
  function _pdSeriesStats(a) {
    if (!a || a.length < 3) return null;
    const m = mean(a);
    return { n: a.length, meanRR: +m.toFixed(1), hr: +(60000 / m).toFixed(1), sdnn: +std(a).toFixed(1), rmssd: +rmssd(a).toFixed(1), pnn50: +pnn50(a).toFixed(1) };
  }
  // each side: { vals, tsMs|null, t0Ms|null, label, kind('ppi'|'rr'|'auto') }
  function compareIntervalSeries(primary, reference) {
    if (!primary || !reference || !primary.vals || !reference.vals) return null;
    const A = artifactClean(primary.vals).clean;
    const B = artifactClean(reference.vals).clean;
    if (A.length < 5 || B.length < 5) return { error: 'Need ≥5 intervals in each signal to compare.' };

    // beat-end timestamps (ms). Prefer absolute floating tMs; else cumulative.
    const endTs = (vals, tsMs) => {
      if (tsMs && tsMs.length === vals.length && isFinite(tsMs[0])) return tsMs.slice();
      const t = new Array(vals.length);
      let acc = 0;
      for (let i = 0; i < vals.length; i++) {
        acc += vals[i];
        t[i] = acc;
      }
      return t;
    };
    const haveAbs = !!(primary.tsMs && reference.tsMs && isFinite(primary.tsMs[0]) && isFinite(reference.tsMs[0]));
    const ta = endTs(A, primary.tsMs),
      tb = endTs(B, reference.tsMs);

    const matchA = [],
      matchB = [],
      diffs = [];
    if (haveAbs) {
      // nearest-beat match on the shared wall-clock (two-pointer), tolerance ≈ ⅓ beat
      let j = 0;
      for (let i = 0; i < B.length; i++) {
        while (j + 1 < A.length && Math.abs(ta[j + 1] - tb[i]) <= Math.abs(ta[j] - tb[i])) j++;
        const dt = Math.abs(ta[j] - tb[i]);
        const tol = Math.max(120, 0.3 * Math.min(A[j], B[i]));
        if (dt <= tol) {
          matchA.push(A[j]);
          matchB.push(B[i]);
          diffs.push(B[i] - A[j]);
        }
      }
    } else {
      // no shared clock → assume 1:1 beat correspondence (both are the same recording)
      const m = Math.min(A.length, B.length);
      for (let i = 0; i < m; i++) {
        matchA.push(A[i]);
        matchB.push(B[i]);
        diffs.push(B[i] - A[i]);
      }
    }
    const nM = diffs.length;
    const statsA = _pdSeriesStats(A),
      statsB = _pdSeriesStats(B);
    const mAll = Math.min(A.length, B.length);
    if (nM < 5) {
      return { matched: nM, matchRatePct: +((nM / mAll) * 100).toFixed(0), statsA, statsB, haveAbs, weak: true, note: 'Too few beats line up — different recordings, or no shared clock.' };
    }

    // ── beat-level agreement (Bland–Altman) ──
    const bias = mean(diffs),
      sdDiff = std(diffs);
    const mad = mean(diffs.map((d) => Math.abs(d)));
    const within25 = (diffs.filter((d) => Math.abs(d) <= 25).length / nM) * 100;
    const r = _pdPearson(matchA, matchB);
    const mp = mean(matchA);
    // ── PRV↔HRV discrepancy (computed on the matched, paired series so it's fair) ──
    const rmA = rmssd(matchA),
      rmB = rmssd(matchB),
      sdA = std(matchA),
      sdB = std(matchB);
    const dRMSSD = +(rmB - rmA).toFixed(1),
      dSDNN = +(sdB - sdA).toFixed(1);
    const rmssdRatio = rmA > 0 ? +(rmB / rmA).toFixed(2) : null;
    // pulse-transit-time variability surrogate: variance PRV adds over HRV.
    // PRV² ≈ HRV² + PTTV²  →  PTTV ≈ √(rmssd_PRV² − rmssd_HRV²).  (vascular/BP jitter)
    const pttv = rmB > rmA ? +Math.sqrt(Math.max(0, rmB * rmB - rmA * rmA)).toFixed(1) : 0;

    // decide which side is the pulse (PRV) signal for framing
    const kA = primary.kind || 'auto',
      kB = reference.kind || 'auto';
    const refIsPulse = kB === 'ppi' || (kB === 'auto' && kA === 'rr');
    const agreeGrade = mad <= 10 && Math.abs(bias) <= 15 ? 'ok' : mad <= 20 ? 'warn' : 'bad';

    // thin the diffs for a Bland–Altman scatter (renderer draws it)
    const step = Math.max(1, Math.floor(nM / 400));
    const ba = [];
    for (let i = 0; i < nM; i++) {
      if (i % step === 0) ba.push([+((matchA[i] + matchB[i]) / 2).toFixed(0), +diffs[i].toFixed(1)]);
    }

    return {
      matched: nM,
      matchRatePct: +((nM / mAll) * 100).toFixed(0),
      haveAbs,
      primaryLabel: primary.label || 'Signal A',
      referenceLabel: reference.label || 'Signal B',
      refIsPulse,
      statsA,
      statsB,
      agreement: {
        biasMs: +bias.toFixed(1),
        sdDiffMs: +sdDiff.toFixed(1),
        loaLoMs: +(bias - 1.96 * sdDiff).toFixed(1),
        loaHiMs: +(bias + 1.96 * sdDiff).toFixed(1),
        madMs: +mad.toFixed(1),
        within25Pct: +within25.toFixed(0),
        pearsonR: r,
        grade: agreeGrade
      },
      discrepancy: {
        dRMSSD,
        dSDNN,
        rmssdRatio,
        pttvMs: pttv,
        meanPairMs: +mp.toFixed(0),
        note: refIsPulse
          ? 'Reference is a pulse signal (PRV). PRV usually carries a touch more variance than ECG-HRV; the excess ≈ pulse-transit-time variability — a vascular / blood-pressure-variability surrogate.'
          : 'Both treated as beat intervals; excess variance shown as a transit-time surrogate where the pulse signal exceeds the electrical one.'
      },
      blandAltman: ba
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HEADLESS PUBLIC COMPUTE SURFACE  ·  PulseDex.compute (Phase 9)
  //  ────────────────────────────────────────────────────────────────────────
  //  The migration the parent brief (SIGNAL-ADAPTER-AND-FRONTIER Phase 9) and the
  //  follow-ups (§1/§2/§9a) call for: split READING from COMPUTING and expose a
  //  public, DOM-FREE entry — PulseDex.compute(SignalFrame(rr) | vals[]) →
  //  ganglior.node-export. The Data Unifier and OverDex call THIS through the
  //  shared signal-orchestrate.js chokepoint instead of reaching into private
  //  underscore globals (_pdSeriesStats …), and the app's own exportGanglior uses
  //  the SAME builder so there is ONE windowing/export implementation, not three.
  //
  //  PURITY (Phase 4b positive control): this block references NO document /
  //  window / localStorage. Provenance, kernel and ingest are passed in via opts
  //  by the caller (the app passes window.GangliorProvenance/DexKernel; the
  //  orchestrator passes the isolated host's DexKernel + the adapter ingest).
  // ═══════════════════════════════════════════════════════════════════════════
  function _pdClockS(ms) {
    const d = new Date(ms),
      p = (n) => (n < 10 ? '0' : '') + n;
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  // SignalFrame(rr) | {vals,…} | vals[] → { vals, tsMs, t0Ms, offsetMin }
  function _pdNormalizeRRInput(input) {
    if (Array.isArray(input)) return { vals: input.slice(), tsMs: null, t0Ms: null, offsetMin: null };
    if (input && typeof input === 'object') {
      const vals = input.intervals || input.vals || null;
      if (vals)
        return {
          vals: vals.slice(),
          tsMs: input.tsMs && input.tsMs.length ? input.tsMs.slice() : null,
          t0Ms: input.t0Ms != null ? input.t0Ms : null,
          offsetMin: input.offsetMin != null ? input.offsetMin : null
        };
    }
    return { vals: null, tsMs: null, t0Ms: null, offsetMin: null };
  }

  // Pure reproduction of the EXPORT-relevant subset of calculate(): artifact-clean
  // → timing/coverage → classify → whole-record + windowed HRV → spectrum →
  // composites. Returns a lastResult-shaped object (the fields pdBuildNodeExport
  // reads), or null if there aren't ≥10 usable beats. No DOM, no profile/VO₂.
  function pdComputeResult(input) {
    const f = _pdNormalizeRRInput(input);
    if (!f.vals || f.vals.length < 10) return null;
    const cleanR = artifactClean(f.vals);
    const a = cleanR.clean,
      N = a.length;
    if (N < 10) return null;

    const times = beatTimes(a, f.tsMs);
    const durSec = times[N - 1] || (N * mean(a)) / 1000;
    let coverage = 100;
    if (f.tsMs && isFinite(f.tsMs[0]) && isFinite(f.tsMs[N - 1])) {
      const wall = (f.tsMs[N - 1] - f.tsMs[0]) / 1000;
      let rrSum = 0;
      for (let i = 0; i < N; i++) rrSum += a[i] / 1000;
      coverage = wall > 0 ? +Math.min(100, (rrSum / wall) * 100).toFixed(1) : 100;
    }

    const cls = classifyRecording(a, f.t0Ms, durSec);
    const mode = cls.mode;
    const longRec = mode === 'overnight' || mode === 'continuous';

    const meanRR = mean(a),
      sdnn = std(a),
      rm = rmssd(a),
      pn = pnn50(a);
    const hr = +(60000 / meanRR).toFixed(1);

    let win = null,
      dispRm = rm,
      dispSd = sdnn,
      _dispHr = hr,
      dispPn = pn,
      dispMeanRR = meanRR,
      repSeg = a,
      winSpec = null;
    if (longRec) {
      win = windowAnalysis(a, times, 300);
      if (win.wins.length >= 3) {
        const rmA = win.wins.map((w) => w.rmssd),
          sdA = win.wins.map((w) => w.sdnn),
          hrA = win.wins.map((w) => w.hr),
          pnA = win.wins.map((w) => w.pnn),
          rrA = win.wins.map((w) => w.meanRR);
        dispRm = +medianOf(rmA).toFixed(2);
        dispSd = +medianOf(sdA).toFixed(2);
        _dispHr = +medianOf(hrA).toFixed(1);
        dispPn = +medianOf(pnA).toFixed(1);
        dispMeanRR = +medianOf(rrA).toFixed(1);
        let bi = 0,
          bd = Infinity;
        for (let i = 0; i < rmA.length; i++) {
          const d = Math.abs(rmA[i] - dispRm);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        repSeg = win.segs[bi];
        const sh = [],
          sl = [],
          sv = [],
          srr = [];
        for (const seg of win.segs) {
          const w = lombScargle(seg, 256);
          sh.push(w.hf);
          sl.push(w.lf);
          sv.push(w.vlf);
          if (w.respRate > 0) srr.push(w.respRate);
        }
        // DEEP-AUDIT-2026-07-14 §3: define tp as the band SUM, not a 4th independent median — the
        // Task-Force identity vlf+lf+hf==totalPower must hold EXACTLY (median(tp_i) ≠ Σ median(band_i)),
        // mirroring ECGDex:601 / PpgDex. Otherwise Total Power + the HF/LF fraction bars (hf/(tp||1))
        // surface numbers that don't reconcile with the bands beside them (~5–20 % on overnight). The
        // per-segment tp (w.tp) is therefore no longer collected — it never survived the median anyway.
        const _wh = Math.round(medianOf(sh)),
          _wl = Math.round(medianOf(sl)),
          _wv = Math.round(medianOf(sv));
        winSpec = { hf: _wh, lf: _wl, vlf: _wv, tp: _wv + _wl + _wh, respRate: srr.length ? +medianOf(srr).toFixed(1) : 0 };
      }
    }

    const ls = lombScargle(longRec ? repSeg : a);
    const sp = winSpec ? { tp: winSpec.tp, hf: winSpec.hf, lf: winSpec.lf, vlf: winSpec.vlf } : { tp: ls.tp, hf: ls.hf, lf: ls.lf, vlf: ls.vlf };
    const ans = ansBalance(sp.hf, sp.lf);

    const _cMeanRR = longRec ? dispMeanRR : meanRR;
    const cSd = longRec ? dispSd : sdnn,
      cRm = longRec ? dispRm : rm,
      cPn = longRec ? dispPn : pn;
    const stress = stressEst(cSd, cRm),
      hrv = hrvEst(cSd, cRm, cPn),
      energy = energyEst(cSd, cRm),
      focus = focusEst(cSd, cRm),
      coh = cohEst(cRm, cSd);
    const sdsdv = sdsd(a); // §8: SD1/SD2 spread is SDSD (÷N−1), not rMSSD — unified with ECGDex/PpgDex
    const sd1v = +sd1(sdsdv).toFixed(2),
      sd2v = +sd2(sdnn, sdsdv).toFixed(2);
    const lnrm = +lnR(cRm).toFixed(3);
    const lfhfv = winSpec ? +(winSpec.lf / (winSpec.hf || 1)).toFixed(3) : ls.lfhf;

    // EXPORT-IDENTITY §2.1 / -FOLLOWUPS §1: deterministic, identity-free recording handle.
    // If the input was already a SignalFrame the adapter stamped its contentId (toSignalFrame);
    // otherwise (app/headless {intervals,…} path) compute it from the SAME normalized RAW
    // intervals + t0Ms the frame carries, via the CORE SignalFrame.computeContentId
    // (signal-frame.js is bundled into PulseDex for this) — both paths yield the SAME id.
    const _cid =
      input && typeof input === 'object' && typeof input.contentId === 'string'
        ? input.contentId
        : typeof SignalFrame !== 'undefined' && SignalFrame && SignalFrame.computeContentId
          ? SignalFrame.computeContentId({ signalType: 'rr', kind: 'intervals', intervals: f.vals, t0Ms: f.t0Ms, usable: true })
          : null;

    return {
      t0Ms: f.t0Ms,
      offsetMin: f.offsetMin,
      contentId: _cid,
      mode,
      modeLabel: MODE_LABEL[mode] || mode,
      longRec,
      durMin: +(durSec / 60).toFixed(1),
      coverage,
      N,
      windows: win ? win.wins : null,
      meanRR: +meanRR.toFixed(1),
      hr,
      sdnn: +sdnn.toFixed(2),
      rmssd: +rm.toFixed(2),
      pnn50: +pn.toFixed(1),
      tp: sp.tp,
      hf: sp.hf,
      lf: sp.lf,
      vlf: sp.vlf,
      stress,
      hrv,
      energy,
      focus,
      coherence: coh,
      sns: ans.sns,
      psns: ans.psns,
      snsBal: ans.snsBal,
      psnsBal: ans.psnsBal,
      sd1: sd1v,
      sd2: sd2v,
      lnrmssd: lnrm,
      lfhf: lfhfv
    };
  }

  // Windowed vagal-withdrawal + sympathetic-stress events from a result object.
  // Lifted verbatim from pulsedex-app.js exportGanglior so the app, the unifier and
  // OverDex emit a byte-identical event set (relative+absolute hrv_drop floor,
  // stress_peak windows, and the short-reading single-event branch — §2 parity).
  function pdEventsFromResult(r) {
    const t0 = r.t0Ms,
      ev = [];
    if (t0 != null) {
      const wins = (r.windows || []).filter((w) => isFinite(w.rmssd) && isFinite(w.tMin));
      if (wins.length) {
        const rms = wins.map((w) => w.rmssd).sort((a, b) => a - b),
          med = rms[Math.floor(rms.length / 2)] || 1;
        wins.forEach((w) => {
          const tMs = t0 + w.tMin * 60000,
            st = stressEst(w.sdnn, w.rmssd);
          if (w.rmssd < 0.7 * med && w.rmssd < 25)
            ev.push({
              tMs,
              t: _pdClockS(tMs),
              impulse: 'hrv_drop',
              node: 'PulseDex',
              conf: +Math.max(0.4, Math.min(0.92, (0.7 * med - w.rmssd) / (0.7 * med))).toFixed(2),
              meta: { rmssd: w.rmssd, medianRMSSD: +med.toFixed(1), hr: w.hr, position: null }
            });
          if (st >= 70)
            ev.push({
              tMs,
              t: _pdClockS(tMs),
              impulse: 'stress_peak',
              node: 'PulseDex',
              conf: +Math.max(0.4, Math.min(0.92, (st - 50) / 50)).toFixed(2),
              meta: { stress: st, rmssd: w.rmssd, sdnn: w.sdnn, position: null }
            });
        });
      } else if (r.rmssd != null) {
        if (r.stress >= 70)
          ev.push({
            tMs: t0,
            t: _pdClockS(t0),
            impulse: 'stress_peak',
            node: 'PulseDex',
            conf: +Math.max(0.4, Math.min(0.92, (r.stress - 50) / 50)).toFixed(2),
            meta: { stress: r.stress, rmssd: r.rmssd, position: null }
          });
        else if (r.rmssd < 20) ev.push({ tMs: t0, t: _pdClockS(t0), impulse: 'hrv_drop', node: 'PulseDex', conf: 0.55, meta: { rmssd: r.rmssd, sdnn: r.sdnn, position: null } });
      }
    }
    ev.sort((a, b) => a.tMs - b.tMs);
    return ev;
  }

  // Result object → schema-valid ganglior.node-export. Field ORDER matches the
  // app's historical exportGanglior byte-for-byte (so export-completeness tests +
  // regenerated fixtures stay stable); opts carries the side-effect-free context.
  //   opts.provenance — GangliorProvenance.stamp() | null   (key always present)
  //   opts.kernel     — { VERSION, HASH } | null
  //   opts.ingest     — { adapter, vendor, device, via }    (added only when given)
  //   opts.generated  — ISO string (defaults to now at call time)
  function pdBuildNodeExport(r, opts) {
    opts = opts || {};
    const ev = pdEventsFromResult(r);
    const schema = {
      name: 'ganglior.node-export',
      version: '2.0',
      node: 'PulseDex',
      nodeVersion: '1.0',
      bus: 'ganglior',
      generated: opts.generated || new Date().toISOString(),
      provenance: opts.provenance !== undefined ? opts.provenance : null,
      doc: 'PulseDex windowed HRV → Ganglior events. tMs = floating wall-clock ms (UTC getters). null = unknown, never fabricated.'
    };
    if (opts.ingest) schema.ingest = opts.ingest; // adapter provenance (unifier/OverDex path)
    return {
      kernel: opts.kernel ? { version: opts.kernel.VERSION, hash: opts.kernel.HASH } : null,
      schema,
      recording: {
        source: 'rr',
        contentId: r.contentId ?? null,
        startEpochMs: r.t0Ms ?? null,
        offsetMin: r.offsetMin ?? null,
        durationMin: r.durMin,
        mode: r.mode,
        modeLabel: r.modeLabel,
        longRecording: r.longRec,
        windows: r.windows ? r.windows.length : 0,
        beats: r.N,
        coveragePct: r.coverage
      },
      hrv: {
        time: { rmssd: r.rmssd, sdnn: r.sdnn, pnn50: r.pnn50, hr: r.hr, meanRR: r.meanRR, lnRMSSD: r.lnrmssd },
        frequency: { lf: r.lf, hf: r.hf, vlf: r.vlf, lfhf: r.lfhf },
        poincare: { sd1: r.sd1, sd2: r.sd2 }
      },
      summary: { stress: r.stress, hrvScore: r.hrv, energy: r.energy, focus: r.focus, snsBal: r.snsBal, psnsBal: r.psnsBal },
      ganglior_events: ev,
      reserved: { doc: 'Awaiting other fleet nodes; null until available.', glucoseCorrelation: null, glucoseSource: 'GlucoDex' }
    };
  }

  // ═════════════════════════════════════════════════════════════════════════════════════
  //  SELF-INGEST — reload PulseDex's OWN ganglior.node-export as a review-mode
  //  clinical VIEW (SELF-INGEST-FOLLOWUPS-2026-07-03 · PulseDex pass). PURE +
  //  DOM-FREE: detect → guard-own-kind → unwrap → mark reviewMode → return the
  //  provenance / kernel / events VERBATIM. NEVER recomputes and NEVER calls
  //  GangliorProvenance.stamp() — a reload is a VIEW of a past computation, stamped
  //  with the build that MADE it, not a fresh one (SELF-INGEST §3). The PulseDex
  //  export is single-record and RICH (recording + hrv.{time,frequency,poincare} +
  //  summary), so the review view reads the STORED derived layer directly — no
  //  re-derive; an optional recordings[] wrapper is honored for a multi carrier.
  // ═════════════════════════════════════════════════════════════════════════════════════
  function pulseLoadOwnExport(json) {
    // 1 · detect
    if (!(json && json.schema && json.schema.name === 'ganglior.node-export'))
      return { ok: false, reason: 'not-node-export', message: 'Not a node-export \u2014 drop a raw RR/IBI file, or PulseDex\u2019s own .json export.' };
    // 2 · guard own kind — a foreign export is REJECTED with a redirect message, never coerced.
    var node = ((json.schema.node || '') + '').trim();
    if (node !== 'PulseDex')
      return {
        ok: false,
        reason: 'foreign-node',
        node: node,
        message: 'This is a ' + (node || 'non-PulseDex') + ' export \u2014 open it in ' + (node || 'its own node') + ', or drop it into the Integrator to fuse.'
      };
    // 3 · unwrap — a single-record export IS the element; an optional recordings[] wraps many.
    var carrier = Array.isArray(json.recordings) ? json.recordings : [json];
    var elements = carrier.map(function (el) {
      var e = JSON.parse(JSON.stringify(el)); // deep clone — never mutate the caller
      e._fromExport = true;
      e._reviewMode = true; // 4 · review-mode flags (renderer greys raw panels)
      return e;
    });
    // gather events: top-level (single-record) else each element's, tMs-sorted (Clock Contract).
    var evAll = Array.isArray(json.ganglior_events) ? json.ganglior_events.slice() : [];
    if (!evAll.length)
      carrier.forEach(function (el) {
        if (Array.isArray(el.ganglior_events)) evAll = evAll.concat(el.ganglior_events);
      });
    evAll.sort(function (a, b) {
      return ((a && a.tMs) || 0) - ((b && b.tMs) || 0);
    });
    // 5 · preserve provenance / kernel / derived layer VERBATIM — the view's provenance IS the export's.
    return {
      ok: true,
      reviewMode: true,
      node: node,
      elements: elements,
      events: evAll,
      provenance: (json.schema && json.schema.provenance) || null,
      generated: (json.schema && json.schema.generated) || null,
      derivedFrom: (json.schema && json.schema.derivedFrom) || null,
      kernel: json.kernel || null,
      recording: json.recording || null,
      hrv: json.hrv || null,
      summary: json.summary || null,
      scrubbed: !!(json.schema && json.schema.scrubbed),
      multiNight: elements.length > 1,
      raw: json
    };
  }

  // Public namespace — the headless surface the orchestrator + app both call.
  var PulseDex = typeof PulseDex !== 'undefined' && PulseDex ? PulseDex : {};
  PulseDex.compute = function (input, opts) {
    const r = pdComputeResult(input);
    if (!r) return null;
    opts = opts || {};
    return pdBuildNodeExport(r, { provenance: opts.provenance !== undefined ? opts.provenance : null, kernel: opts.kernel || null, ingest: opts.ingest || undefined, generated: opts.generated });
  };
  PulseDex.computeResult = pdComputeResult;
  PulseDex.buildNodeExport = pdBuildNodeExport;
  PulseDex.eventsFromResult = pdEventsFromResult;
  PulseDex.loadOwnExport = pulseLoadOwnExport; // SELF-INGEST reload (review-mode clinical view)
  // scrub-for-sharing → the SHARED dexScrubExport (D1); lazy delegate so co-load order is irrelevant.
  PulseDex.scrubExport = function (env) {
    if (typeof DexExport !== 'undefined' && DexExport && typeof DexExport.scrubExport === 'function') return DexExport.scrubExport(env);
    if (typeof dexScrubExport === 'function') return dexScrubExport(env);
    return env;
  };
  // Pure RR parser exposed on the namespace so the co-load host (signal-orchestrate §3)
  // can hand it to the polar/coospo/wahoo RR adapters via ctx.parseRRInput WITHOUT a
  // bare global — in the namespaced realm `parseRRInput` no longer sprays onto window.
  PulseDex.parseRRInput = parseRRInput;

  // ── public namespace (always) ──
  root.PulseDex = PulseDex;

  // ── app back-compat: re-export the bare DSP globals UNLESS co-loaded namespaced ──
  if (!root.__DEX_NAMESPACED__) {
    Object.assign(root, {
      tzOffset,
      _ckP2,
      _ckNumEpoch,
      _ckZoneMin,
      _ckDMY,
      parseTimestamp,
      fmtClock,
      fmtDate,
      fmtDateTime,
      mean,
      std,
      rmssd,
      pnn50,
      nn50c,
      minmax,
      mxdmn,
      quant,
      modeV,
      amo50,
      sd1,
      sd2,
      lnR,
      lfHf,
      nu,
      ansBalance,
      stressEst,
      hrvEst,
      energyEst,
      focusEst,
      cohEst,
      vo2Base,
      vo2Adj,
      altVO2Factor,
      periodicBreathingIndex,
      siCalc,
      efcIdx,
      crsIdx,
      absIdx,
      linfit,
      dfaAlpha1,
      sampEn,
      fragmentation,
      prsaCapacity,
      triangularIndex,
      lombScargle,
      _pdIntervalColFromHeader,
      _pdIntervalColByRange,
      partKey,
      mergeMultipart,
      parseRRInput,
      arrMin,
      arrMax,
      medianOf,
      artifactClean,
      beatTimes,
      MODE_LABEL,
      classifyRecording,
      windowAnalysis,
      lineChartSVG,
      _pdPearson,
      _pdSeriesStats,
      compareIntervalSeries,
      _pdClockS,
      _pdNormalizeRRInput,
      pdComputeResult,
      pdEventsFromResult,
      pdBuildNodeExport,
      pulseLoadOwnExport
    });
    // mutable cross-file state — proxy bare `lastResult` to the in-closure binding
    Object.defineProperty(root, 'lastResult', {
      configurable: true,
      get: function () {
        return lastResult;
      },
      set: function (v) {
        lastResult = v;
      }
    });
  }
})(/** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));

// ESM-MIGRATION (deep-3 fan-out): dsp is now a DUAL-MODE module. The IIFE above still attaches
// window.PulseDex (the external node API + every classic co-load consumer — the orchestrators and
// both test runners, which classic-load this file via tools/build-core.js `classicify`) and, when
// not namespaced, the bare-global back-compat spray for the classic UI. This re-export lets the
// owned ESM bundle's pulsedex-app.js `import { PulseDex }` instead of reading window.
export const PulseDex = window.PulseDex;
