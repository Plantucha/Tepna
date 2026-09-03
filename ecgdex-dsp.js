/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   ECGDex · DSP ENGINE  (ecgdex-dsp.js)
   ────────────────────────────────────────────────────────────────────────
   One signal in: raw ECG (µV @ 130 Hz). Everything is computed from it.
     · synthetic overnight ECG generator (demo, with ground-truth RR)
     · 5–15 Hz band-pass → Pan-Tompkins R-peak detection
     · sub-sample R-peak refinement (parabolic vertex on band-passed signal)
     · per-beat SQI gate (flatline · kurtosis · two-detector agreement · RR plausibility)
     · NN interpolation, % analyzable night, correction rate
     · full HRV suite (time · Poincaré · Lomb–Scargle freq · DFA · SampEn · fragmentation)
     · 5-min epoch engine + aggregation
     · CVHR (cyclic variation of HR — apnea autonomic signature)
     · EDR (ECG-derived respiration) via R-peak amplitude modulation
     · cardiorespiratory sleep staging (HRV + EDR)
     · Ganglior event emission (conf = SQI)
   No external libraries. Exposes a single global: window.ECGDSP
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // ─── tiny math ───────────────────────────────────────────────────────────────
  const mean = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  };
  const std = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }; // sample SD (÷N−1) — HRV Task Force / Kubios convention, unified fleet-wide 2026-06-24
  const rmssd = (a) => {
    let s = 0,
      n = 0;
    for (let i = 1; i < a.length; i++) {
      const d = a[i] - a[i - 1];
      s += d * d;
      n++;
    }
    return n ? Math.sqrt(s / n) : 0;
  };

  /* ════ CANONICAL CLOCK · CLOCK-UNIFY (duplicated locally per app — Clock Contract §2) ═══════════
   tMs = floating wall-clock ms: the recording's LOCAL civil time encoded as if it were UTC.
   ALWAYS read back via getUTC* getters. Viewer-timezone-independent.
   parseTimestamp(raw,opts) → { tMs, offsetMin } | null. Mirrors the other nodes byte-for-byte so
   ECGDex's stamp handling cannot silently diverge (WP-G truth table). ECGDex's hot ingest path
   (Polar Sensor Logger `timestamp [ms]` epoch column) uses the inline parseTSfloat fast-path, but
   this full mirror is the contract-faithful reference + the public ECGDSP.parseTimestamp export. */
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
  const pnn50 = (a) => {
    let n = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - a[i - 1]) > 50) n++;
    return a.length > 1 ? (n / (a.length - 1)) * 100 : 0;
  };
  const nn50c = (a) => {
    let n = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - a[i - 1]) > 50) n++;
    return n;
  };
  const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y),
      n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const quant = (a, q) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y),
      i = (s.length - 1) * q,
      l = Math.floor(i),
      h = Math.ceil(i);
    return s[l] + (s[h] - s[l]) * (i - l);
  };
  const arrMin = (a) => {
    let m = Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
    return m;
  };
  const arrMax = (a) => {
    let m = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m;
  };
  /* DELETED 2026-08-03 (REGEN-CORPUS-PATH-FOLLOWUPS §4, decided option (a)): local `modeV` (5-ms bins)
     and `amo50` (±25-ms window) used to sit here, dead — no call sites — immediately above the
     `baevskyGeom` (50-ms bins) the exports actually use. FOLLOWUP-FINDINGS P4 left them in place with a
     warning, but a warning does not stop the move it warns about: the obvious thing for a future author
     needing Mode/AMo50 is to reach for the identifiers already named that, and get a DIFFERENT number
     under the same export key — invisible, where P4's original defect was merely null. `baevskyGeom`
     below is THE single source for Mode/AMo50/MxDMn; there is deliberately no second one. The
     `no second Mode/AMo50 implementation` leg in tests/dex-tests.js keeps it that way. */
  // Baevsky geometric inputs (Mode, AMo50, MxDMn) from the NN series — 50-ms bins.
  // THE single source of truth for these three numbers (FOLLOWUP-FINDINGS P4). ECGDex has two
  // node-export builders — `ecgdex-app.js buildV2` (the app's ⬇ Export) and `ecgBuildNodeExport`
  // below (the ORCHESTRATE path, i.e. Data Unifier / OverDex) — and P4's fix originally landed in
  // the app one only. The same recording therefore reached HRVDex with a populated Baevsky-SI
  // through the app and a null one through the Unifier: `hrvdex-dsp.js _envToSeed` reads exactly
  // `tm.amo50 / tm.mode / tm.mxDMn`, so every SI-derived metric (`d_si`, the HTN/BP pieces that
  // read `si`) came out null on that path. Living here means both builders call ONE function, so
  // they cannot drift apart in value the way they drifted apart in presence.
  // Units follow the Welltory convention: mode = modal RR in ms, amo50 = amplitude of the mode
  // in %, mxDMn = variation range in SECONDS. Empty/all-non-finite NN → nulls (honest-null, never 0).
  function baevskyGeom(nn) {
    nn = nn || [];
    if (!nn.length) return { mode: null, amo50: null, mxDMn: null };
    let mn = Infinity,
      mx = -Infinity,
      used = 0;
    const bins = {};
    for (const v of nn) {
      if (!isFinite(v)) continue;
      used++;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      const b = Math.round(v / 50) * 50;
      bins[b] = (bins[b] || 0) + 1;
    }
    // Every value non-finite ⇒ no measurement. Returning 0/NaN here would fabricate one, and
    // `mx - mn` on the untouched ±Infinity seeds would read -Infinity (Clock-Contract §2.6 honesty).
    if (!used) return { mode: null, amo50: null, mxDMn: null };
    let modeBin = 0,
      modeCnt = 0;
    for (const b in bins) {
      if (bins[b] > modeCnt) {
        modeCnt = bins[b];
        modeBin = +b;
      }
    }
    return {
      mode: modeBin, // modal RR, ms
      amo50: +((modeCnt / used) * 100).toFixed(1), // amplitude of mode, %
      mxDMn: +((mx - mn) / 1000).toFixed(3) // variation range, SECONDS (Welltory convention)
    };
  }
  const sd1 = (r) => r / Math.sqrt(2);
  const sd2 = (s, r) => Math.sqrt(Math.max(0, 2 * s * s - (r * r) / 2));
  // Geometric Poincaré: SD1/SD2 computed directly from the rotated coordinates of the
  // SAME NN array that gets plotted — guarantees the ellipse matches the scatter cloud.
  // SD1 = SDSD/√2 (short axis, beat-to-beat), SD2 = √(2·SDNN² − SD1²) (long axis).
  function poincareGeo(nn) {
    const n = nn.length;
    /* REFUSE (§2.6). sd1/sd2 are `validated` tier, so a fabricated 0 here is a badged claim that
       beat-to-beat variability WAS measured and was zero — the strongest statement this file can
       make, from two beats. Two points cannot define a dispersion at all. */
    if (n < 3) return { sd1: null, sd2: null };
    let ds = 0,
      dc = 0;
    for (let i = 1; i < n; i++) {
      ds += nn[i] - nn[i - 1];
      dc++;
    }
    const dmean = ds / dc;
    let dvar = 0;
    for (let i = 1; i < n; i++) {
      const d = nn[i] - nn[i - 1] - dmean;
      dvar += d * d;
    }
    // §8 (DEEP-AUDIT-2026-07-14): SDSD is the SAMPLE SD of the difference series (÷N−1), unifying the SD1
    // definition fleet-wide (PpgDex √0.5·std(Δ), PulseDex SDSD/√2) — was ÷N (dc), a definitional split with
    // its siblings. Negligible for large N; the fleet now agrees by construction.
    const sdsd = Math.sqrt(dvar / Math.max(1, dc - 1));
    const s1 = sdsd / Math.sqrt(2);
    const sdnnv = std(nn);
    const s2 = Math.sqrt(Math.max(0, 2 * sdnnv * sdnnv - s1 * s1));
    return { sd1: s1, sd2: s2 };
  }

  function linfit(x, y) {
    const n = x.length,
      mx = mean(x),
      my = mean(y);
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      num += (x[i] - mx) * (y[i] - my);
      den += (x[i] - mx) * (x[i] - mx);
    }
    const slope = den ? num / den : 0;
    return { slope, intercept: my - slope * mx };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SYNTHETIC OVERNIGHT ECG  — builds a ground-truth RR series with realistic
  //  HRV / sleep architecture / CVHR apnea clusters, then renders PQRST morphology
  //  into a µV Int16Array. Returns the ECG plus the ground-truth (device-equivalent)
  //  RR so the self-RR validation has something to compare against.
  // ════════════════════════════════════════════════════════════════════════
  function genSynthetic(opts) {
    opts = opts || {};
    const fs = opts.fs || 130;
    const durSec = opts.durSec || 3 * 3600; // ~3 h compressed overnight by default
    const ambulatory = opts.scenario === 'ambulatory' || opts.ambulatory === true;
    const seedRef = { s: (opts.seed || 20260601) >>> 0 };
    const rnd = () => {
      // xorshift32
      let x = seedRef.s;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      seedRef.s = x >>> 0;
      return (seedRef.s & 0xffffff) / 0x1000000;
    };
    const gauss = () => {
      let u = 0,
        v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    // ── sleep architecture: cycles ~90 min; each cycle dips into deep (N3) then up to REM ──
    const cycleLen = 95 * 60; // sec
    const stageAt = (t) => {
      // returns {mean RR base ms, vagal 0..1, stage}
      if (ambulatory) {
        // sustained daytime exercise: HR climbs ~82 → ~94 bpm across the walk, low vagal,
        // NO sleep architecture. (AMBULATORY-MODE fixture — a walk, not a sleep study.)
        const base = 730 - 90 * Math.min(1, (t / durSec) * 1.2);
        return { base, vagal: 0.3, stage: 'Wake' };
      }
      const ph = (t % cycleLen) / cycleLen; // 0..1 within a cycle
      // descending into deep then ascending to REM near the end of each cycle
      let stage, base, vagal;
      if (t < 7 * 60) {
        stage = 'Wake';
        base = 860;
        vagal = 0.35;
      } // sleep onset
      else if (ph < 0.18) {
        stage = 'N1';
        base = 980;
        vagal = 0.55;
      } else if (ph < 0.4) {
        stage = 'N2';
        base = 1060;
        vagal = 0.72;
      } else if (ph < 0.66) {
        stage = 'N3';
        base = 1135;
        vagal = 0.92;
      } // deep — high vagal, low HR
      else if (ph < 0.82) {
        stage = 'N2';
        base = 1050;
        vagal = 0.7;
      } else {
        stage = 'REM';
        base = 915;
        vagal = 0.42;
      } // REM — sympathetic, irregular
      // slow circadian downward drift in HR across the night
      base += Math.min(60, (t / durSec) * 55);
      return { base, vagal, stage };
    };

    // ── CVHR (apnea) clusters: windows where HR cyclically oscillates ~22–30 s ──
    const apneaWindows = ambulatory
      ? []
      : [
          { t0: 38 * 60, t1: 66 * 60, cyc: 28, depth: 0.15 }, // moderate cluster
          { t0: 120 * 60, t1: 152 * 60, cyc: 24, depth: 0.2 } // stronger cluster
        ].filter((w) => w.t0 < durSec);

    // ── artifact spans (strap shift / electrode pop) to exercise SQI ──
    const artifacts = [
      { t0: 88 * 60, t1: 88 * 60 + 40, kind: 'noise' },
      { t0: 175 * 60, t1: 175 * 60 + 55, kind: 'flat' }
    ].filter((w) => w.t0 < durSec);

    // ── build beat times + ground-truth RR + beat TYPE (N normal · V PVC · S PAC) ──
    const beatT = []; // R-peak time (sec)
    const gtRR = []; // ground-truth RR (ms) — interval ending at this beat
    const gtType = []; // 'N' | 'V' | 'S'
    /* Baseline respiratory carrier. ADDITIVE + OPTIONAL (`opts.respHz`), default UNCHANGED at 0.235 Hz
       (~14 breaths/min), so every existing caller — including the goldens — is byte-identical.
       It exists so a test can generate a SLOW-breathing ECG: DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §EP-rest
       needed one to reach `_autocorrPeriod(edrB, FS, 2.5, 10)`'s UPPER bound, and recorded that
       post-modulating the waveform amplitude cannot get there (the surfaced respiration tracks the
       RR-interval RSA, which amplitude editing does not reach — verified 14.2 → 14.5 at 90 % modulation).
       Patching the carrier is the route the brief itself named. Clamped to the physiologic 4–40 /min the
       rest of the generator assumes; an out-of-range ask falls back to the default rather than producing
       an ECG whose RSA the detector could never resolve. */
    const respHz0 = opts.respHz != null && opts.respHz >= 4 / 60 && opts.respHz <= 40 / 60 ? +opts.respHz : 0.235;
    /* RESPIRATORY IRREGULARITY IS STAGE-DEPENDENT (REM-STAGING-REDESIGN §3, the missing discriminator).
       Respiration phase = 2π·∫f dτ (accumulated), NOT 2π·f(t)·t — the latter chirps the instantaneous
       frequency badly. The carrier wanders ±0.03 Hz with a 600 s period.

       This USED TO BE that carrier alone: one global phase function, identical in every stage. That is
       a generator in which REM and NREM breathe ALIKE — the same defect §4 found in the motion channel,
       one signal over. §3 names respiratory variability as the one feature giving REM a POSITIVE
       signature rather than an LF/HF proxy; against this oracle it measured ~0 in every stage, so it
       could be neither developed nor validated, and a detector fitted to it would have been tuned
       toward a false target.

       The physiology now modelled: NREM breathing is metronomic; REM breathing is IRREGULAR in rate
       and depth. Wake is irregular too (volitional) — which is exactly why respiratory variability is
       a REM/NREM discriminator while motion remains the REM/Wake one.

       The irregularity rides as a SECOND, faster wander whose amplitude is stage-scaled, so the MEAN
       rate is unchanged and only its VARIABILITY moves. Closed-form integral, so the phase stays exact
       and the generator stays a pure function of t (no per-beat accumulator to drift). Period 47 s —
       fast enough that a 60 s analysis sub-window sees a full cycle, which is what makes the
       variability measurable at the resolution the stager works at. */
    const respIrreg = (tt) => {
      const s = stageAt(tt).stage;
      return s === 'REM' ? 0.055 : s === 'Wake' ? 0.045 : s === 'N1' ? 0.022 : 0.008; // Hz, ± swing
    };
    const respPhase = (tt) => 2 * Math.PI * respHz0 * tt - 0.03 * 600 * (Math.cos((2 * Math.PI * tt) / 600) - 1) - respIrreg(tt) * 47 * (Math.cos((2 * Math.PI * tt) / 47) - 1);
    let t = 0.4,
      lfTarget = 0,
      bw = 0; // bw = slow correlated (fractal) drift
    let sinusRR = 900; // running "expected" sinus interval
    let pendingComp = 0; // ms of compensatory pause owed to the next beat
    let bi = 0;
    while (t < durSec - 0.4) {
      const sa = stageAt(t);
      // respiration (RSA) — vagal scales HF amplitude; resp rate wanders slowly
      const rsa = sa.vagal * 38 * Math.sin(respPhase(t));
      /* LF (Mayer wave, ~0.1 Hz) — an OSCILLATION, modelled the same way RSA is.
         This used to be an AR(1) low-pass stepped ONCE PER BEAT: `lfTarget = 0.985·lfTarget + …`,
         `lf = 0.9·lf + 0.1·lfTarget`. At ~55 bpm a beat is ~1.09 s, so a = 0.985 is a time constant of
         ~67 beats ≈ 73 s ≈ 0.014 Hz — squarely VLF. The comment said 0.1 Hz; the arithmetic delivered
         VLF, so the LF BAND WAS STARVED BY CONSTRUCTION and LF/HF came out ~0.1 for every stage,
         ~20× below the physiological 0.5–4 (measured: N3 HF 632 vs LF 57). A classifier gating REM on
         LF/HF could therefore never fire on synthetic data whatever its thresholds
         (REM-STAGING-REDESIGN §4).
         The AR(1) is kept, demoted to what it is good at: a slow wander of the oscillation's AMPLITUDE.
         Note the phase is built from `t` (accumulated beat time), so the wave stays at 0.1 Hz in TIME
         regardless of how the heart rate moves the beat index. */
      lfTarget = 0.985 * lfTarget + 0.17 * gauss();
      const lfAmp = 30 * (1.05 - sa.vagal * 0.42) * (1 + 0.3 * lfTarget);
      const lfMs = lfAmp * Math.sin(2 * Math.PI * 0.1 * t);
      // slow correlated drift → long-range (1/f-like) structure for DFA α1 ≈ 1.
      bw = 0.992 * bw + gauss() * 0.9;
      // CVHR oscillation inside apnea windows
      let cvhr = 0;
      for (const w of apneaWindows) {
        if (t >= w.t0 && t < w.t1) {
          const ramp = Math.min(1, (t - w.t0) / 40) * Math.min(1, (w.t1 - t) / 40);
          cvhr += ramp * w.depth * sa.base * Math.sin((2 * Math.PI * t) / w.cyc);
        }
      }
      sinusRR = sa.base + rsa + lfMs + bw * 3.0 + cvhr + gauss() * 5;
      let rr = sinusRR,
        type = 'N';
      if (pendingComp > 0) {
        rr = sinusRR + pendingComp;
        pendingComp = 0;
      } // pause after an ectopic
      else if (rnd() < 0.0017) {
        // PVC — premature, full compensatory pause
        type = 'V';
        const coupling = sinusRR * (0.5 + 0.12 * rnd());
        rr = coupling;
        pendingComp = 2 * sinusRR - coupling - sinusRR; // so coupling+pause ≈ 2 sinus cycles
      } else if (rnd() < 0.0011) {
        // PAC — premature, partial (non-compensatory) pause
        type = 'S';
        const coupling = sinusRR * (0.58 + 0.12 * rnd());
        rr = coupling;
        pendingComp = sinusRR * 0.35;
      }
      rr = Math.max(360, Math.min(1700, rr));
      gtRR.push(rr);
      gtType.push(type);
      beatT.push(t);
      t += rr / 1000;
      bi++;
    }

    // ── render PQRST morphology into µV samples ──
    const N = Math.round(durSec * fs);
    const ecg = new Float32Array(N);
    // baseline wander (respiration + slow drift), µV
    for (let i = 0; i < N; i++) {
      const ti = i / fs;
      ecg[i] = 45 * Math.sin(2 * Math.PI * 0.22 * ti) + 30 * Math.sin(2 * Math.PI * 0.05 * ti + 1.3);
    }
    // PQRST as a sum of gaussians (µV), placed at each beat
    // [center ms, amp µV, width ms]
    const tmpl = [
      [-185, 95, 20], // P
      [-28, -115, 9], // Q
      [0, 1080, 7], // R
      [28, -240, 11], // S
      [240, 255, 54] // T  (later + wider → physiological QT/QTc)
    ];
    for (let k = 0; k < beatT.length; k++) {
      const c = Math.round(beatT[k] * fs);
      const respAmp = 1 + 0.11 * Math.sin(respPhase(beatT[k])); // EDR: R-amplitude modulation, coherent with RSA
      const isPVC = gtType[k] === 'V';
      const isPAC = gtType[k] === 'S';
      for (const [cms, amp, wms] of tmpl) {
        const w = (wms / 1000) * fs;
        const ctr = c + (cms / 1000) * fs;
        let a = amp * respAmp,
          ww = w;
        if (isPVC) {
          // wide, tall, bizarre; no P
          a = cms === 0 ? amp * 1.5 * respAmp : cms > 40 ? amp * 1.9 : amp * 0.35;
          if (cms === 0 || cms === 26 || cms === -28) ww = w * 1.9; // broaden QRS
        }
        if (isPVC && cms === -200) continue; // PVC: drop P wave
        if (isPAC && cms === -200) {
          a = amp * 0.7 * respAmp;
        } // PAC: small/early P (normal QRS)
        const lo = Math.max(0, Math.floor(ctr - 4 * ww)),
          hi = Math.min(N - 1, Math.ceil(ctr + 4 * ww));
        for (let i = lo; i <= hi; i++) {
          const d = (i - ctr) / ww;
          ecg[i] += a * Math.exp(-0.5 * d * d);
        }
      }
    }
    // sensor noise
    for (let i = 0; i < N; i++) ecg[i] += gauss() * 8;

    // ── inject artifacts ──
    for (const w of artifacts) {
      const s = Math.round(w.t0 * fs),
        e = Math.min(N, Math.round(w.t1 * fs));
      if (w.kind === 'flat') {
        const v = ecg[s] || 0;
        for (let i = s; i < e; i++) ecg[i] = v;
      } // electrode pop → flat
      else {
        for (let i = s; i < e; i++) ecg[i] = (rnd() - 0.5) * 2600;
      } // burst noise
    }

    // ── quantize to Int16 µV ──
    const int16 = new Int16Array(N);
    for (let i = 0; i < N; i++) {
      let v = Math.round(ecg[i]);
      if (v > 32767) v = 32767;
      if (v < -32768) v = -32768;
      int16[i] = v;
    }

    // ground-truth device RR rows (timestamp ms epoch + RR) — for validation card
    const t0 = ambulatory ? Date.UTC(2026, 5, 1, 12, 14, 0) : Date.UTC(2026, 5, 1, 23, 30, 0); // floating wall-clock (CLOCK-UNIFY)
    const devRR = gtRR.map((r, k) => ({ tsMs: t0 + Math.round(beatT[k] * 1000), rr: Math.round(r) }));

    // ground-truth device HR (1 Hz) — instantaneous HR from the same beats, with light
    // firmware EMA smoothing + noise (so the HR cross-check has something real to agree with).
    const Mhr = Math.max(1, Math.floor(durSec));
    const devHR = new Array(Mhr);
    let _bi = 0;
    for (let s = 0; s < Mhr; s++) {
      while (_bi < beatT.length - 1 && beatT[_bi + 1] <= s) _bi++;
      let hr = 60000 / gtRR[Math.min(_bi, gtRR.length - 1)] + gauss() * 0.7;
      devHR[s] = { tsMs: t0 + s * 1000, hr };
    }
    for (let s = 1; s < Mhr; s++) devHR[s].hr = 0.55 * devHR[s].hr + 0.45 * devHR[s - 1].hr;
    for (let s = 0; s < Mhr; s++) devHR[s].hr = +devHR[s].hr.toFixed(1);

    // ground-truth tri-axial accelerometer — gravity (posture) + respiratory chest
    // movement (ties to EDR breathing) + activity bursts. Overnight: 4 Hz still-sleeper.
    // Ambulatory: 26 Hz with a real walking step oscillation (≥7 Hz fs so the gait band
    // 0.5–3.5 Hz resolves) so the gait detector logs steps/cadence (AMBULATORY-MODE fixture).
    let ACCfs, devACC;
    if (ambulatory) {
      ACCfs = 26;
      const Macc = Math.max(1, Math.floor(durSec * ACCfs));
      devACC = new Array(Macc);
      // upright-ish chest (gravity mostly on z); a step oscillation ON the gravity axis so the
      // vector-magnitude actually swings at the step rate. Cadence alternates light-walk (~90
      // spm) and brisk (~110 spm) with brief standing pauses → ~27% of minutes in the brisk zone.
      for (let i = 0; i < Macc; i++) {
        const ti = i / ACCfs;
        const breath = 30 * Math.sin(respPhase(ti));
        const phase = (ti % 600) / 600; // 10-min macro-cycle
        let stepHz,
          moving = true;
        if (phase < 0.12) {
          moving = false;
          stepHz = 0;
        } // standing pause (~12% → sedentary)
        else if (phase < 0.39) {
          stepHz = 1.83;
        } // brisk walk ~110 spm (~27%)
        else {
          stepHz = 1.5;
        } // light walk ~90 spm
        const step = moving ? 190 * Math.sin(2 * Math.PI * stepHz * ti) : 0;
        const sway = moving ? 80 * Math.sin(2 * Math.PI * stepHz * ti * 0.5) : 0;
        const nz = moving ? 26 : 6;
        devACC[i] = {
          tsMs: t0 + Math.round(ti * 1000),
          x: Math.round(40 + sway + gauss() * nz),
          y: Math.round(120 + sway * 0.6 + breath * 0.4 + gauss() * nz),
          z: Math.round(980 + step + breath * 0.5 + gauss() * nz)
        };
      }
    } else {
      ACCfs = 4;
      const Macc = Math.max(1, Math.floor(durSec * ACCfs));
      devACC = new Array(Macc);
      // realistic sleep postures as gravity vectors (mg). Chest-strap convention: +z anterior.
      // supine z-up, prone z-down, left/right side gravity along ±x, brief upright at wake.
      const POSTURES = [
        [25, -18, 990],
        [970, -40, 90],
        [-965, 30, 70],
        [60, 35, -985]
      ]; // supine, left, right, prone
      let posture = POSTURES[0];
      for (let i = 0; i < Macc; i++) {
        const ti = i / ACCfs,
          sa = stageAt(ti);
        const breath = 42 * Math.sin(respPhase(ti)); // chest movement → ACC respiration (same breath)
        /* REM ATONIA (REM-STAGING-REDESIGN §4a, 2026-07-28). This block used to model REM as the
           SECOND-MOST-ACTIVE stage — `act` 0.5 against N2/N3's 0.07, and postural shifts as likely as
           Wake's. Measured over a 6 h run that put planted REM at a night-normalised motion index of
           96/100, indistinguishable from Wake's 100.
           REM is defined by skeletal-muscle ATONIA: gross body movement and postural change are
           SUPPRESSED, below even N2/N3. What REM does have is brief PHASIC twitches — small, sparse,
           and nothing like a turn-over. Modelling REM as mobile made the oracle agree with the
           classifier's REM→Wake confusion instead of exposing it, so a stager tuned against this
           fixture would have been trained toward the wrong target. */
        const shiftP = sa.stage === 'Wake' ? 0.0016 : sa.stage === 'REM' ? 0.0002 : 0.0004;
        if (rnd() < (shiftP / ACCfs) * 4) posture = POSTURES[Math.floor(rnd() * POSTURES.length)];
        let act = sa.stage === 'Wake' ? 1.0 : sa.stage === 'N1' ? 0.32 : sa.stage === 'REM' ? 0.04 : 0.07;
        // Phasic REM twitches: brief and small. They must stay well under the gross-movement scale —
        // a twitch is not a turn-over, and if these restored a Wake-like signature the fix would be
        // cosmetic.
        if (sa.stage === 'REM' && rnd() < 0.25 / ACCfs) act += 0.45;
        for (const w of apneaWindows) {
          if (ti >= w.t0 && ti < w.t1) {
            const ph = (ti - w.t0) % w.cyc;
            if (ph > w.cyc - 3) act += 0.55;
          }
        }
        const mv = act * gauss() * 60;
        devACC[i] = { tsMs: t0 + Math.round(ti * 1000), x: Math.round(posture[0] + breath * 0.75 + mv), y: Math.round(posture[1] + breath * 0.3 + mv * 0.8), z: Math.round(posture[2] + mv * 0.5) };
      }
    }

    return {
      int16,
      fs,
      gaps: [],
      t0Ms: t0,
      source: 'synthetic',
      durSec,
      deviceRR: devRR,
      deviceHR: devHR,
      deviceACC: devACC,
      accFs: ACCfs,
      nBeatsTrue: gtRR.length,
      /* THE PLANTED TRUTH, PUBLISHED (REM-STAGING-REDESIGN §4b). A fixture whose ground truth can only
         be recovered by re-deriving `stageAt` in the test is a fixture with two sources of truth, and
         the copy in the test drifts the moment this one is tuned — the sibling-divergence class the
         audits keep finding. Emitted as RUNS (~20 for a 6 h night), so it is compact, serialisable and
         reads as data rather than as a function on a data object. */
      stageTruth: (function () {
        var out = [],
          step = 30,
          prev = null,
          tt;
        for (tt = 0; tt < durSec; tt += step) {
          var st = stageAt(tt).stage;
          if (st !== prev) {
            out.push({ t0Sec: tt, stage: st });
            prev = st;
          }
        }
        return out;
      })(),
      scenario: opts.scenario || 'overnight'
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BAND-PASS 5–15 Hz  (Pan-Tompkins cascade: integer low-pass then high-pass,
  //  here as one-pole biquad approximations tuned to fs). Returns Float32Array.
  // ════════════════════════════════════════════════════════════════════════
  function bandpass(int16, fs) {
    const N = int16.length,
      x = new Float32Array(N);
    // remove DC / slow drift with high-pass (~5 Hz), then low-pass (~15 Hz)
    // high-pass: y = a*(yPrev + x - xPrev)
    const RChp = 1 / (2 * Math.PI * 5),
      aHp = RChp / (RChp + 1 / fs);
    let yh = 0,
      xp = 0;
    for (let i = 0; i < N; i++) {
      const xi = int16[i];
      yh = aHp * (yh + xi - xp);
      xp = xi;
      x[i] = yh;
    }
    // low-pass: simple 2-pass moving exponential (~15 Hz)
    const RClp = 1 / (2 * Math.PI * 15),
      aLp = 1 / fs / (RClp + 1 / fs);
    let yl = 0;
    for (let i = 0; i < N; i++) {
      yl = yl + aLp * (x[i] - yl);
      x[i] = yl;
    }
    return x;
  }

  // derivative → square → moving-window integrate (Pan-Tompkins front end)
  function ptFeature(bp, fs) {
    const N = bp.length;
    const d = new Float32Array(N);
    for (let i = 2; i < N - 2; i++) d[i] = 2 * bp[i + 1] + bp[i + 2] - bp[i - 2] - 2 * bp[i - 1];
    const sq = new Float32Array(N);
    for (let i = 0; i < N; i++) sq[i] = d[i] * d[i];
    const win = Math.max(1, Math.round(0.1 * fs)); // ~100 ms integration window
    const integ = new Float32Array(N);
    let acc = 0;
    for (let i = 0; i < N; i++) {
      acc += sq[i];
      if (i >= win) acc -= sq[i - win];
      integ[i] = acc / win;
    }
    return integ;
  }

  // Robust seed scale for the Pan-Tompkins integrate threshold: a SUBSAMPLED HIGH
  // PERCENTILE of the whole-record integrate feature (≈ a strong-QRS level), instead
  // of the max of the first 2 s. The integrate's elevated regions are wide (~100 ms
  // window), so a strided subsample reliably samples them; the ~99th pct lands at the
  // strong-QRS level on a clean record (so clean-file detection is ~unchanged) while a
  // ≤2 s startup transient is a negligible fraction of a night → it no longer moves the
  // seed. Degenerate (flat) → falls back to the legacy first-2 s max. ECG-RPEAK-SEED-FIX.
  function _seedScale(integ, fs) {
    const N = integ.length;
    if (!N) return 0;
    const stride = Math.max(1, Math.floor(N / 20000)),
      s = [];
    for (let i = 0; i < N; i += stride) {
      const v = integ[i];
      if (isFinite(v) && v > 0) s.push(v);
    }
    if (s.length) {
      s.sort(function (a, b) {
        return a - b;
      });
      const p = s[Math.min(s.length - 1, Math.floor(0.99 * s.length))];
      if (p > 0) return p;
    }
    let mx = 0;
    const initN = Math.min(N, 2 * fs);
    for (let i = 0; i < initN; i++) if (integ[i] > mx) mx = integ[i];
    return mx;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PAN-TOMPKINS R-PEAK DETECTION (adaptive double-threshold)
  //  returns raw integer peak indices on the original signal
  // ════════════════════════════════════════════════════════════════════════
  function detectPeaks(int16, bp, fs) {
    const N = int16.length;
    const integ = ptFeature(bp, fs);
    const refractory = Math.round(0.2 * fs); // 200 ms — physiological min RR
    // Seed thresholds from a ROBUST GLOBAL scale, not max(first 2 s). A first-2 s max
    // poisons the seed when a recording opens mid electrode-settling (a multi-kµV
    // transient ≫ the real QRS): squared in the integrate it sets the seed ~10–20× the
    // true QRS level, and SPKI only decays when a peak FIRES — so once seeded high it
    // never recovers → no beat crosses THRI → <12 peaks → false "signal may be flat"
    // throw on an otherwise-good night (ECG-RPEAK-SEED-FIX-2026-06-27).
    let init = _seedScale(integ, fs);
    let SPKI = 0.5 * init,
      NPKI = 0.1 * init,
      THRI = NPKI + 0.25 * (SPKI - NPKI);
    const peaks = [];
    let last = -refractory;
    // STALL-RECOVERY (ECGDEX-FOLLOWUPS-II §1). SPKI only updates when a peak FIRES, so a
    // single supra-physiologic IN-BAND transient — a multi-kµV electrode-settling/motion
    // artifact, ~20–30× a real QRS in the SQUARED integrate — can park SPKI (hence THRI)
    // above every subsequent real QRS, and detection then dies SILENTLY for the rest of the
    // recording (the robust seed prevents the <12-peak THROW, NOT this mid-record stall:
    // verified on a real Polar-H10 20260625 night that collapsed to 63 beats / 4 min of a
    // ~7 h record — integ artifact 1.1e7 vs ~5e5 real QRS). Guard: whenever detection stalls
    // past a non-physiologic gap (>2.5 s ⇒ sustained <24 bpm ⇒ the THRESHOLD, not the heart,
    // is stuck), BLEED SPKI toward the noise floor so a real QRS can re-cross THRI. Inert on
    // clean records — a real RR never exceeds 2.5 s, so beat output is BYTE-IDENTICAL there
    // (verified vs the pre-guard path).
    // ECGDEX AUDIT G — the bleed used to be gated `rrAvg>0`, but rrAvg is only established after
    // the SECOND detected beat. A SHARP electrode-settling transient that is the FIRST threshold
    // crossing (before any real QRS) parks SPKI above every subsequent QRS AND keeps rrAvg==0
    // forever, so the bleed never ran and detection was dead for the whole record (compute() then
    // threw "Too few R-peaks" on a clean multi-hour night). Dropping the `rrAvg>0` precondition and
    // relying on the fixed idleLimit alone lets an opening transient bleed down too. This does NOT
    // regress normal records: a normal first beat fires well under 2.5 s, so `last` advances before
    // `i - last` ever reaches idleLimit and the bleed stays dormant (byte-identical); it only ever
    // fires when no beat was detected within a 2.5 s window — precisely the stuck-threshold case,
    // whether that stall is mid-record or an opening-transient lead-in.
    const idleLimit = Math.round(2.5 * fs);
    const rr = [];
    let rrAvg = 0;
    for (let i = 1; i < N - 1; i++) {
      if (integ[i] > integ[i - 1] && integ[i] >= integ[i + 1] && integ[i] > THRI) {
        if (i - last > refractory) {
          // localise the true R on the original signal within ±70 ms of the integrate peak
          const w = Math.round(0.07 * fs);
          let bi = i,
            bv = -Infinity;
          for (let j = Math.max(0, i - w); j <= Math.min(N - 1, i + w); j++) {
            if (int16[j] > bv) {
              bv = int16[j];
              bi = j;
            }
          }
          peaks.push(bi);
          if (last >= 0) {
            const d = i - last;
            if (d > 0) {
              rr.push(d);
              if (rr.length > 8) rr.shift();
              let s = 0;
              for (let k = 0; k < rr.length; k++) s += rr[k];
              rrAvg = s / rr.length;
            }
          }
          last = i;
          SPKI = 0.125 * integ[i] + 0.875 * SPKI;
        } else {
          NPKI = 0.125 * integ[i] + 0.875 * NPKI;
        }
      } else if (integ[i] > integ[i - 1] && integ[i] >= integ[i + 1]) {
        NPKI = 0.125 * integ[i] + 0.875 * NPKI;
      }
      THRI = NPKI + 0.25 * (SPKI - NPKI);
      // un-stick a threshold parked by a supra-physiologic transient (see header note) — runs
      // even before a cadence is established (rrAvg==0) so an OPENING transient recovers too (AUDIT G)
      if (i - last > idleLimit) {
        SPKI = Math.max(NPKI, SPKI * 0.99);
        THRI = NPKI + 0.25 * (SPKI - NPKI);
      }
    }
    return peaks;
  }

  // Secondary detector (different front-end: slope+amplitude on band-passed signal)
  // used only for bSQI two-detector agreement.
  /* AMPLITUDE REFERENCE — the p99 of |bp|, NOT the maximum (TCH-FUSED-ROBUST-HAT-FOLLOWUPS Do 5).
     Both of this detector's thresholds used to be fractions of the GLOBAL MAXIMUM, and the floor
     `Math.max(0.3·env, 0.18·mx)` is the one that bites: a single artifact lifts `mx` and the floor
     rises above every real R peak for the WHOLE record, so the running envelope beside it — the part
     that is supposed to adapt — can never bring the threshold back down. Measured on the corpus
     (bSQI became observable in the commit before this one): on one H10 segment the largest |bp| was
     9.8× the median R amplitude, putting the floor at 436 against a median R peak of 247, and this
     detector found 7 peaks where detector A found 2074 — bSQI 0.0019 while `cleanBeatPct` read 99.8.

     A max is a 1-sample order statistic and one artifact IS that sample. The p99 is the same quantity
     computed where the beats actually are: a QRS complex spans ~7 % of samples at these rates, so the
     99th percentile sits inside the R peaks and tracks them, while a lone spike moves it by nothing.
     Histogram rather than a sort — O(N) with one pass and no allocation proportional to N, and
     deterministic (a strided SAMPLE could alias against the heart rate and systematically miss QRS). */
  /* 3× the typical R peak. An R amplitude genuinely varies within a record — respiration, posture,
     ectopy — but not by 3×; beyond that it is an artifact, not a heartbeat. Deliberately NOT fitted to
     the corpus: it is an upper bound on plausible physiological variation, and the segment it rescues
     sits at 9.8× with the healthy segments at ~1.2×, so nothing in this corpus is near the boundary. */
  const CK_AMPREF_MAX_RATIO = 3;

  function _ampRefB(bp, fs, mx) {
    if (!(mx > 0)) return 0;
    const N = bp.length,
      W = Math.max(1, Math.round(10 * fs)),
      maxima = [];
    for (let s0 = 0; s0 < N; s0 += W) {
      const e = Math.min(N, s0 + W);
      let m = 0;
      for (let i = s0; i < e; i++) {
        const a = Math.abs(bp[i]);
        if (a > m) m = a;
      }
      if (e - s0 >= W / 2) maxima.push(m);
    }
    if (!maxima.length) return mx;
    maxima.sort((a, b) => a - b);
    const h = maxima.length >> 1;
    const typ = maxima.length % 2 ? maxima[h] : (maxima[h - 1] + maxima[h]) / 2;
    /* A CAP, not a replacement. `Math.min` means a record whose largest |bp| is already a plausible
       R peak keeps `mx` EXACTLY — identical thresholds, identical peaks, byte-identical downstream —
       and only a record carrying an outlier is touched at all. Replacing the reference outright was
       tried first and measured WORSE: a p99 reference lowered the threshold on every record, and on
       a noisier night the extra spurious detections consumed the 0.22 s refractory window and BLOCKED
       real beats, costing 0.11 of bSQI across six segments to rescue one. */
    return Math.min(mx, CK_AMPREF_MAX_RATIO * typ);
  }

  function detectPeaksB(bp, fs) {
    const N = bp.length,
      refractory = Math.round(0.22 * fs);
    let mx = 0;
    for (let i = 0; i < N; i++) {
      const a = Math.abs(bp[i]);
      if (a > mx) mx = a;
    }
    /* The reference is capped at `mx` by construction, so it can only ever LOWER a threshold — it
       cannot make this detector stricter than it was, on any input. */
    const ref = _ampRefB(bp, fs, mx);
    let thr = 0.35 * ref,
      last = -refractory;
    const peaks = [];
    // running amplitude estimate
    let env = thr;
    for (let i = 1; i < N - 1; i++) {
      const a = Math.abs(bp[i]);
      env = 0.999 * env + 0.001 * a;
      const t = Math.max(0.3 * env, 0.18 * ref);
      if (bp[i] > bp[i - 1] && bp[i] >= bp[i + 1] && bp[i] > t && i - last > refractory) {
        peaks.push(i);
        last = i;
      }
    }
    return peaks;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SUB-SAMPLE R-PEAK REFINEMENT — parabolic vertex on the band-passed signal.
  //  delta = 0.5*(a-c)/(a-2b+c);  t = (i+delta)/fs.  Recovers ~Ts/10 (~0.8 ms).
  // ════════════════════════════════════════════════════════════════════════
  function refinePeaks(bp, peaks, fs) {
    const times = new Float64Array(peaks.length);
    const refIdx = new Float64Array(peaks.length);
    for (let k = 0; k < peaks.length; k++) {
      let i = peaks[k];
      // snap to local max of |bp| in a tiny window (band-passed R is the dominant lobe)
      const w = Math.round(0.04 * fs);
      let bi = i,
        bv = -Infinity;
      for (let j = Math.max(1, i - w); j <= Math.min(bp.length - 2, i + w); j++) {
        if (bp[j] > bv) {
          bv = bp[j];
          bi = j;
        }
      }
      i = bi;
      const a = bp[i - 1],
        b = bp[i],
        c = bp[i + 1],
        den = a - 2 * b + c;
      let delta = den !== 0 ? (0.5 * (a - c)) / den : 0;
      if (!isFinite(delta) || Math.abs(delta) > 1) delta = 0;
      refIdx[k] = i + delta;
      times[k] = (i + delta) / fs;
    }
    return { times, refIdx };
  }

  // kurtosis (peakedness) of a window — clean ECG is leptokurtic
  function kurtosis(int16, s, e) {
    let m = 0,
      n = 0;
    for (let i = s; i < e; i++) {
      m += int16[i];
      n++;
    }
    if (!n) return 0;
    m /= n;
    let m2 = 0,
      m4 = 0;
    for (let i = s; i < e; i++) {
      const d = int16[i] - m;
      m2 += d * d;
      m4 += d * d * d * d;
    }
    m2 /= n;
    m4 /= n;
    return m2 > 0 ? m4 / (m2 * m2) : 0;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PER-BEAT SQI  (composite 0..1 → Ganglior conf)
  //  flatline/rail · kurtosis · two-detector agreement (bSQI) · RR plausibility · range
  // ════════════════════════════════════════════════════════════════════════
  function computeSQI(int16, fs, peaks, times, peaksB) {
    const n = peaks.length;
    const sqi = new Float32Array(n);
    // RR (ms) from refined times
    const rr = new Float64Array(n);
    for (let k = 1; k < n; k++) rr[k] = (times[k] - times[k - 1]) * 1000;
    rr[0] = rr[1] || 1000;
    // bSQI: does detector B have a peak within ±50 ms of each A peak?
    const tolB = 0.05 * fs;
    let bp2 = 0;
    const matchB = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const target = peaks[k];
      while (bp2 < peaksB.length && peaksB[bp2] < target - tolB) bp2++;
      // search nearby (don't consume monotonically too aggressively)
      let found = false;
      for (let j = Math.max(0, bp2 - 2); j < peaksB.length && peaksB[j] <= target + tolB; j++) {
        if (Math.abs(peaksB[j] - target) <= tolB) {
          found = true;
          break;
        }
      }
      matchB[k] = found ? 1 : 0;
    }
    /* TERM ACCUMULATORS — TCH-FUSED-ROBUST-HAT-FOLLOWUPS Do 5, step 1: "make bSQI observable".
       The composite below is 0.30·kSQI + 0.28·matchB + 0.24·rrPlaus + 0.18·ampOK, and until now only
       the COMPOSITE left this function. That made a dead term indistinguishable from a live one — a
       bSQI stuck at 0 would silently run the score on 72 % of its intended inputs and nothing
       downstream could see it. These are means over the record, computed in the loop that already
       computes each term, so the cost is four adds per beat and the arithmetic below is untouched. */
    let sumK = 0,
      sumB = 0,
      sumR = 0,
      sumA = 0,
      nFlat = 0;
    for (let k = 0; k < n; k++) {
      const i = peaks[k];
      const s = Math.max(0, i - Math.round(0.13 * fs)),
        e = Math.min(int16.length, i + Math.round(0.13 * fs));
      // flatline / rail: count identical or near-identical runs
      let flatRun = 0,
        maxFlat = 0,
        railHit = 0,
        prev = int16[s];
      for (let j = s + 1; j < e; j++) {
        if (Math.abs(int16[j] - prev) < 2) {
          flatRun++;
          if (flatRun > maxFlat) maxFlat = flatRun;
        } else flatRun = 0;
        if (Math.abs(int16[j]) > 31000) railHit++;
        prev = int16[j];
      }
      const flatBad = maxFlat > 0.2 * fs || railHit > 3; // >200 ms flat
      // kurtosis
      const kurt = kurtosis(int16, s, e);
      const kSQI = Math.max(0, Math.min(1, (kurt - 2.5) / 8)); // clean QRS window: kurt ~5–15
      // RR plausibility
      const rrk = rr[k];
      const rrOK = rrk >= 300 && rrk <= 2000;
      let rrDev = 0;
      if (k > 1 && k < n - 1) {
        const loc = (rr[k - 1] + rr[k + 1]) / 2;
        rrDev = loc ? Math.abs(rrk - loc) / loc : 0;
      }
      const rrPlaus = rrOK ? Math.max(0, 1 - Math.max(0, rrDev - 0.2) / 0.6) : 0;
      // range / amplitude sanity
      let mn = Infinity,
        mx = -Infinity;
      for (let j = s; j < e; j++) {
        if (int16[j] < mn) mn = int16[j];
        if (int16[j] > mx) mx = int16[j];
      }
      const amp = mx - mn;
      const ampOK = amp > 180 && amp < 6000 ? 1 : amp <= 180 ? 0 : 0.4;
      // composite
      let q = 0.3 * kSQI + 0.28 * matchB[k] + 0.24 * rrPlaus + 0.18 * ampOK;
      if (flatBad) q *= 0.15;
      sqi[k] = Math.max(0, Math.min(1, q));
      sumK += kSQI;
      sumB += matchB[k];
      sumR += rrPlaus;
      sumA += ampOK;
      if (flatBad) nFlat++;
    }
    /* REFUSE, DO NOT FABRICATE (Clock Contract §2.6, applied to the term breakdown): with no beats
       there is no mean, and a 0 would read as "measured, and the term is dead" — the exact confusion
       this breakdown exists to end. Null-VALUED fields rather than a null object, matching the
       lombScargle precedent a few hundred lines up: callers read `terms.bSQI` and a bare null would
       crash them; the absence has to be visible without breaking the shape. */
    const mean = n > 0 ? (x) => +(x / n).toFixed(4) : () => null;
    const terms = {
      n,
      kSQI: mean(sumK),
      bSQI: mean(sumB),
      rrPlaus: mean(sumR),
      ampOK: mean(sumA),
      flatBadPct: n > 0 ? +((100 * nFlat) / n).toFixed(2) : null
    };
    return { sqi, rr, terms };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BUILD NN SERIES  — gate by SQI, interpolate excluded/implausible beats so
  //  the tachogram stays time-aligned (Kubios/Malik style). Surfaces correction
  //  rate + % analyzable.
  // ════════════════════════════════════════════════════════════════════════
  function buildNN(times, rr, sqi, sqiThr, ectopyThr) {
    sqiThr = sqiThr == null ? 0.3 : sqiThr;
    ectopyThr = ectopyThr == null ? 0.2 : ectopyThr; // Malik 20% rule (Task Force 1996 / Kubios)
    const n = rr.length;
    const nn = new Float64Array(n);
    const tt = new Float64Array(n);
    const corrected = new Uint8Array(n);
    let nEctopy = 0;
    for (let k = 0; k < n; k++) {
      nn[k] = rr[k];
      tt[k] = times[k];
    }
    // Replace beats that are (a) low signal-quality, (b) physiologically implausible, OR
    // (c) ectopic — i.e. deviating >ectopyThr from the local clean median. (c) is the key
    // one: a PAC/PVC has a clean QRS (high SQI) and in-range RR, so it passes (a)+(b)
    // untouched yet injects two large beat-to-beat jumps that massively inflate rMSSD/pNN50.
    // Without it, ECGDex disagrees with PulseDex/Kubios on the same recording.
    // NB: start at k=0 — the FIRST beat (sensor-contact startup artifact, e.g. a 474 ms
    // beat ≈127 bpm against a ~1200 ms mean) must be range/relative-gated too, or it
    // survives into minRR/maxHR. The local median uses forward neighbours for k=0.
    for (let k = 0; k < n; k++) {
      const seg = [];
      for (let j = Math.max(0, k - 5); j < Math.min(n, k + 6); j++) {
        if (j !== k && sqi[j] >= sqiThr && rr[j] >= 300 && rr[j] <= 2000) seg.push(rr[j]);
      }
      seg.sort((a, b) => a - b);
      const med = seg.length ? seg[seg.length >> 1] : 0;
      const dev = med ? Math.abs(nn[k] - med) / med : 0; // deviation from local median (relative-plausibility gate)
      const rangeBad = sqi[k] < sqiThr || nn[k] < 300 || nn[k] > 2000;
      const ectopic = med && dev > ectopyThr;
      if (rangeBad || ectopic) {
        nn[k] = med || nn[k + 1] || nn[k - 1] || 1000;
        corrected[k] = 1;
        if (ectopic && !rangeBad) nEctopy++;
      }
    }
    let nCorr = 0;
    for (let k = 0; k < n; k++) nCorr += corrected[k];
    let nGood = 0;
    for (let k = 0; k < n; k++) if (sqi[k] >= sqiThr) nGood++;
    // ── gap-aware coverage ──────────────────────────────────────────────────────
    // A real recording with the strap off (or a sensor dropout) leaves big inter-beat
    // gaps. tt[N-1] then over-states duration and % clean-beats hides the dead time.
    // GAP_S: any inter-beat interval longer than this is a coverage gap, not a missed beat.
    const GAP_S = 10;
    let activeSec = 0,
      gapSec = 0,
      nGaps = 0;
    for (let k = 1; k < n; k++) {
      const d = tt[k] - tt[k - 1];
      if (d <= 0) continue;
      if (d > GAP_S) {
        gapSec += d;
        nGaps++;
      } else activeSec += d;
    }
    const spanSec = n > 1 ? tt[n - 1] - tt[0] : 0;
    const coveragePct = spanSec > 0 ? +((activeSec / spanSec) * 100).toFixed(1) : 100;
    const cleanBeatPct = +((nGood / n) * 100).toFixed(1);
    // Honest headline: clean-beat fraction discounted by how much of the span is covered.
    const analyzablePct = +(cleanBeatPct * Math.min(1, coveragePct / 100)).toFixed(1);
    return {
      nn,
      tt,
      corrected,
      correctionRate: +((nCorr / n) * 100).toFixed(2),
      analyzablePct,
      cleanBeatPct,
      coveragePct,
      nCorrected: nCorr,
      nEctopyCorrected: nEctopy,
      activeSec,
      spanSec,
      gapSec,
      nGaps
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PER-SECOND ARTIFACT CONFIDENCE  (TCH-FUSED-ROBUST-HAT-2026-07-14)
  //  A per-second trust c ∈ [0,1] for the derived HR: c = density_trust × quality_trust.
  //    density_trust — redescends as the LOCAL beat-density (beats in a ±winSec/2 window) becomes
  //      an UPPER outlier vs the RECORD's own median density → spurious over-detection (the 06-12
  //      15-min burst reads z 13–22; clean nights ≤ z 7). This is the signal the per-beat SQI gate
  //      and Malik ectopy gate BOTH miss, because they are local and the burst is sustained.
  //    quality_trust — redescends as the local mean SQI falls BELOW the record's own median SQI.
  //      Keys on SIGNAL QUALITY, never rhythm ⇒ AF-safe: real AF/tachycardia keep clean QRS ⇒ high
  //      SQI ⇒ quality_trust ≈ 1, so nothing is dropped for irregularity alone.
  //  Self-calibrating (record's own medians) + a universal redescending cut C (Tukey-style); NO
  //  corpus-tuned threshold. Consumed by the fused-weight hat as a per-second weight (a corner it
  //  down-weights leaves that corner's difference series but not the others). Unwired here — the
  //  worker's ecgHrMap / the hat call it (see the brief's file-by-file plan).
  //  peaks: sample indices · sqi: per-beat SQI (from computeSQI) · fs · t0Ms: recording start (floating).
  //  Returns Map(absoluteSecond → confidence) aligned to the per-second HR the hat consumes.
  // ════════════════════════════════════════════════════════════════════════
  function beatConfidence(peaks, sqi, fs, t0Ms, winSec) {
    winSec = winSec || 60;
    const n = peaks.length,
      out = new Map();
    const t0 = t0Ms || 0;
    const secAbs = (k) => Math.floor((t0 + (peaks[k] / fs) * 1000) / 1000);
    if (n < 20) {
      for (let k = 0; k < n; k++) out.set(secAbs(k), 1);
      return out;
    } // too short to calibrate — trust all
    const s0 = secAbs(0),
      s1 = secAbs(n - 1),
      S = s1 - s0 + 1;
    if (S < 1) return out;
    // bin beats into their second: count + SQI sum
    const cnt = new Float64Array(S),
      qsum = new Float64Array(S);
    for (let k = 0; k < n; k++) {
      const s = secAbs(k) - s0;
      if (s >= 0 && s < S) {
        cnt[s]++;
        qsum[s] += sqi && Number.isFinite(sqi[k]) ? sqi[k] : 1;
      }
    }
    // sliding ±half window → local beat count + local mean SQI, O(S)
    const half = Math.max(1, Math.round(winSec / 2));
    const winCnt = new Float64Array(S),
      winSqi = new Float64Array(S);
    let cAcc = 0,
      qAcc = 0,
      lo = 0,
      hi = -1;
    for (let i = 0; i < S; i++) {
      const a = Math.max(0, i - half),
        b = Math.min(S - 1, i + half);
      while (hi < b) {
        hi++;
        cAcc += cnt[hi];
        qAcc += qsum[hi];
      }
      while (lo < a) {
        cAcc -= cnt[lo];
        qAcc -= qsum[lo];
        lo++;
      }
      winCnt[i] = cAcc;
      winSqi[i] = cAcc > 0 ? qAcc / cAcc : 0;
    }
    // robust record baselines (median + MAD) over windows that actually carry beats
    const active = [];
    for (let i = 0; i < S; i++) if (winCnt[i] > 0) active.push(i);
    const medOf = (idx) => {
      const a = idx.map((i) => winCnt[i]).sort((x, y) => x - y),
        m = a.length;
      return m ? (m % 2 ? a[(m - 1) / 2] : (a[m / 2 - 1] + a[m / 2]) / 2) : 0;
    };
    const medQ = (idx) => {
      const a = idx.map((i) => winSqi[i]).sort((x, y) => x - y),
        m = a.length;
      return m ? (m % 2 ? a[(m - 1) / 2] : (a[m / 2 - 1] + a[m / 2]) / 2) : 0;
    };
    const cMed = medOf(active),
      qMed = medQ(active);
    const cAbs = active.map((i) => Math.abs(winCnt[i] - cMed)).sort((x, y) => x - y);
    const qAbs = active.map((i) => Math.abs(winSqi[i] - qMed)).sort((x, y) => x - y);
    const madC = 1.4826 * (cAbs.length ? cAbs[cAbs.length >> 1] : 0) || 1;
    const madQ = 1.4826 * (qAbs.length ? qAbs[qAbs.length >> 1] : 0) || 1e-6;
    const C = 6; // universal redescending cut (Tukey-style)
    const trust = (z) => (z <= 0 ? 1 : z >= C ? 0 : (1 - (z / C) * (z / C)) * (1 - (z / C) * (z / C)));
    for (let i = 0; i < S; i++) {
      if (winCnt[i] <= 0) continue;
      const sD = Math.max(0, (winCnt[i] - cMed) / madC); // density UPPER-outlier suspicion (over-detection)
      const sQ = Math.max(0, (qMed - winSqi[i]) / madQ); // SQI-depressed-below-median suspicion
      // AF-safe AND: an artifact needs BOTH cues — a window is suspect only to the extent its WEAKER cue
      // fires (min). High rate with clean QRS (AF / real tachycardia) → sQ≈0 → min≈0 → c=1, never dropped.
      out.set(s0 + i, trust(Math.min(sD, sQ)));
    }
    return out;
  }

  // Convenience: raw ECG (int16 + its bandpass + the A-peaks) → per-second confidence Map, running
  // detector B + per-beat SQI + beatConfidence internally. The fused-hat consumer (worker ecgHrMap)
  // calls this after detectPeaks. peaks: A-peak sample indices · t0Ms: recording start (floating).
  function hrConfidence(int16, bp, peaks, fs, t0Ms) {
    if (!peaks || peaks.length < 20) return new Map();
    const B = detectPeaksB(bp, fs);
    const times = new Float64Array(peaks.length);
    for (let k = 0; k < peaks.length; k++) times[k] = peaks[k] / fs; // seconds (computeSQI RR-plausibility)
    const q = computeSQI(int16, fs, peaks, times, B);
    return beatConfidence(peaks, q.sqi, fs, t0Ms);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  FREQUENCY DOMAIN — Lomb–Scargle on unevenly-sampled NN → VLF/LF/HF + resp.
  // ════════════════════════════════════════════════════════════════════════
  function lombScargle(nn, times, nf) {
    const N = nn.length;
    /* REFUSE, DO NOT FABRICATE (Clock Contract §2.6, applied to the spectral path). Returning zeros
       here made "too few beats to transform" indistinguishable from "measured, and the power is
       zero" — and the zeros reach badged metrics: `hfnu`/`lfnu`/`vlf` are `validated` tier, and
       `hfnu` computed 0/(0+0 || 1)*100 = a clean 0.0 %. Null-VALUED FIELDS rather than a null
       object, because callers read `spec.respRate` on the result and a bare null would crash them;
       the absence has to be visible without breaking the shape. Same discipline `sqi` already uses
       a few hundred lines below — "an absent measurement, never a default". */
    if (N < 12) return { tp: null, vlf: null, lf: null, hf: null, lfhf: null, respRate: null };
    const t = times.slice(0, N);
    const dt = linfit(Array.from(t), Array.from(nn));
    const x = [];
    for (let i = 0; i < N; i++) x.push(nn[i] - (dt.slope * t[i] + dt.intercept));
    const fLo = 0.003,
      fHi = 0.4;
    nf = nf || 300;
    const df = (fHi - fLo) / (nf - 1);
    /* DEEP-AUDIT-II §3.1 — Parseval calibrates against the FULL spectral support, not the band.
       `sc = variance / tp` with `tp` accumulated over [fLo, fHi] only asserts that the IN-BAND
       integral equals the WHOLE signal variance — true only when there is no power outside the band.
       When there is, the sub-bands absorb it, one-directionally. Measured: +0.6 % on clean RR, but LF
       overstated 2.3× on an ordinary LF-plus-beat-alternans record, and a pure 0.45 Hz respiration
       (just above the band edge) reported HF = 713 ms² with no in-band content whatsoever.
       The calibration grid now runs to the mean-Nyquist of the beat series, 1/(2·meanRR) — the highest
       frequency an RR series can carry — while the REPORTED bands stay bounded by the Task-Force
       definitions. `df` is held constant and `nf` grows instead, so spectral resolution is identical
       to before: only genuinely out-of-band power is removed, and a clean record's numbers do not
       move for reasons unrelated to the defect. */
    const _meanRRs = (function () {
      let s = 0;
      for (let i = 0; i < N; i++) s += nn[i];
      return N ? s / N / 1000 : 0; // ms → s
    })();
    const fNyq = _meanRRs > 0 ? 1 / (2 * _meanRRs) : fHi;
    const fCal = Math.max(fHi, Math.min(fNyq, 2)); // never below the band; ceiling guards absurd RR
    const nfFull = Math.max(nf, Math.round((fCal - fLo) / df) + 1);
    let tp = 0, // in-band total — the Task-Force identity vlf+lf+hf
      tpFull = 0, // full-support total — the Parseval denominator
      vlf = 0,
      lf = 0,
      hf = 0,
      peakF = 0,
      peakP = 0;
    for (let kf = 0; kf < nfFull; kf++) {
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
      tpFull += e; // every evaluated bin — the Parseval denominator
      /* The REPORTED bands stay bounded by the Task-Force definitions. Note the `f < fHi` guard:
         the HF arm was an unbounded `else`, so extending the grid without this would make HF swallow
         the entire out-of-band tail — turning a fix into a much worse version of the same bug — and
         would let respRate's peak search wander above 0.4 Hz. */
      if (f < fHi) {
        tp += e;
        if (f < 0.04) vlf += e;
        else if (f < 0.15) lf += e;
        else {
          hf += e;
          if (P > peakP) {
            peakP = P;
            peakF = f;
          }
        }
      }
    }
    const variance = x.reduce((s, v) => s + v * v, 0) / N,
      sc = tpFull > 0 ? variance / tpFull : 1;
    // DEEP-AUDIT §10: the sub-bands tile [fLo,fHi) exactly, so tp IS vlf+lf+hf. Round the bands FIRST and
    // define tp as their sum, so the Task-Force identity holds EXACTLY rather than to within rounding.
    const _v = Math.round(vlf * sc),
      _l = Math.round(lf * sc),
      _h = Math.round(hf * sc);
    /* §3.1 companion finding — at slow heart rates the beat series' own Nyquist falls BELOW the
       0.4 Hz HF edge (40 bpm ⇒ mean RR 1.5 s ⇒ fNyq 0.33 Hz), so part of the HF band is defined
       above what the series can represent. That is true of the Task-Force definition itself and
       predates this fix, so the VALUE is deliberately left alone; the condition is merely made
       visible. Common on bradycardic and deep-sleep records — exactly where HF is most read. */
    return {
      tp: _v + _l + _h,
      vlf: _v,
      lf: _l,
      hf: _h,
      /* §5.2 — `hf || 1` FABRICATES a ratio when HF is zero: it silently substitutes 1 ms² and reports
         lf/1 as if it were a measurement. PpgDex already does the honest thing (`hf > 0 ? lf/hf : null`).
         A ratio with no denominator is not a small ratio, it is no ratio. */
      lfhf: hf > 0 ? +(lf / hf).toFixed(3) : null,
      respRate: +(peakF * 60).toFixed(1),
      hfAboveNyquist: fNyq < fHi,
      nyquistHz: +fNyq.toFixed(3)
    };
  }

  function dfaAlpha1(a) {
    const N = a.length;
    if (N < 16) return null;
    const m = mean(a);
    let acc = 0;
    const y = [];
    for (let i = 0; i < N; i++) {
      acc += a[i] - m;
      y.push(acc);
    }
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

  function sampEn(a, m, r) {
    const N = a.length;
    if (N < m + 2) return null;
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

  function triangularIndex(a) {
    const binW = 1000 / 128;
    const f = {};
    let maxC = 0;
    a.forEach((v) => {
      const k = Math.round(v / binW);
      f[k] = (f[k] || 0) + 1;
      if (f[k] > maxC) maxC = f[k];
    });
    return +(a.length / maxC).toFixed(2);
  }

  function prsaCapacity(a, sign) {
    const N = a.length,
      L = 2;
    const win = [];
    for (let i = L; i < N - L; i++) {
      const isAnchor = sign > 0 ? a[i] > a[i - 1] : a[i] < a[i - 1];
      if (!isAnchor) continue;
      if (Math.abs(a[i] - a[i - 1]) / a[i - 1] > 0.05) continue;
      win.push([a[i - 2], a[i - 1], a[i], a[i + 1], a[i + 2]]);
    }
    if (win.length < 3) return null;
    const X = [];
    for (let k = 0; k < 5; k++) {
      let s = 0;
      win.forEach((w) => (s += w[k]));
      X.push(s / win.length);
    }
    return +((X[2] + X[3] - X[1] - X[0]) / 4).toFixed(2);
  }

  function fragmentation(a) {
    const N = a.length;
    if (N < 4) return null;
    const d = [];
    for (let i = 1; i < N; i++) d.push(a[i] - a[i - 1]);
    const s = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    for (let i = 0; i < s.length; i++) {
      if (s[i] === 0) s[i] = i > 0 ? s[i - 1] : 1;
    }
    let ip = 0;
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) ip++;
    const PIP = (ip / N) * 100;
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
    const IALS = runs.length / N;
    let tot = 0,
      shortNN = 0;
    runs.forEach((L) => {
      tot += L;
      if (L < 3) shortNN += L;
    });
    return { pip: +PIP.toFixed(1), ials: +IALS.toFixed(3), pss: +((shortNN / tot) * 100).toFixed(1) };
  }

  /* RESPIRATORY-RATE VARIABILITY over one epoch (REM-STAGING-REDESIGN §3).
     REM breathing is irregular in rate and depth; NREM breathing is metronomic. The epoch's own
     `resp` (the HF spectral peak over all 5 minutes) cannot express that — it is one frequency, and a
     rate that swung wildly and one that never moved produce the same peak. So: split the epoch into
     60 s sub-windows, take each one's HF peak, and report the coefficient of variation across them.

     WHY 60 s. Long enough for the HF band (0.15–0.4 Hz ⇒ ≥9 respiratory cycles) to have a peak worth
     reading, short enough that five of them fit in an epoch. LF would NOT survive this — it needs
     ≥2 min — which is why only the respiratory peak is computed here and LF/HF stays on the 5-min
     scale it is defined at.

     CV, NOT SD. A rate swinging ±2 /min around 12 is more irregular than the same swing around 20,
     and the stager compares epochs whose mean rates differ. Normalising by the mean is what makes the
     number comparable across epochs and across subjects.

     NULL, NOT ZERO, when it cannot be measured. Fewer than three usable sub-windows (a sparse or
     gappy epoch) means the variability is UNKNOWN — and zero would read as "perfectly metronomic",
     the strongest possible NREM evidence, fabricated from absence. Consumers must treat null as no
     contribution rather than as a value.

     MEASURED against planted truth on the 6 h synthetic: REM 0.099 against NREM 0.036–0.039 and Wake
     0.056 — a ~2.6× REM/NREM separation, and the Wake value sitting between them exactly as the
     physiology predicts. */
  function _respCv(seg, segT, w0, w1) {
    const SUB = 60;
    const rates = [];
    for (let s0 = w0; s0 + SUB <= w1 + 1e-6; s0 += SUB) {
      const s1 = s0 + SUB,
        sSeg = [],
        sT = [];
      for (let k = 0; k < segT.length; k++) {
        if (segT[k] >= s0 && segT[k] < s1) {
          sSeg.push(seg[k]);
          sT.push(segT[k]);
        }
      }
      // ~30 bpm floor for a usable 60 s sub-window; below that the HF peak is noise, not respiration.
      if (sSeg.length < 30) continue;
      const r = lombScargle(sSeg, sT, 160).respRate;
      if (r != null && isFinite(r) && r > 0) rates.push(r);
    }
    if (rates.length < 3) return null;
    const m = rates.reduce((a, b) => a + b, 0) / rates.length;
    if (!(m > 0)) return null;
    const v = rates.reduce((a, b) => a + (b - m) * (b - m), 0) / rates.length;
    return +(Math.sqrt(v) / m).toFixed(4);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  5-MIN EPOCH ENGINE — window the NN series; per-epoch short-term suite.
  // ════════════════════════════════════════════════════════════════════════
  function epochEngine(nn, tt, winSec, sqiPerBeat) {
    winSec = winSec || 300;
    const N = nn.length,
      tEnd = tt[N - 1];
    const epochs = [];
    let i = 0;
    for (let w0 = 0; w0 <= tEnd; w0 += winSec) {
      const w1 = w0 + winSec,
        seg = [],
        segT = [],
        segQ = [];
      while (i < N && tt[i] < w1) {
        seg.push(nn[i]);
        segT.push(tt[i]);
        if (sqiPerBeat && Number.isFinite(sqiPerBeat[i])) segQ.push(sqiPerBeat[i]);
        i++;
      }
      // back up i so windows that share a boundary still see beats (non-overlap, simple advance is fine)
      if (seg.length >= 20) {
        const m = mean(seg);
        const ls = lombScargle(seg, segT, 160);
        epochs.push({
          tMin: +(w0 / 60).toFixed(1),
          // RESPIRATORY-RATE VARIABILITY (REM-STAGING-REDESIGN §3) — `resp` below is one frequency for
          // the whole epoch and by construction says nothing about whether the breathing that produced
          // it was metronomic or ragged. See _respCv. Not yet consumed by the stager: the weighted-score
          // detector this feature exists for is still open (§3), and the measurements are in the
          // follow-up brief rather than in a half-calibrated gate.
          respCv: _respCv(seg, segT, w0, w1),
          n: seg.length,
          /* EPOCH-LEVEL SIGNAL QUALITY (TRIO-ARTIFACT-GATE §1). `null` when no per-beat SQI reached
             this epoch — an absent measurement, never a default 1, which would read as "clean" and be
             exactly the fabricated-absence the Clock Contract §2.6 forbids one signal over. */
          sqi: segQ.length ? +(segQ.reduce((a, b) => a + b, 0) / segQ.length).toFixed(3) : null,
          hr: +(60000 / m).toFixed(1),
          /* WHICH STATISTIC THIS IS (R5-HR-TRIPLET-FOLLOWUPS). The three hat corners summarise an
             epoch differently — OxyDex publishes median(1 Hz rate), which sits 0.299 bpm below this
             one on real RR, and that gap is the whole of the "OxyDex under-reads by 0.36 bpm"
             finding. A consumer differencing two epochs was measuring the choice. Now it can see it.
             `rate-of-mean` = 60000 / mean(RR); the alternatives are `median-rate` and `mean-rate`. */
          hrStat: 'rate-of-mean',
          meanRR: +m.toFixed(1),
          rmssd: +rmssd(seg).toFixed(1),
          sdnn: +std(seg).toFixed(1),
          // vlf/tp carried too (DEEP-AUDIT §10): the exported spectrum is the 5-min epoch median, and it
          // must report ALL FOUR bands on that one scale — see the spec block in analyze().
          pnn: +pnn50(seg).toFixed(1),
          lf: ls.lf,
          hf: ls.hf,
          vlf: ls.vlf,
          tp: ls.tp,
          lfhf: ls.lfhf,
          resp: ls.respRate
        });
      }
    }
    return epochs;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  DYNAMIC HRV STABILITY  (Li & Kiyono 2026, Sensors 26(4):1118 [CC BY 4.0])
  //  The within-night TREND of ln(RMSSD) instability — Cohen's |d| > 1.1 vs
  //  glucose metabolism. We compute, per 30-min window, the SD of ln(RMSSD)
  //  across that window's 5-min epochs → bσ(ln(RMSSD)); then regress those
  //  window SDs against time → nocturnal trend (slope).
  //    slope < 0  → DECREASING overnight = progressive autonomic stabilization
  //                 (favourable; lower-eHbA1c group pattern)
  //    slope > 0  → INCREASING overnight = persistent autonomic instability
  //                 (glycemic-risk signal; higher-eHbA1c group pattern)
  //  We ALSO report the within-window variance trend bs²(ln(RMSSD)) (same finding).
  // ════════════════════════════════════════════════════════════════════════
  function hrvStability(epochs) {
    if (!epochs || epochs.length < 12) return null; // need ≥ ~1 h
    const WIN_MIN = 30;
    // group 5-min epochs into 30-min windows
    const windows = [];
    let cur = [],
      wStart = epochs[0].tMin;
    for (const e of epochs) {
      if (e.tMin - wStart >= WIN_MIN) {
        if (cur.length >= 3) windows.push({ tMin: wStart, epochs: cur });
        cur = [];
        wStart = e.tMin;
      }
      cur.push(e);
    }
    if (cur.length >= 3) windows.push({ tMin: wStart, epochs: cur });
    if (windows.length < 3) return null;

    const pts = []; // { tMin, lnSD, lnVar, lnMean }
    for (const w of windows) {
      const lnR = w.epochs.map((e) => Math.log(Math.max(1, e.rmssd)));
      const m = mean(lnR),
        sd = std(lnR);
      // n = epochs in this window. A trailing group is admitted with as few as 3
      // (≈15 min, not a full 30-min window) — see the `>= 3` guards above; carry n
      // so an under-sampled window is VISIBLE rather than silently equal-weighted
      // (DEEP-AUDIT-II #39). The slope fit is deliberately left unchanged — the
      // real-corpus effect is immaterial; surfacing n is the honest half.
      pts.push({ tMin: w.tMin, lnSD: sd, lnVar: sd * sd, lnMean: m, n: w.epochs.length });
    }
    const xs = pts.map((p) => p.tMin / 60); // hours
    const sdSlope = linfit(
      xs,
      pts.map((p) => p.lnSD)
    ).slope; // bσ(ln(RMSSD)) trend
    const varSlope = linfit(
      xs,
      pts.map((p) => p.lnVar)
    ).slope; // bs²(ln(RMSSD)) trend
    const meanSlope = linfit(
      xs,
      pts.map((p) => p.lnMean)
    ).slope;

    // classify per Li/Kiyono direction (thresholds in ln-units per hour)
    let cls, sev;
    if (sdSlope < -0.015) {
      cls = 'Stabilizing — progressive autonomic stabilization (favourable)';
      sev = 'good';
    } else if (sdSlope > 0.015) {
      cls = 'Rising instability — persistent autonomic instability (glycemic-risk signal)';
      sev = 'bad';
    } else {
      cls = 'Flat — no clear nocturnal trend';
      sev = 'warn';
    }

    return {
      nWindows: windows.length,
      sigma_lnRMSSD_slope: +sdSlope.toFixed(4), // bσ(ln(RMSSD))
      var_lnRMSSD_slope: +varSlope.toFixed(4), // bs²(ln(RMSSD))
      mean_lnRMSSD_slope: +meanSlope.toFixed(4),
      classification: cls,
      severity: sev,
      series: pts.map((p) => ({ tMin: p.tMin, lnSD: +p.lnSD.toFixed(3), lnMean: +p.lnMean.toFixed(3), n: p.n }))
    };
  }

  /* ── Surge-density escalation: does CVHR cluster later in the night?
        (Li/Kiyono note this escalation IS the HRV-instability signature.) ──

     MEASURED AGAINST THE DEVICE LABEL, AND FLAT (ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS §4,
     2026-07-31). Correlated against the CPAP's own device-scored `residualAHI` over the same 39
     paired nights that validated `cpcHfc`: **r = −0.095, 95 % CI [−0.398, +0.228], p = 0.56**,
     Spearman −0.096. It does not track apnea burden.

     That is NOT a refutation of what this function claims. It measures whether CVHR surges cluster
     toward the end of the night — a TIMING/instability trend, not a burden estimate — and nothing
     here ever asserted a link to AHI. The measurement is recorded because the metric sits in the
     `apnea` export block beside `cvhrIndex` and `cpc`, which is exactly the context that invites a
     reader to assume it is an apnea marker and promote it on that assumption. It is not one, on the
     only independent label this suite has.

     Tier stays `experimental` — unchanged, because the tier was never resting on an AHI claim.
     Re-run: `node tools/ecg-apnea-correlate.mjs --cpap <cpap-corpus.json>` (the harness reproduces
     §9's four published correlations as controls on every run). */
  function surgeEscalation(cvhrEvents, durSec) {
    if (!cvhrEvents || cvhrEvents.length < 4 || durSec < 90 * 60) return null;
    const third = durSec / 3;
    const counts = [0, 0, 0];
    for (const e of cvhrEvents) {
      const k = Math.min(2, Math.floor(e.sec / third));
      counts[k]++;
    }
    const perHour = counts.map((c) => +(c / (third / 3600)).toFixed(1));
    const escal = perHour[0] > 0 ? +(((perHour[2] - perHour[0]) / perHour[0]) * 100).toFixed(0) : perHour[2] > 0 ? 100 : 0;
    return {
      perHourThirds: perHour,
      escalationPct: escal,
      label: escal > 40 ? 'Surge density escalates overnight — instability signature' : escal < -20 ? 'Surge density eases overnight' : 'Surge density roughly stable'
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CARDIORESPIRATORY COUPLING  (EDR ⟷ RR) — three zero-new-sensor metrics,
  //  all derived from the SAME raw ECG already in hand:
  //    · rsaEfficiencyRatio  — inspiratory:expiratory HR ratio across the
  //      respiratory cycle (Border et al. 2025, arXiv:2507.00597 — RSA minimises
  //      cardiac power; efficient hearts raise HR ~1.5× on inspiration).
  //    · crcPLV              — phase-locking value between the RR oscillation and
  //      the EDR respiration (model-free CRC strength, arXiv:2508.00773). [0..1]
  //    · couplingStrength    — CSI-style single-number cardiorespiratory-sync
  //      index (arXiv:2605.18802), a PLV/RSA composite. [0..1]
  //  EDR = R-peak amplitude modulation (the chest sensor's electrical axis swings
  //  with lung volume). No airflow, no PPG, no extra hardware — just the ECG.
  // ════════════════════════════════════════════════════════════════════════
  function _detrendMov(x, win) {
    const half = win >> 1,
      N = x.length,
      o = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let a = 0,
        c = 0;
      for (let k = -half; k <= half; k++) {
        const u = i + k;
        if (u >= 0 && u < N) {
          a += x[u];
          c++;
        }
      }
      o[i] = x[i] - a / c;
    }
    return o;
  }
  function _interpGrid(xs, ys, grid) {
    const N = xs.length,
      M = grid.length,
      o = new Float64Array(M);
    let j = 0;
    for (let i = 0; i < M; i++) {
      const g = grid[i];
      while (j < N - 2 && xs[j + 1] < g) j++;
      const x0 = xs[j],
        x1 = xs[j + 1],
        y0 = ys[j],
        y1 = ys[j + 1];
      const f = x1 > x0 ? (g - x0) / (x1 - x0) : 0;
      o[i] = y0 + (y1 - y0) * Math.max(0, Math.min(1, f));
    }
    return o;
  }
  function _maHalf(x, half) {
    const N = x.length,
      o = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let a = 0,
        c = 0;
      for (let k = -half; k <= half; k++) {
        const u = i + k;
        if (u >= 0 && u < N) {
          a += x[u];
          c++;
        }
      }
      o[i] = a / c;
    }
    return o;
  }
  // resp-band band-pass (~0.1–0.4 Hz) as a difference of moving averages
  function _bandResp(x, fs) {
    const hi = _maHalf(x, Math.max(1, Math.round(0.3 * fs))); // drop > ~0.4 Hz
    const lo = _maHalf(x, Math.max(2, Math.round(2.0 * fs))); // drop < ~0.1 Hz
    const o = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) o[i] = hi[i] - lo[i];
    return o;
  }
  // narrowband instantaneous phase via quadrature: for x≈A·cos φ, sin φ ≈ −ẋ/ω₀
  function _narrowPhase(x, fs, f0) {
    const w0 = 2 * Math.PI * Math.max(0.05, f0),
      N = x.length,
      ph = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const xm = i > 0 ? x[i - 1] : x[i],
        xp = i < N - 1 ? x[i + 1] : x[i];
      const dx = ((xp - xm) * fs) / 2; // central-difference derivative
      ph[i] = Math.atan2(-dx / w0, x[i]);
    }
    return ph;
  }
  function cardiorespCoupling(nn, tt, int16, refIdx, fs, respHint, epochs) {
    const n = nn.length;
    if (n < 60 || !refIdx || refIdx.length < n) return null;
    // 1) EDR — R-peak amplitude per beat (local max of raw signal at the refined peak)
    const amp = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const c = Math.round(refIdx[k]);
      let hi = -Infinity;
      for (let j = Math.max(0, c - 2); j <= Math.min(int16.length - 1, c + 2); j++) if (int16[j] > hi) hi = int16[j];
      amp[k] = isFinite(hi) ? hi : 0;
    }
    const edr = _detrendMov(amp, 40); // remove posture/drift → respiration modulation
    const hrAbs = new Float64Array(n);
    for (let k = 0; k < n; k++) hrAbs[k] = 60000 / nn[k];
    const hrR = _detrendMov(hrAbs, 40); // resp-band HR oscillation (RSA)
    // 2) resample EDR · HRresp · HRabs onto a uniform 4 Hz grid
    const FS = 4,
      t0 = tt[0],
      t1 = tt[n - 1];
    /* REFUSE an implausible SPAN — the SIBLING of detectCVHR's guard (#1800), missed when that fix
       landed because the instance was fixed, not the class. `tt` is the gap-ACCUMULATED beat-time
       axis, so one in-file sensor-clock rebase stretches it arbitrarily: measured 2026-08-23 (H10,
       raw line 1316), the sensor stamp jumps +2792 DAYS ten seconds in, making t1−t0 = 241,259,871 s.
       M would be 965 million and every Float64Array below ~7.7 GB — external memory, invisible to
       V8's heap cap, so the process dies by cgroup/kernel OOM with no stack (>50 GB observed before
       any bound). detectCVHR REFUSED this night correctly while this sibling three calls later
       killed the fold. Same bound, same reason; `null` is this function's established refusal shape
       (the M<16 path below) and every consumer already handles it. The only other span-to-grid
       consumer of `tt` is detectCVHR itself — `beatConfidence` is safe by construction (sample-index
       seconds, bounded by count). */
    if (!isFinite(t1 - t0) || t1 - t0 > CVHR_MAX_SPAN_S) return null;
    const M = Math.max(16, Math.floor((t1 - t0) * FS));
    if (M < 16) return null;
    const grid = new Float64Array(M);
    for (let i = 0; i < M; i++) grid[i] = t0 + i / FS;
    const edrU = _interpGrid(tt, edr, grid);
    /* CPC needs the UNDETRENDED series. `edr`/`hrR` above are `_detrendMov(x, 40)` — a 40-BEAT moving
       high-pass, ~48 s at a 50 bpm sleep rate — and `edrB`/`hrB` below are `_bandResp`, which by its
       own comment drops everything under ~0.1 Hz. Measured retention through those filters:
                          detrendMov(40)   _bandResp
         VLFC 0.006 Hz          14 %           0 %
         LFC  0.012 Hz          48 %           0 %
         LFC  0.020 Hz          98 %           1 %
         HFC  0.250 Hz          98 %         101 %
       So the existing coupling grids destroy LFC — the apnea signature CPC exists to measure — and
       VLFC entirely. Building CPC on them would report LFC ≈ 0 on every night and look like a clean
       negative result. That is the same failure as `lfhf` being structurally blind to the VLF band
       (DEEP-STAGE-DESAT-CONFOUND §8.3), caught before shipping this time rather than after.
       `hrAbsU` is already the raw HR on this grid; the raw R-amplitude needs its own interpolation. */
    const edrRawU = _interpGrid(tt, amp, grid);
    const hrU = _interpGrid(tt, hrR, grid);
    const hrAbsU = _interpGrid(tt, hrAbs, grid);
    const edrB = _bandResp(edrU, FS),
      hrB = _bandResp(hrU, FS);
    // 3) respiration rate measured DIRECTLY from the EDR band (dominant period via
    // autocorrelation), not echoed from the Lomb hint. Center the phase analysis on it.
    const edrPeriod = _autocorrPeriod(edrB, FS, 2.5, 10);
    /* 🔴 REFUSE, DO NOT SUBSTITUTE (FOLLOWUPS §1.10, from §1.5's adjudication). This read
         `edrPeriod ? 60/edrPeriod : (respHint in 6..24 ? respHint : 15)`
       — two substitutions stacked behind a surfaced number, neither marked. The second is a bare
       CONSTANT 15, and §1.5 measured what that constant is worth: over 22 co-recorded CPAP nights a
       flat 15.0 br/min scores MAE 0.80 against the device's own RespRate while the estimator scores
       1.90, so the fallback OUTPERFORMS the measurement it stands in for — which is precisely why a
       reader must be able to tell them apart, and could not: §1.5 had to detect fallback nights by
       testing `=== 15.0`, which cannot separate a genuine 15.0 from the constant.
       The FIRST substitution is worse than unmarked, it is self-contradictory: the comment two lines
       up says this rate is "measured DIRECTLY from the EDR band … not echoed from the Lomb hint",
       and the fallback echoes exactly that hint. A method's stated independence cannot hold only on
       the nights it succeeds.
       So: no dominant EDR period ⇒ **null with a reason**, the house rule (#2044 artifact refusal,
       #2052 named refusals). Consumers already null-guard the export; the app surfaces are fixed in
       the same change to print the reason instead of a number. */
    const respFromEDR = edrPeriod ? +(60 / edrPeriod).toFixed(1) : null;
    const respFromEDRReason = edrPeriod ? null : 'no dominant EDR period in the 2.5–10 s search band — respiration not recoverable from R-peak amplitude on this record';
    /* `f0` is an ANALYSIS CENTERING FREQUENCY for the narrow-band phase extraction below, not a
       surfaced quantity: 0.25 Hz keeps the PLV/coupling path running when the rate is unknown, as it
       already did for an out-of-range rate. It is deliberately NOT nulled here — that would silently
       change crcPLV/couplingStrength, a different metric with its own grade, inside a unit about the
       breath rate. ⚠️ Whether a PLV computed at an ASSUMED centre is itself quotable is a real
       question and is filed as FOLLOWUPS §1.11, not answered here. */
    const f0 = respFromEDR != null && respFromEDR >= 6 && respFromEDR <= 24 ? respFromEDR / 60 : 0.25;
    const phE = _narrowPhase(edrB, FS, f0),
      phH = _narrowPhase(hrB, FS, f0);
    // windowed PLV — averaged over 60 s windows so slow respiratory-frequency drift
    // (the resp rate wanders all night) doesn't wash out a real phase-lock.
    const wN = Math.max(16, Math.round(60 * FS)),
      wStep = Math.max(8, Math.round(30 * FS));
    const localPLV = (s, e) => {
      let r2 = 0,
        i2 = 0,
        c = 0;
      for (let i = s; i < e; i++) {
        const d = phH[i] - phE[i];
        r2 += Math.cos(d);
        i2 += Math.sin(d);
        c++;
      }
      return c ? Math.sqrt(r2 * r2 + i2 * i2) / c : 0;
    };
    let plvAcc = 0,
      plvCnt = 0,
      bestPLV = -1,
      bestS = 0;
    for (let s = 0; s + wN <= M; s += wStep) {
      const lp = localPLV(s, s + wN);
      plvAcc += lp;
      plvCnt++;
      if (lp > bestPLV) {
        bestPLV = lp;
        bestS = s;
      }
    }
    const plv = plvCnt ? plvAcc / plvCnt : 0;
    // 4) RSA amplitude = robust peak-to-trough of the resp-band HR oscillation (the RSA itself),
    // drift- and polarity-proof. Efficiency ratio = inspiratory:expiratory HR (Border 2025).
    const meanHRabs = mean(Array.from(hrAbsU));
    const hrBarr = Array.from(hrB);
    const rsaAmp = Math.max(0, quant(hrBarr, 0.92) - quant(hrBarr, 0.08));
    const rsaRatio = meanHRabs - rsaAmp / 2 > 0 ? (meanHRabs + rsaAmp / 2) / (meanHRabs - rsaAmp / 2) : 1;
    const rsaAmpNorm = Math.min(1, rsaAmp / (0.1 * meanHRabs || 1));
    const couplingStrength = Math.max(0, Math.min(1, 0.65 * plv + 0.35 * rsaAmpNorm));
    // phase-averaged HR over the BEST-coherence 60 s window (a clean RSA loop for the chart)
    const NB = 16;
    const binSum = new Float64Array(NB),
      binN = new Float64Array(NB);
    for (let i = bestS; i < Math.min(M, bestS + wN); i++) {
      let ph = phE[i] % (2 * Math.PI);
      if (ph < 0) ph += 2 * Math.PI;
      const b = Math.min(NB - 1, Math.floor((ph / (2 * Math.PI)) * NB));
      binSum[b] += hrAbsU[i];
      binN[b]++;
    }
    const phaseCurve = [];
    for (let b = 0; b < NB; b++) {
      phaseCurve.push(binN[b] >= 2 ? +(binSum[b] / binN[b]).toFixed(1) : null);
    }
    // 5) per-epoch PLV (windowed) — drops during CVHR/apnea clusters → CVHR confidence channel
    const epochCRC = [];
    if (epochs && epochs.length) {
      for (const e of epochs) {
        const w0 = e.tMin * 60,
          w1 = w0 + 300;
        const s0 = Math.max(0, Math.round((w0 - grid[0]) * FS)),
          s1 = Math.min(M, Math.round((w1 - grid[0]) * FS));
        if (s1 - s0 < wN) {
          continue;
        }
        let acc = 0,
          cnt = 0;
        for (let s = s0; s + wN <= s1; s += wStep) {
          acc += localPLV(s, s + wN);
          cnt++;
        }
        if (cnt) epochCRC.push({ tMin: e.tMin, plv: +(acc / cnt).toFixed(3) });
      }
    }
    // CPC on the RAW grids (see the edrRawU note) — never on edrB/hrB, which retain 0-22 % of LFC.
    const cpc = _cpc(hrAbsU, edrRawU, FS);
    return {
      cpc,
      respFromEDR,
      respFromEDRReason,
      rsaEfficiencyRatio: +rsaRatio.toFixed(2),
      rsaAmplitudeBpm: +rsaAmp.toFixed(1),
      crcPLV: +plv.toFixed(3),
      couplingStrength: +couplingStrength.toFixed(3),
      phaseCurve,
      nbins: NB,
      nGrid: M,
      epochCRC,
      plvDuringSurges: null,
      plvBaseline: null
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CVHR — Cyclic Variation of Heart Rate (apnea autonomic signature).
  //  Detect dips/cycles in the per-second HR envelope with 20–60 s period and
  //  the characteristic bradycardia→tachycardia rebound. Returns events + index.
  // ════════════════════════════════════════════════════════════════════════
  // Upper bound on a beat series' span before a consumer refuses to resample it onto a uniform
  // grid — TWO consumers: `detectCVHR` (the #1800 refusal below) and `cardiorespCoupling` (the
  // sibling guard added after 2026-08-23's +2792-day sensor rebase OOM-killed the fold there).
  // 48 h — over twice any real recording, so a gappy night still fits.
  const CVHR_MAX_SPAN_S = 48 * 3600;
  // `activeSec` (OPTIONAL, added LAST for back-compat per CLAUDE.md §🧪) is the beat-COVERED time
  // the caller measured (nnRes.activeSec — inter-beat deltas ≤ GAP_S summed); when it is > 0 it is
  // the index denominator instead of the wall span. See the "events per hour" comment at the bottom.
  function detectCVHR(nn, tt, activeSec) {
    const N = nn.length;
    /* REFUSE (§2.6). `index: 0` IS the exported `cvhrIndex`, and 0 reads as "we looked for cyclic
       variation and there was none" — a clinically meaningful negative — when the truth is that
       fewer than 60 beats cannot carry a 20–60 s cycle at all. `events` stays [] because "no events
       found" is honest for a list; the INDEX is the claim that has to refuse. */
    if (N < 60) return { events: [], index: null, hrSeries: [] };
    // resample instantaneous HR to 1 Hz
    const tEnd = tt[N - 1];
    const M = Math.floor(tEnd);
    /* REFUSE an implausible SPAN (§2.6 again, the upper bound the N<60 guard above does not cover).
       `M` sizes five Float64Arrays AND two `Array.from` copies, and NOTHING bounded it. Measured
       2026-08-23 on a real night: tt[0]=0.023, tt[1]=0.346 — normal beat spacing — but tt[N-1] =
       241,259,871 s (7.6 YEARS), so M = 241,259,871. The typed allocations all SUCCEEDED (external
       memory), and the failure surfaced only at `Array.from(sm)`, which must materialise a PLAIN
       array and blew V8's cap: `RangeError: Invalid array length`, killing the whole ECGDex export
       for that night. Note the diagnostic shape — the series is SANE early and jumps late, i.e. a
       DISCONTINUITY (a fragment stamped far from its neighbours), not a wrong sample rate, which
       would have scaled tt[1] too. So this refuses rather than repairs: we cannot know which
       fragment is right, and a 1 Hz series spanning years is not a thing to resample.
       The bound is 48 h — over twice any real recording, and a heavily-gapped night still fits,
       so it cannot refuse legitimate sparse data. `index: null` because 0 would read as "we looked
       for cyclic variation and found none", the exact fabricated negative §2.6 forbids. */
    if (!isFinite(tEnd) || tEnd > CVHR_MAX_SPAN_S) return { events: [], index: null, hrSeries: [], reason: 'implausible-span' };
    const hr = new Float64Array(M);
    let j = 0;
    for (let s = 0; s < M; s++) {
      while (j < N - 1 && tt[j + 1] < s) j++;
      hr[s] = 60000 / nn[Math.min(j, N - 1)];
    }
    // smooth (5 s) for the display series
    const sm = new Float64Array(M);
    for (let s = 0; s < M; s++) {
      let a = 0,
        c = 0;
      for (let k = -2; k <= 2; k++) {
        const u = s + k;
        if (u >= 0 && u < M) {
          a += hr[u];
          c++;
        }
      }
      sm[s] = a / c;
    }
    // ── apnea-band band-pass (~20–45 s period ≈ 0.022–0.05 Hz) ──
    // wide moving-average (45 s) removes circadian/LF trend; narrow (9 s) removes RSA/HF.
    const ma = (src, half) => {
      const o = new Float64Array(M);
      let acc = 0;
      for (let s = 0; s < M; s++) {
        acc += src[s];
        if (s > 2 * half) acc -= src[s - 2 * half - 1];
        const c = Math.min(s, 2 * half) + 1;
        o[Math.max(0, s - half)] = acc / c;
      }
      // simpler centered pass
      const o2 = new Float64Array(M);
      for (let s = 0; s < M; s++) {
        let a = 0,
          n = 0;
        for (let k = -half; k <= half; k++) {
          const u = s + k;
          if (u >= 0 && u < M) {
            a += src[u];
            n++;
          }
        }
        o2[s] = a / n;
      }
      return o2;
    };
    const lo = ma(sm, 23); // removes < ~0.022 Hz (slow trend)
    const hiCut = ma(sm, 4); // keeps up to ~0.05 Hz, removes RSA
    const res = new Float64Array(M);
    for (let s = 0; s < M; s++) res[s] = hiCut[s] - lo[s]; // apnea-band signal
    // ── envelope (smoothed |res|) → only sustained oscillation trains count as CVHR ──
    const env = new Float64Array(M);
    for (let s = 0; s < M; s++) {
      let a = 0,
        n = 0;
      for (let k = -12; k <= 12; k++) {
        const u = s + k;
        if (u >= 0 && u < M) {
          a += Math.abs(res[u]);
          n++;
        }
      }
      env[s] = a / n;
    }
    const ENV_ON = 2.6; // bpm — sustained-oscillation gate
    // detect dip→rebound cycles ONLY where the envelope says a train is active
    const events = [];
    let lastT = -100;
    for (let s = 8; s < M - 8; s++) {
      if (env[s] < ENV_ON) continue; // not a sustained oscillation → skip (rejects sporadic LF)
      if (res[s] < res[s - 1] && res[s] <= res[s + 1] && res[s] < -2.4) {
        let pk = -Infinity,
          pkAt = -1;
        for (let u = s + 8; u < Math.min(M, s + 48); u++) {
          if (res[u] > pk) {
            pk = res[u];
            pkAt = u;
          }
        }
        const amp = pk - res[s];
        const period = pkAt - s;
        if (amp >= 5 && period >= 14 && period <= 46 && s - lastT > 14) {
          events.push({ sec: s, ampBpm: +amp.toFixed(1), periodSec: period });
          lastT = s;
        }
      }
    }
    /* CVHR index = events per hour OF OBSERVED RECORDING (DEEP-AUDIT-VI F3). This divided by the
       wall span `tEnd` — the gap-folded end stamp — so sensor DEAD TIME sat in the denominator: a
       1.5 h strap-off in a 3 h night halved the shipped index (29.7 → 14.0, reproduced on planted
       physiology that did not change), while meanRR/rMSSD/SDNN beside it correctly ignored the gap.
       Events can only arise in covered seconds (the 1 Hz resample holds the last beat's HR flat
       through a gap, so `res` decays to 0 there and the ENV_ON gate stays shut), so covered time is
       the coherent basis — the same "per hour of analyzable recording" convention OxyDex's ODI
       uses. `activeSec` is what analyze() measured (nnRes.activeSec); absent or 0 it falls back to
       the span, which is exact for a gap-free series (activeSec ≡ tEnd − tt[0] there). `denomSec`
       is returned so a consumer can see the basis rather than infer it. */
    const denomSec = activeSec > 0 ? activeSec : tEnd;
    const hours = denomSec / 3600;
    const index = hours > 0 ? +(events.length / hours).toFixed(1) : 0;
    return { events, index, hrSeries: Array.from(sm), resSeries: Array.from(res), M, denomSec };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PER-EPOCH GROSS-MOTION INDEX from the chest ACC — night-normalised
  //  (median → 0, p95 → 100), null wherever the ACC did not observe the epoch.
  //
  //  SINGLE-SOURCED here on purpose. This was computed inside accExtras' vote
  //  block, behind `if (epochs && stages && stages.length)` — so a motion
  //  observation could only exist once the HRV stager already had an opinion.
  //  That ordering is backwards: motion does not depend on staging, staging
  //  depends on MOTION. Actigraphy is the best-validated wake discriminator
  //  there is, and gating it behind the stager is what kept the single most
  //  useful feature out of the classifier that needed it most.
  // ════════════════════════════════════════════════════════════════════════
  function epochMotion(deviceACC, accFs, ecgT0Ms, durSec, epochs) {
    const fs = accFs || 4;
    if (!deviceACC || !epochs || !epochs.length || deviceACC.length < fs * 30) return null;
    const N = deviceACC.length;
    const vm = new Float64Array(N);
    for (let i = 0; i < N; i++) vm[i] = Math.hypot(deviceACC[i].x, deviceACC[i].y, deviceACC[i].z);
    const baseOffset = ecgT0Ms && deviceACC[0].tsMs ? (deviceACC[0].tsMs - ecgT0Ms) / 1000 : 0;
    const off = baseOffset >= -2 && baseOffset <= durSec ? baseOffset : 0;
    // GROSS motion from jerk (|Δ vector-magnitude|): suppresses the always-present respiratory
    // chest movement + gravity baseline, so only real body movement scores.
    const dmv = new Float64Array(N);
    for (let i = 1; i < N; i++) dmv[i] = Math.abs(vm[i] - vm[i - 1]);
    const rawMot = [];
    for (const e of epochs) {
      const s0 = Math.round((e.tMin * 60 - off) * fs),
        s1 = Math.round((e.tMin * 60 + 300 - off) * fs);
      let a = 0,
        c = 0;
      for (let i = Math.max(1, s0); i < Math.min(N, s1); i++) {
        // A NON-FINITE sample is a HOLE, not a reading — it lowers COVERAGE, never enters the mean.
        // See the sibling accumulator in accExtras for why holes exist at all.
        const d = dmv[i];
        if (!Number.isFinite(d)) continue;
        a += d;
        c++;
      }
      // null (not 0) when the ACC covered less than 30 s of the epoch: "no accelerometer observed
      // this window" is not "the body was still".
      rawMot.push({ tMin: e.tMin, act: c > fs * 30 ? a / c : null });
    }
    const actVals = /** @type {number[]} */ (rawMot.filter((m) => m.act != null).map((m) => m.act)).slice().sort((a, b) => a - b);
    if (!actVals.length) return null;
    const qOf = (p) => actVals[Math.min(actVals.length - 1, Math.floor(actVals.length * p))];
    const floor = qOf(0.5),
      span = Math.max(qOf(0.95) - floor, 1e-6); // typical-sleep median → 0, p95 → 100
    const out = new Map();
    for (const m of rawMot) {
      if (m.act == null) continue;
      out.set(m.tMin.toFixed(1), +Math.max(0, Math.min(100, ((m.act - floor) / span) * 100)).toFixed(1));
    }
    return out;
  }

  // Night-relative quantile with an ABSOLUTE FLOOR. A purely relative gate always fires somewhere —
  // it would MANUFACTURE the stage it is gating on a night that genuinely lacks it — and a purely
  // absolute one cannot fire at all on a subject whose whole distribution sits below it. Both
  // failure modes are real: `lfhf > 2.2` (absolute) returned REM = 0 min across a healthy 6.3 h
  // night whose epoch-median LF/HF was 1.62. So: the night's own percentile, but never below a
  // physiological floor.
  function _relGate(vals, p, absFloor) {
    const v = vals
      .filter((x) => Number.isFinite(x))
      .slice()
      .sort((a, b) => a - b);
    if (!v.length) return absFloor;
    const q = v[Math.min(v.length - 1, Math.floor(v.length * p))];
    return Math.max(q, absFloor);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CARDIORESPIRATORY SLEEP STAGING (HRV + actigraphy, simplified).
  //  Per-epoch features → Wake / REM / Light(N1-N2) / Deep(N3) with smoothing.
  //  `motionByTMin` is optional: HRV-only staging stays the fallback for a
  //  recording with no chest ACC, so this is additive, never a regression.
  // ════════════════════════════════════════════════════════════════════════
  function stageSleep(epochs, motionByTMin) {
    if (!epochs.length) return [];
    const rmAll = epochs.map((e) => e.rmssd);
    const hrAll = epochs.map((e) => e.hr);
    const rmMed = median(rmAll),
      hrMed = median(hrAll),
      hrSd = std(hrAll) || 1;
    // REM's LF/HF gate, night-relative with a floor (see _relGate). 0.65 keeps the candidate pool
    // near the physiological REM share before the RMSSD half of the conjunction narrows it further.
    const lfhfGate = _relGate(
      epochs.map((e) => e.lfhf),
      0.65,
      1.0
    );
    const mot = (e) => (motionByTMin ? motionByTMin.get(e.tMin.toFixed(1)) : undefined);
    const raw = epochs.map((e) => {
      const hrZ = (e.hr - hrMed) / hrSd;
      const lfhf = e.lfhf;
      const m = mot(e);
      let stage;
      /* ORDER MATTERS MORE THAN ANY THRESHOLD HERE (REM-STAGING-REDESIGN §4c).
         REM and Wake share their HRV signature — elevated HR, suppressed RMSSD — so a Wake branch
         tested FIRST swallows REM wholesale. Measured against planted truth: 9 of 9 REM epochs were
         classified Wake, and no threshold change could fix it because the Wake rule fired before the
         REM rule was ever reached.
         The discriminator is the SPECTRUM: REM is sympathetically dominant (planted LF/HF 2.43) while
         deep sleep is not (0.63). That only became usable once the generator's Mayer wave was a real
         0.1 Hz oscillation instead of a VLF low-pass — before that every stage measured ~0.1 and the
         gate could not fire at all.
         Motion is the VETO, not the detector: REM is atonic, so gross movement rules it out, but
         stillness alone cannot distinguish REM from lying awake perfectly still. */
      // Gross body movement — awake, whatever the spectrum says. Atonia makes this incompatible with REM.
      if (m != null && m >= 60) stage = 'Wake';
      // SPECTRUM-LED REM, ahead of the HRV-only wake heuristic, vetoed by any real movement.
      // `m == null` (no accelerometer observed this epoch) does NOT veto: absence of an observation is
      // not evidence of stillness OR of movement, and refusing REM there would reinstate the old
      // Wake-swallows-REM behaviour on every ACC-less recording.
      else if (lfhf > lfhfGate && e.rmssd < rmMed * 0.85 && !(m != null && m >= 35)) stage = 'REM';
      else if (hrZ > 1.1 || e.rmssd < rmMed * 0.45) stage = 'Wake';
      else if (e.rmssd > rmMed * 1.12 && e.hr < hrMed) stage = 'Deep';
      else stage = 'Light';
      return stage;
    });
    // SMOOTH — but never over a minority stage. This was an unconditional despiker (replace any
    // epoch its two neighbours outvote), and against a series where one class dominates that is not
    // a denoiser, it is an eraser: Light held 290 of 330 min on the night this was found, so every
    // isolated REM epoch was overwritten by construction. Measured there: two epochs satisfied the
    // full REM rule and the smoother deleted both, reporting REM = 0 min.
    // At a 5-min grid a single epoch IS a legitimate REM or Deep bout (real bouts run 5-25 min), so
    // the minority stages are exempt; Wake/Light singletons — the genuinely noisy pair — still get
    // smoothed. (A proper minimum-bout-length rule wants a finer grid; that is separate work.)
    const order = { Wake: 3, REM: 2, Light: 1, Deep: 0 };
    const sm = raw.slice();
    for (let i = 1; i < raw.length - 1; i++) {
      if (raw[i - 1] === raw[i + 1] && raw[i] !== raw[i - 1] && (raw[i] === 'Light' || raw[i] === 'Wake')) sm[i] = raw[i - 1];
    }
    /* MINIMUM REM BOUT — DESIGNED, MEASURED, AND DELIBERATELY NOT SHIPPED (§4c, the (b) half).
       The idea is sound: a real REM period runs 5-25 min, so a single isolated epoch is more likely
       quiet wakefulness, which shares REM's whole signature and which nothing in this stack separates
       from REM directly. Implemented as "an isolated REM epoch demotes to Light" it is INERT on the
       synthetic (bouts there are 3, 5 and 3 epochs) — and it took REM from 10 min to ZERO on the real
       2026-07-27 night, because there the only two candidates are isolated singletons (epoch 11 and
       epoch 64 of 77).
       That is not the guard misbehaving, it is the guard having nothing to guard: on real data the REM
       DETECTOR still under-selects — 26 epochs clear the LF/HF gate, 10 clear the RMSSD gate, and the
       conjunction of the two yields 2. A bout rule cannot help a detector that never produces a bout,
       and suppressing the little signal there is would trade a visible under-count for a silent zero.
       So it waits for the weighted-score detector (brief §3). Recorded here rather than in a branch
       nobody reads, because the measurement is the reason. */
    return epochs.map((e, i) => ({ tMin: e.tMin, stage: sm[i], y: order[sm[i]] }));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  GANGLIOR EVENTS — emit canonical bus events.
  //  conf = EVENT LIKELIHOOD (scaled to CVHR surge magnitude); sqi = local signal
  //  quality, emitted SEPARATELY so the fusion layer can weight likelihood by
  //  quality instead of conflating the two (R7). Older consumers that read only
  //  `conf` still get a sensible, severity-bearing number.
  // ════════════════════════════════════════════════════════════════════════
  function gangliorEvents(cvhr, stages, t0Ms, sqi, times, epochPos, movementSecs) {
    const events = [];
    // Clock Contract §2.6: a missing anchor must be VISIBLE (null), never fabricated.
    // No t0 → emit t:null / tMs:null (date-unknown) so the export's startEpochMs:null and
    // the events agree; deterministic (two exports of the same stampless file match).
    const hasT0 = t0Ms != null;
    const clock = (sec) => {
      if (!hasT0) return null;
      const d = new Date(t0Ms + sec * 1000);
      const _p = (x) => String(x).padStart(2, '0');
      return _p(d.getUTCHours()) + ':' + _p(d.getUTCMinutes()) + ':' + _p(d.getUTCSeconds());
    };
    // absolute floating wall-clock ms per event (Clock Contract §6 "new emitters SHOULD write tMs"); null when stampless.
    const tmsAt = (sec) => (hasT0 ? t0Ms + Math.round(sec * 1000) : null);
    // body position at a given second: the covering 5-min epoch's posture (companion ACC).
    // null when no ACC was loaded, so consumers can distinguish 'no data' from 'unknown posture'.
    const posAt = (sec) => {
      if (!epochPos || !epochPos.length) return null;
      const m = sec / 60;
      let best = null,
        bd = Infinity;
      for (const p of epochPos) {
        const d = Math.abs(p.tMin + 2.5 - m);
        if (m >= p.tMin && m < p.tMin + 5) {
          return p.position;
        }
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best ? best.position : null;
    };
    // local SQI near a time
    const sqiAt = (sec) => {
      // nearest beat
      let lo = 0,
        hi = times.length - 1,
        best = 0;
      for (let k = 0; k < times.length; k++) {
        if (Math.abs(times[k] - sec) < Math.abs(times[best] - sec)) best = k;
      }
      // average SQI of a 10 s window
      let a = 0,
        c = 0;
      for (let k = 0; k < times.length; k++) {
        if (Math.abs(times[k] - sec) < 5) {
          a += sqi[k];
          c++;
        }
      }
      return c ? a / c : sqi[best] || 0.5;
    };
    // CVHR surge magnitude → likelihood. Amplitudes run ~6–22 bpm; map monotonically
    // into 0.45–0.95 so a strong cyclic surge scores higher than a weak one. SQI no
    // longer leaks into conf — it rides alongside as its own field.
    const surgeConf = (ampBpm) => +Math.max(0.45, Math.min(0.95, 0.45 + Math.min(ampBpm || 0, 24) / 48)).toFixed(2);
    /* ── WHICH INSTANT THIS STAMPS (POOLED-CLOCK-FIT-FOLLOWUPS §6.2) ────────────────────────────
       `t`/`tMs` are the **bradycardia TROUGH** — the local minimum of the HR residual that OPENS a
       cyclic-variation cycle. The tachycardic rebound this event is named for occurs `periodSec`
       LATER, at the residual maximum; `detectCVHR` finds both (`s` and `pkAt`) and stamps `s`.

       That is the right convention — the bradycardia is the diagnostic feature of CVHR, and moving
       the stamp now would change a published event's `t` for every consumer. But nothing said so,
       and the cost of that silence was measured: `autonomic_surge → movement_onset` came out
       BIMODAL at +10 s / −20 s with a hole at simultaneity (10 of 992 deltas within ±5 s, 1.0 %),
       which POOLED-CLOCK-FIT-FOLLOWUPS §1 could not explain after rejecting three hypotheses.
       Re-measuring against trough+`periodSec` collapses it to ONE mode with 330 of 915 inside ±5 s
       (36.1 %) — a 36× improvement. The structure was the fiducial, not physiology.

       `periodSec` was always exported, so the information was technically present; what was missing
       was any statement of what the stamp meant. `peakTMs` now publishes the rebound instant
       directly, as a NEW meta field so no existing consumer changes: use `tMs` for the cycle's
       start and `peakTMs` for the autonomic surge itself, and say which one a latency is measured
       against. */
    for (const ev of cvhr.events) {
      events.push({
        t: clock(ev.sec),
        tMs: tmsAt(ev.sec),
        impulse: 'autonomic_surge',
        node: 'ECGDex',
        _sec: ev.sec, // internal: enables late-ACC position re-stamp (stripped on export)
        conf: surgeConf(ev.ampBpm),
        sqi: +sqiAt(ev.sec).toFixed(2),
        meta: {
          ampBpm: ev.ampBpm,
          periodSec: ev.periodSec,
          // The tachycardic rebound — the instant the event's NAME refers to. `tMs` is the trough
          // that opens the cycle; see the block above for why they are not the same and why that
          // silently bimodalised every cross-channel latency measured against this channel.
          peakTMs: ev.periodSec != null ? tmsAt(ev.sec + ev.periodSec) : null,
          position: posAt(ev.sec), // supine posture worsens OSA → fusion can weight osaConf/AHI
          osaLabel: null,
          osaConf: null, // reserved: Almarshad 2026 transformer (Phase 2)
          deltaSBP: null
        }
      }); // reserved: BioZDex fusion
    }
    // sleep stage transitions as lower-priority events (model confidence, quality-neutral)
    let prev = null;
    for (const s of stages) {
      if (s.stage !== prev) {
        events.push({ t: clock(s.tMin * 60), tMs: tmsAt(s.tMin * 60), impulse: 'stage_' + s.stage.toLowerCase(), node: 'ECGDex', conf: 0.7, sqi: null, meta: {} });
        prev = s.stage;
      }
    }
    // stable order: by relative seconds when stampless (t is null), else by clock string.
    /* movement_onset — the chest-ACC arousal fiducial (see accExtras). Emitted here so it rides the
       same chronological sort as every other impulse: the export contract is ordered, and appending a
       whole kind after the sort is exactly how a block once landed out of order. */
    if (movementSecs && movementSecs.length) {
      for (const sec of movementSecs)
        events.push({
          t: clock(sec),
          tMs: tmsAt(sec),
          impulse: 'movement_onset',
          node: 'ECGDex',
          _sec: sec,
          conf: 0.6,
          sqi: null,
          meta: { streams: ['acc'], site: 'chest' }
        });
    }
    events.sort((a, b) => (a.tMs != null && b.tMs != null ? a.tMs - b.tMs : /** @type {any} */ (a.t) < /** @type {any} */ (b.t) ? -1 : 1));
    return events;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ACTIVITY-GATED MODE CLASSIFIER  (AMBULATORY-MODE-BRIEF §1)
  //  The mode decision must consult the activity/gait/ACC evidence the node ALREADY
  //  computes — a high-motion daytime walk must NOT fall through a duration/time-of-day
  //  heuristic into "overnight" and unlock sleep-only analyses. Activity WINS: when
  //  sustained gait or ACC-wake dominates, the recording is `ambulatory` and the
  //  duration/time heuristic cannot override it. Low-activity records keep the existing
  //  overnight / nap / short-reading classes. Decision is recorded transparently in modeWhy.
  // ════════════════════════════════════════════════════════════════════════
  function classifyMode(durSec, t0Ms, accEx, longRec) {
    const durMin = durSec / 60;
    const _p = (x) => String(x).padStart(2, '0');
    let clockStr = '—';
    // floating wall-clock → read with UTC getters (Clock Contract §5) so time-of-day is
    // viewer-timezone-independent.
    if (t0Ms != null) {
      const d = new Date(t0Ms);
      clockStr = _p(d.getUTCHours()) + ':' + _p(d.getUTCMinutes());
    }

    // ── activity evidence (all from ACC the node already computes) ──
    let steps = 0,
      briskPct = 0,
      cadencePresentPct = 0,
      accWakePct = null;
    const gait = accEx && accEx.gait;
    if (gait && gait.walking) {
      steps = gait.totalSteps || 0;
      if (gait.zonePct) briskPct = gait.zonePct.filter((z) => z.zone === 'Brisk walk' || z.zone === 'Vigorous').reduce((s, z) => s + (z.pct || 0), 0);
      if (gait.cadEpochs && gait.cadEpochs.length) {
        const act = gait.cadEpochs.filter((c) => c.cadence >= 20).length; // ≥20 steps/min epoch = ambulatory
        cadencePresentPct = Math.round((act / gait.cadEpochs.length) * 100);
      }
    }
    const cons = accEx && accEx.consensus;
    if (cons && cons.voteRows && cons.voteRows.length) {
      const w = cons.voteRows.filter((v) => v.vote === 'Wake (motion)').length; // sleepStageConsensus ACC vote
      accWakePct = Math.round((w / cons.voteRows.length) * 100);
    }

    // sustained activity → ambulatory. The duration/time-of-day heuristic CANNOT override this.
    const sustainedGait = steps >= 500 && cadencePresentPct >= 30;
    const accWakeDominant = accWakePct != null && accWakePct >= 75;
    const ambulatory = sustainedGait || accWakeDominant;

    // auditable activity scalar 0..1 (any strong channel saturates it)
    const sStep = Math.min(1, steps / 2500);
    const sBrisk = Math.min(1, briskPct / 20);
    const sCad = Math.min(1, cadencePresentPct / 50);
    const sWake = accWakePct != null ? Math.min(1, accWakePct / 85) : 0;
    const activityScore = +Math.max(sStep, sBrisk, sCad, sWake).toFixed(2);

    let mode, modeLabel, modeWhy, modeConf;
    if (ambulatory) {
      mode = 'ambulatory';
      modeLabel = '🚶 Ambulatory';
      const bits = [];
      if (steps) bits.push('gait ' + steps + ' steps' + (briskPct ? ', ' + briskPct + '% brisk' : ''));
      if (accWakePct != null) bits.push('ACC-wake ' + accWakePct + '%');
      modeWhy = 'ambulatory: ' + (bits.join('; ') || 'sustained motion') + ' — overnight veto';
      modeConf = Math.round(Math.max(0.7, activityScore) * 100);
    } else if (longRec) {
      mode = 'overnight';
      modeLabel = '🌙 Overnight';
      modeWhy = (durMin / 60).toFixed(1) + ' h from ' + clockStr;
      modeConf = 90;
    } else if (durMin >= 20) {
      mode = 'nap';
      modeLabel = '😴 Nap';
      modeWhy = Math.round(durMin) + ' min from ' + clockStr;
      modeConf = 80;
    } else {
      mode = 'short-reading';
      modeLabel = '⏱ Short reading';
      modeWhy = Math.round(durMin) + ' min reading';
      modeConf = 80;
    }
    return { mode, modeLabel, modeWhy, modeConf, ambulatory, activityScore, suppressReason: 'high-activity / ambulatory', activity: { steps, briskPct, cadencePresentPct, accWakePct } };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  FULL PIPELINE — orchestrates everything from an Int16 ECG buffer.
  //  onProgress(pct,msg) optional.
  // ════════════════════════════════════════════════════════════════════════
  function analyze(rec, onProgress) {
    const prog = onProgress || (() => {});
    const { int16, fs } = rec;
    prog(8, 'Band-passing 5–15 Hz…');
    const bp = bandpass(int16, fs);
    prog(20, 'Pan-Tompkins R-peak detection…');
    const peaks = detectPeaks(int16, bp, fs);
    if (peaks.length < 12) throw new Error('Too few R-peaks detected — signal may be flat or not ECG.');
    const peaksB = detectPeaksB(bp, fs);
    prog(34, 'Sub-sample peak refinement…');
    const { times, refIdx } = refinePeaks(bp, peaks, fs);
    // DEEP-AUDIT-II §4.2 (#6): fold raw-sample gaps (dropped ECG samples, carried on rec.gaps from the
    // parse) into the beat clock. Beat time is sample-index/fs, which silently UNDER-counts wall-clock
    // across a dropout — so a gappy record would read ~100 % coverage with every later beat time-shifted
    // early. Adding each gap's excess dead-time (Δ − one nominal step) to every beat after it makes the
    // inter-beat interval span the gap, so the existing gap-aware coverage + NN gate see it. A monotonic
    // single pass (peaks are index-ordered). INERT when rec.gaps is empty — the clean-recording,
    // synthetic, and committed-fixture path is byte-identical.
    if (rec.gaps && rec.gaps.length) {
      const step = 1000 / fs;
      const g = rec.gaps.slice().sort((a, b) => a.idx - b.idx);
      let gi = 0,
        deadSec = 0;
      for (let k = 0; k < times.length; k++) {
        while (gi < g.length && g[gi].idx <= refIdx[k]) {
          deadSec += Math.max(0, g[gi].ms - step) / 1000;
          gi++;
        }
        times[k] += deadSec;
      }
    }
    prog(46, 'Per-beat signal-quality scoring…');
    const { sqi, rr, terms: sqiTerms } = computeSQI(int16, fs, peaks, times, peaksB);
    prog(56, 'Gating + NN interpolation…');
    const nnRes = buildNN(times, rr, sqi);
    // TCH-FUSED-ROBUST-HAT: exclude SUSTAINED-artifact windows the per-beat gate misses (a burst of
    // spurious detections passes SQI≥0.30 individually yet is collectively nonsense). beatConfidence
    // fires only where beat-density is an upper outlier AND SQI is depressed (both vs the record's own
    // median) → AF-safe (real fast rhythm keeps clean QRS ⇒ c≈1). c<0.5 = confirmed artifact ⇒ drop, so
    // it no longer inflates RMSSD/SDNN/epochs. Reported as artifactSec.
    const _conf = beatConfidence(peaks, sqi, fs, rec.t0Ms || 0);
    const nn = [],
      tt = [],
      /* Aligned with nn/tt BY CONSTRUCTION. `nnRes.corrected` is the UNFILTERED per-beat flag, and the
         loop below drops low-confidence beats — so exporting nnRes.corrected directly would hand a
         consumer a mask one length and a series another, silently mis-attributing every correction
         after the first drop. Pushed in the same pass instead. */
      nnCorr = [],
      /* Per-beat SQI, aligned with nn/tt the same way and for the same reason. TRIO-ARTIFACT-GATE §1:
         the node computed this and threw it away, so a consumer reading a 118 bpm epoch could not tell
         an artifact burst from a real tachycardia. Pushed in this pass rather than re-derived later —
         `peaks[i]`, `nnRes.nn[i]` and `sqi[i]` share an index only BEFORE the confidence filter below. */
      nnSqi = [],
      /* Per-beat FUSED-HAT CONFIDENCE, aligned with nn/tt the same way and for the same reason.
         `beatConfidence` is already computed here and already drives the c<0.5 drop below — the node
         then discarded the surviving beats' c, which is the one number `analysis-stats.js
         tchSigmasFused(hh, vv, oo, cH, cV, cO)` needs to weight this corner. Without it a consumer
         reading a committed export can only run the UNWEIGHTED hat, so the σ the papers publish
         (fused-weight) was not reproducible from the corpus. Surviving beats span [0.5, 1] by
         construction; a beat below that is not down-weighted, it is gone (and counted in artifactSec). */
      nnConf = [];
    let artifactSec = 0,
      _pSec = null;
    for (let i = 0; i < nnRes.nn.length; i++) {
      const secAbs = Math.floor(((rec.t0Ms || 0) + (peaks[i] / fs) * 1000) / 1000);
      const c = _conf.has(secAbs) ? _conf.get(secAbs) : 1;
      if (c >= 0.5) {
        nn.push(nnRes.nn[i]);
        tt.push(nnRes.tt[i]);
        nnCorr.push(nnRes.corrected[i] ? 1 : 0);
        nnSqi.push(Number.isFinite(sqi[i]) ? sqi[i] : null);
        nnConf.push(Number.isFinite(c) ? +c.toFixed(3) : 1);
      } else if (secAbs !== _pSec) {
        artifactSec++;
        _pSec = secAbs;
      }
    }
    const N = nn.length;
    if (N < 12) throw new Error('Too few clean R-peaks after artifact gating — signal may be all-artifact.');

    prog(64, 'HRV suite…');
    const meanRR = mean(nn),
      sdnn = std(nn),
      rm = rmssd(nn),
      pn = pnn50(nn);
    const hr = +(60000 / meanRR).toFixed(1);
    // Duration = ACTIVE (beat-covered) time, not raw span. Stray beats detected in
    // noise hours after the strap comes off must NOT inflate duration or the tier.
    const spanSec = nnRes.spanSec || tt[N - 1] || 0;
    const durSec = nnRes.activeSec > 0 ? nnRes.activeSec : tt[N - 1] || rec.durSec || (N * meanRR) / 1000;
    const longRec = durSec >= 90 * 60;
    const lowCoverage = nnRes.coveragePct != null && nnRes.coveragePct < 80;

    prog(72, '5-min epoch engine…');
    const epochs = epochEngine(nn, tt, 300, nnSqi);

    // representative window for advanced metrics (epoch with rmssd closest to median)
    let repSeg = nn,
      repT = tt,
      repTMin = null,
      repIdx = null;
    if (epochs.length >= 3) {
      const rmA = epochs.map((e) => e.rmssd),
        rmMed = median(rmA);
      let bi = 0,
        bd = Infinity;
      for (let i = 0; i < rmA.length; i++) {
        const d = Math.abs(rmA[i] - rmMed);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      // rebuild the representative segment beats from tt window
      const w0 = epochs[bi].tMin * 60,
        w1 = w0 + 300,
        seg = [],
        segT = [];
      for (let i = 0; i < N; i++) {
        if (tt[i] >= w0 && tt[i] < w1) {
          seg.push(nn[i]);
          segT.push(tt[i]);
        }
      }
      if (seg.length >= 20) {
        repSeg = seg;
        repT = segT;
        repTMin = epochs[bi].tMin;
        repIdx = bi;
      }
    }

    // aggregate display values (long rec → per-epoch medians)
    let dispRm = +rm.toFixed(1),
      dispSd = +sdnn.toFixed(1),
      dispHr = hr,
      dispPn = +pn.toFixed(1),
      sdann = null,
      sdnnIdx = null;
    if (longRec && epochs.length >= 3) {
      dispRm = +median(epochs.map((e) => e.rmssd)).toFixed(1);
      dispSd = +median(epochs.map((e) => e.sdnn)).toFixed(1);
      dispHr = +median(epochs.map((e) => e.hr)).toFixed(1);
      dispPn = +median(epochs.map((e) => e.pnn)).toFixed(1);
      sdann = +std(epochs.map((e) => e.meanRR)).toFixed(1);
      sdnnIdx = +mean(epochs.map((e) => e.sdnn)).toFixed(1);
    }

    prog(80, 'Spectral (Lomb–Scargle)…');
    // Robust whole-record respiratory-rate scalar = MEDIAN of per-epoch EDR estimates.
    // The single-window HF peak (peakF·60) can latch onto a transient fast-breathing
    // burst and over-report — e.g. 21.3 bpm when the epoch median is 15.3. Compute it
    // ONCE so the long-record spectrum, the short-record representative spectrum, and
    // cardiorespiratory coupling all report the same value. (Also fixes a latent
    // `||[0]` no-op — an empty array is truthy — that risked median([])→NaN.)
    const _respEpoch = epochs.filter((e) => e.resp != null && e.resp > 0).map((e) => e.resp);
    const _respMedian = _respEpoch.length >= 3 ? +median(_respEpoch).toFixed(1) : null;

    let spec;
    if (longRec && epochs.length >= 3) {
      /* ONE TIME SCALE (DEEP-AUDIT-2026-07-11 §10/§11).
       This block used to build hf/lf from the 5-MIN EPOCH MEDIANS and then OVERWRITE tp and vlf with a
       WHOLE-NIGHT Lomb–Scargle. Four numbers shipped side by side in one `hrv.frequency` block on two
       different time scales: on a real 7.26 h night vlf+lf+hf = 5060 ms² while totalPower = 5674 ms² —
       the Task-Force identity broken by 11 % — and two irreconcilable "HF n.u." fell out of the same
       export (ECGDex-native 32.1 vs the HRVDex ingest's 20.4).

       The whole-night transform was also the §11 GRID LOTTERY. Its band split is ill-conditioned: the
       periodogram of a 7 h record has intrinsic resolution 1/T ≈ 3.8e-5 Hz, ~50× finer than the fixed
       grid, so the Riemann sum samples a spiky spectrum at essentially arbitrary points. Changing ONLY
       the bin count swung LF/HF from 1.747 (nf=219) to 2.265 (nf=220, shipped) to 2.51 (nf=221) — a 44 %
       swing on an arbitrary internal constant — and it does not converge. Parseval pins the TOTAL to the
       variance, which is why nobody noticed: it is the SPLIT that floats.

       Both defects die together. Frequency-domain HRV is DEFINED on 5-minute segments (Task Force 1996);
       for a long recording you report the per-segment spectrum. At 5 min the grid is adequate by
       construction (df = 0.0025 Hz is finer than the epoch's own 1/300 s = 0.0033 Hz resolution), so the
       lottery cannot arise — and every band comes from the same transform on the same window.
       tp is DEFINED as the sum of the reported bands, so vlf+lf+hf == tp exactly, by construction. */
      const _med = (k) => Math.round(median(epochs.map((e) => e[k])));
      const _vlf = _med('vlf'),
        _lf = _med('lf'),
        _hf = _med('hf');
      spec = {
        tp: _vlf + _lf + _hf,
        hf: _hf,
        lf: _lf,
        vlf: _vlf,
        /* §5.2 — an epoch with NO HF power now reports lfhf null (it used to fabricate lf/1), so the
           night-level median must DROP those epochs rather than count them. A null epoch leaves the
           denominator; it is not a zero ratio. */
        lfhf: (() => {
          const _lh = epochs.map((e) => e.lfhf).filter((v) => v != null && isFinite(v));
          return _lh.length ? +median(_lh).toFixed(3) : null;
        })(),
        // null, NOT 0 — a respiratory rate of 0 breaths/min is not a measurement, it is a
        // FABRICATED value standing in for "unknown". Same discipline as the Clock Contract's
        // "a missing stamp must be visible (null), never invented" (TCH-REFERENCE-VALIDATION §D2).
        // Downstream is unaffected: cardiorespCoupling's respHint guard (`respHint && 6..24`)
        // already falls back to 15 for BOTH 0 and null.
        respRate: _respMedian,
        window: 'epochMedian5min'
      };
      // (§10/§11: the whole-record `lombScargle(nn, tt, 220)` overwrite of vlf/tp is GONE — it was the
      //  two-scale mix AND the grid lottery. Every band above now comes from the same 5-min transform.)
    } else {
      spec = lombScargle(repSeg, repT, 300);
      // prefer the per-epoch median over the single representative-window HF peak
      if (_respMedian != null) spec.respRate = _respMedian;
    }

    prog(86, 'Non-linear (DFA · SampEn · fragmentation)…');
    const dfa1 = dfaAlpha1(repSeg);
    const sampen = sampEn(repSeg, 2, 0.2 * std(repSeg));
    const triIdx = triangularIndex(nn);
    const dc = prsaCapacity(nn, 1),
      ac = prsaCapacity(nn, -1);
    const frag = fragmentation(nn) || { pip: null, ials: null, pss: null };
    // Poincaré — geometric SD1/SD2 from the exact array that gets plotted.
    // Overnight: use the representative 5-min window (standard short-term Poincaré, norms apply);
    // shorter records: use the whole NN series. Guarantees ellipse == cloud.
    const poincareNN = longRec && repSeg.length >= 20 ? repSeg : nn;
    const pg = poincareGeo(poincareNN);
    /* `.toFixed` on a refusal would throw, and `+null` would silently become 0 — the fabrication
       re-entering one line after the guard that removed it. Carry the null through. */
    const sd1v = pg.sd1 == null ? null : +pg.sd1.toFixed(2),
      sd2v = pg.sd2 == null ? null : +pg.sd2.toFixed(2);

    prog(92, 'CVHR / apnea detection…');
    // Denominator = the same ACTIVE seconds `durSec` is built from (F3): dead time is not observed time.
    const cvhrRaw = detectCVHR(nn, tt, nnRes.activeSec);
    // MOTION BEFORE STAGING (see epochMotion). The chest ACC is parsed and on hand here; computing
    // it after the stager — as this did — is what left the classifier blind to the one feature that
    // most improves it.
    const _epochMot = rec.deviceACC && rec.accFs && rec.deviceACC.length >= rec.accFs * 30 ? epochMotion(rec.deviceACC, rec.accFs, rec.t0Ms, durSec, epochs) : null;
    const stages = longRec ? stageSleep(epochs, _epochMot) : [];

    // ── activity-gated mode (AMBULATORY-MODE-BRIEF §1) ───────────────────────────
    // Consult the activity/gait/ACC evidence ALREADY computed before letting duration/
    // time-of-day unlock sleep-only analyses. accExtras (gait + sleep-stage consensus) is
    // computed once here and cached on the result so the UI/export reuse it (no 2nd pass).
    const _accEx = rec.deviceACC && rec.accFs && rec.deviceACC.length >= rec.accFs * 30 && accExtras ? accExtras(rec.deviceACC, rec.accFs, rec.t0Ms, durSec, epochs, stages) : null;
    const modeInfo = classifyMode(durSec, rec.t0Ms, _accEx, longRec);
    const ambulatory = modeInfo.ambulatory;

    // suppress-with-reason (NOT delete): a walk is not a sleep study, but consumers must
    // never hit a missing field — emit a present, explicitly-suppressed shape instead.
    const sleepSuppressed = ambulatory ? { suppressed: true, suppressedReason: modeInfo.suppressReason, stages: null } : null;
    const apneaSuppressed = ambulatory ? { reportable: false, suppressedReason: modeInfo.suppressReason, cvhrIndex: null } : null;

    // CVHR apnea screen is invalid under exercise → withhold the index/events. The HR series
    // is kept (heart rate IS valid for a walk); only the apnea interpretation is suppressed.
    const cvhr = ambulatory ? { index: null, events: [], hrSeries: cvhrRaw.hrSeries, resSeries: cvhrRaw.resSeries, M: cvhrRaw.M, suppressed: true } : cvhrRaw;
    const hrvStab = longRec && !ambulatory ? hrvStability(epochs) : null; // Li/Kiyono 2026 (nocturnal-only)
    const surgeEsc = longRec && !ambulatory ? surgeEscalation(cvhrRaw.events, durSec) : null;

    // Cardiorespiratory coupling (EDR ⟷ RR) — RSA efficiency · CRC PLV · coupling strength.
    // Zero new sensors: EDR comes from the same ECG. Per-epoch PLV cross-references CVHR.
    const crc = cardiorespCoupling(nn, tt, int16, refIdx, fs, spec.respRate, epochs);
    if (crc && crc.epochCRC.length && cvhr.events.length) {
      const surgeMin = cvhr.events.map((e) => e.sec / 60);
      const sIn = [],
        sOut = [];
      for (const ec of crc.epochCRC) {
        const has = surgeMin.some((m) => m >= ec.tMin && m < ec.tMin + 5);
        (has ? sIn : sOut).push(ec.plv);
      }
      crc.plvDuringSurges = /** @type {any} */ (sIn.length ? +mean(sIn).toFixed(3) : null);
      crc.plvBaseline = /** @type {any} */ (sOut.length ? +mean(sOut).toFixed(3) : null);
    }
    // per-epoch respiratory-rate spread (EDR) — CPAPDex can flag resp-rate instability without airflow
    const respVals = epochs.filter((e) => e.resp != null && e.resp > 0).map((e) => e.resp);
    const respStats =
      respVals.length >= 3 ? { n: respVals.length, min: +arrMin(respVals).toFixed(1), max: +arrMax(respVals).toFixed(1), median: +median(respVals).toFixed(1), sd: +std(respVals).toFixed(2) } : null;

    prog(94, 'Morphology · ectopy · rhythm…');
    let morph = null;
    if (global.ECGMorph) {
      try {
        morph = global.ECGMorph.analyze(int16, bp, fs, refIdx, rr, Array.from(sqi));
      } catch (e) {
        morph = null;
      }
    }

    prog(96, 'Ganglior events…');
    // per-epoch body position from companion ACC (mutates epochs → epoch.position; feeds event meta)
    const epochPos = stampEpochPositions(epochs, rec.deviceACC, rec.accFs, rec.t0Ms, durSec);
    // Clock Contract §2.6: thread the real anchor (or null) — NEVER fabricate now(). A stampless
    // recording yields events with t:null/tMs:null, matching the export's startEpochMs:null.
    const events = gangliorEvents(cvhr, ambulatory ? [] : stages, rec.t0Ms != null ? rec.t0Ms : null, sqi, times, epochPos, _accEx ? _accEx.movementOnsets : null);

    // sleep stage summary
    const stageMin = { Wake: 0, REM: 0, Light: 0, Deep: 0 };
    stages.forEach((s, i) => {
      const dur = i < stages.length - 1 ? stages[i + 1].tMin - s.tMin : 5;
      stageMin[s.stage] += dur;
    });
    const totSleep = stageMin.REM + stageMin.Light + stageMin.Deep;

    // validity tier
    const durMin = durSec / 60;
    let tier, tierMsg;
    if (durMin < 2) {
      tier = 'insufficient';
      tierMsg = '< 2 min — HRV not reliable';
    } else if (durMin < 5) {
      tier = 'ultra-short';
      tierMsg = 'Ultra-short: HR · rMSSD · pNN50 · SD1 · HF valid; SDNN/LF/VLF/LF:HF withheld';
    } else if (durMin < 90) {
      tier = 'short';
      tierMsg = '5-min standard: full short-term suite valid (Task Force 1996)';
    } else {
      tier = 'overnight';
      tierMsg = 'Overnight: + VLF · DFA α1 · CVHR/apnea · sleep staging';
    }
    if (lowCoverage) {
      tierMsg += ` · ⚠ only ${nnRes.coveragePct}% beat coverage across a ${(spanSec / 60).toFixed(0)}-min span (${nnRes.nGaps} gap${nnRes.nGaps === 1 ? '' : 's'}, ${(nnRes.gapSec / 60).toFixed(0)} min off-body) — metrics reflect the ${durMin.toFixed(0)} min of usable signal only`;
    }

    prog(100, 'Done');

    return {
      source: rec.source,
      fs,
      durSec,
      // Carry the parsed clock end through analyze — like `offsetMin`, it is a property of the
      // RECORDING, not of the analysis, so analyze must pass it rather than re-derive it. Note the
      // `durSec` above is analyze's ACTIVE seconds (nnRes.activeSec), which is data-seconds by an even
      // stricter reading than the parser's n/fs — all the more reason the clock end must travel too.
      endEpochMs: rec.endEpochMs != null ? rec.endEpochMs : null,
      // …and the SEGMENTS inside that span (INTEGRATOR-GAP-AWARE-OVERLAP part 2). Also a property of
      // the recording, not the analysis — null whenever the link never dropped.
      coverage: ecgCoverage(rec),
      durMin: +durMin.toFixed(1),
      longRec,
      tier,
      tierMsg,
      mode: modeInfo.mode,
      modeLabel: modeInfo.modeLabel,
      modeWhy: modeInfo.modeWhy,
      modeConf: modeInfo.modeConf,
      ambulatory,
      activityScore: modeInfo.activityScore,
      activity: modeInfo.activity,
      sleepSuppressed,
      apneaSuppressed,
      _accEx,
      // raw refs for canvas + charts
      int16,
      bp,
      peaks,
      refIdx,
      times: Array.from(times),
      sqi: Array.from(sqi),
      nn,
      tt,
      corrected: Array.from(nnRes.corrected),
      // Filter-aligned twin of `corrected`, safe to publish beside nn/tt (see the loop above).
      nnCorrected: nnCorr,
      // Filter-aligned per-beat fused-hat confidence — same alignment contract as nnCorrected.
      nnConf,
      // quality
      analyzablePct: nnRes.analyzablePct,
      correctionRate: nnRes.correctionRate,
      nCorrected: nnRes.nCorrected,
      nEctopyCorrected: nnRes.nEctopyCorrected,
      cleanBeatPct: nnRes.cleanBeatPct,
      coveragePct: nnRes.coveragePct,
      /* Per-term means of the composite per-beat SQI (Do 5 step 1). Additive: `cleanBeatPct` above is
         a THRESHOLD count of the composite and cannot say WHICH term moved it, so a term pinned at 0
         and a term doing real work produce the same `cleanBeatPct` story. */
      sqiTerms,
      nGaps: nnRes.nGaps,
      artifactSec,
      spanMin: +(spanSec / 60).toFixed(1),
      gapMin: +(nnRes.gapSec / 60).toFixed(1),
      activeMin: +(nnRes.activeSec / 60).toFixed(1),
      lowCoverage,
      nBeats: N,
      meanSQI: +mean(Array.from(sqi)).toFixed(3),
      // time domain
      hr,
      meanRR: +meanRR.toFixed(1),
      sdnn: +sdnn.toFixed(1),
      rmssd: +rm.toFixed(1),
      pnn50: +pn.toFixed(1),
      nn50: nn50c(nn),
      cv: +((sdnn / meanRR) * 100).toFixed(2),
      minRR: +arrMin(nn).toFixed(0),
      maxRR: +arrMax(nn).toFixed(0),
      medianRR: +median(nn).toFixed(0),
      q25: +quant(nn, 0.25).toFixed(0),
      q75: +quant(nn, 0.75).toFixed(0),
      dispRm,
      dispSd,
      dispHr,
      dispPn,
      sdann,
      sdnnIdx,
      // poincaré
      sd1: sd1v,
      sd2: sd2v,
      /* `sd1v / (sd2v || 1)` is the same fabrication as `hfnu` below: with sd2v null the `|| 1`
         substitutes a denominator that was never measured, and `null / 1` is 0 in JS — so a
         refusal would have surfaced as a ratio of exactly 0.000. Both derived metrics refuse
         when either axis is absent. */
      sd1sd2: sd1v == null || sd2v == null ? null : +(sd1v / (sd2v || 1)).toFixed(3),
      ellArea: sd1v == null || sd2v == null ? null : +(Math.PI * sd1v * sd2v).toFixed(0),
      poincareNN,
      poincareRep: longRec && repSeg.length >= 20,
      poincareRepTMin: repTMin,
      poincareRepIdx: repIdx,
      // frequency
      tp: spec.tp,
      hf: spec.hf,
      lf: spec.lf,
      vlf: spec.vlf,
      lfhf: spec.lfhf,
      respRate: spec.respRate,
      respStats,
      specWindow: /** @type {any} */ (spec).window || (longRec ? 'epochMedian5min' : 'representative5min'), // §10: name the scale
      /* 🔴 THE `|| 1` WAS THE WHOLE DEFECT, and it is worth naming precisely. With hf and lf both
         absent the expression read `null / (null + null || 1) * 100` — `null + null` is 0, `0 || 1`
         is 1, `null / 1` is 0 — producing a clean `0.0 %` on a `validated`-tier metric from an
         input that was never transformed. The guard is on the MEASUREMENT, not on the denominator:
         if either band is absent there are no normalised units to report. A genuinely measured
         hf + lf === 0 still yields 0 via the retained `|| 1`, which is the case that guard was
         actually for. */
      hfnu: spec.hf == null || spec.lf == null ? null : +((spec.hf / (spec.hf + spec.lf || 1)) * 100).toFixed(1),
      lfnu: spec.hf == null || spec.lf == null ? null : +((spec.lf / (spec.hf + spec.lf || 1)) * 100).toFixed(1),
      // non-linear
      dfa1,
      sampen,
      triIdx,
      dc,
      ac,
      pip: frag.pip,
      ials: frag.ials,
      pss: frag.pss,
      lnrmssd: +Math.log(longRec ? dispRm : rm).toFixed(3),
      // epochs + sleep + cvhr + events
      epochs,
      stages,
      stageMin,
      totSleep: +totSleep.toFixed(0),
      // `denomSec` rides along (F3): this reshape is an ALLOWLIST, so a field detectCVHR returns and
      // the export reads is dead unless it is named here — the analyze-level assertion is what shows it.
      cvhr: { index: cvhr.index, events: cvhr.events, hrSeries: cvhr.hrSeries, resSeries: cvhr.resSeries, denomSec: cvhr.denomSec },
      hrvStab,
      surgeEsc,
      crc,
      events,
      // morphology · ectopy · rhythm · AF screen
      morph,
      // device cross-check inputs (synthetic carries ground truth)
      deviceRR: rec.deviceRR || null,
      deviceHR: rec.deviceHR || null,
      deviceACC: rec.deviceACC || null,
      accFs: rec.accFs || null,
      t0Ms: rec.t0Ms || null,
      /* TIMING PROVENANCE, carried through the reshape (H10-2019-ORIGIN, 2026-09-01). Like `endEpochMs`
         above these are properties of the RECORDING, not of the analysis — and until this line they
         were DROPPED here, which made `ecgBuildNodeExport`'s `recording.hostAxis` block (HOSTAXIS-
         STABILITY §4.2) dead on every real path: `compute()` and the app both route parse → analyze →
         buildNodeExport, so `r.hostAxis` was always undefined and no shipped export ever carried it
         (verified on the 2026-09-01 refolded corpus — zero `hostAxis`/`timingSource` keys). The same
         reshape-drop class trio-batch's PPG merge already fixed (WEARABLE-HOST-AXIS-FOLLOWUPS §F3),
         one node over. A reshape that renames fields must forward the ones it does not rename. */
      hostAxis: rec.hostAxis || null,
      tMsCorrected: rec.tMsCorrected === true,
      deviceEpoch: rec.deviceEpoch || null,
      clockResyncs: rec.clockResyncs || null
    };
  }

  // ─── self-RR vs device-RR validation ─────────────────────────────────────────
  // Malik 20% local-median correction — same rule buildNN now applies to selfNN, so the
  // comparison is corrected-vs-corrected (apples-to-apples). Without this, a device that
  // leaves ectopy/missed-beats in its RR (Polar does) shows a false 40%+ rMSSD "mismatch".
  // The 300–2000ms range gate MUST match buildNN's (ECGDex's documented window, Task Force
  // 30–200 bpm — audits/DEX-DSP-AUDIT-BEATS-ARTIFACT.md) or the comparison is NOT actually
  // apples-to-apples: this used to read 2200 while buildNN corrected selfNN at 2000, so a
  // device beat in the 2000–2200 band survived where its self twin was clamped, biasing
  // dRMSSD/dSDNN. (PulseDex deliberately uses 2200 — a per-signal divergence for athlete
  // RR-file bradycardia, NOT a value ECGDex should adopt.)
  function _malikCorrect(vals) {
    const n = vals.length,
      out = vals.slice(),
      W = 5;
    let nc = 0;
    for (let i = 0; i < n; i++) {
      const seg = [];
      for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
        if (j !== i && vals[j] >= 300 && vals[j] <= 2000) seg.push(vals[j]);
      }
      seg.sort((a, b) => a - b);
      const med = seg.length ? seg[seg.length >> 1] : 0;
      const dev = med ? Math.abs(vals[i] - med) / med : 0;
      if (vals[i] < 300 || vals[i] > 2000 || dev > 0.2) {
        out[i] = med || out[i - 1] || 1000;
        nc++;
      }
    }
    return { out, nc };
  }
  function validateRR(selfNN, deviceRR) {
    if (!deviceRR || !deviceRR.length) return null;
    const devRaw = deviceRR.map((d) => d.rr);
    const devC = _malikCorrect(devRaw); // correct device RR the same way as selfNN
    const devVals = devC.out;
    const selfRMSSD = rmssd(selfNN),
      devRMSSD = rmssd(devVals);
    const selfSDNN = std(selfNN),
      devSDNN = std(devVals);
    const selfMean = mean(selfNN),
      devMean = mean(devVals);
    return {
      nSelf: selfNN.length,
      nDev: devVals.length,
      devEctopyCorrected: devC.nc,
      devRawRMSSD: +rmssd(devRaw).toFixed(1),
      selfRMSSD: +selfRMSSD.toFixed(1),
      devRMSSD: +devRMSSD.toFixed(1),
      dRMSSD: +((Math.abs(selfRMSSD - devRMSSD) / devRMSSD) * 100).toFixed(1),
      selfSDNN: +selfSDNN.toFixed(1),
      devSDNN: +devSDNN.toFixed(1),
      dSDNN: +((Math.abs(selfSDNN - devSDNN) / devSDNN) * 100).toFixed(1),
      selfMean: +selfMean.toFixed(1),
      devMean: +devMean.toFixed(1),
      dMean: +((Math.abs(selfMean - devMean) / devMean) * 100).toFixed(2),
      selfHR: +(60000 / selfMean).toFixed(1),
      devHR: +(60000 / devMean).toFixed(1)
    };
  }

  /* ── PER-BEAT alignment against the strap's OWN detector (2026-08-13) ───────────────────────────
     `validateRR` above compares WHOLE-RECORD summaries — beats, mean, RMSSD, SDNN. Those agree on a
     night whose beat-to-beat correspondence has quietly fallen apart, because a summary is invariant
     to which beat matched which. This pairs them BEAT BY BEAT, which is a different and stricter
     question, and it is the one that exposes a decaying match.

     WHY INDEX ALIGNMENT AND NOT TIMESTAMPS. The H10 `_RR.txt` header is `Phone timestamp;RR-interval
     [ms]` — the stamps are ARRIVAL times, so differencing against them measures BLE batching, not the
     detector. Measured on 2026-08-10: arrival-gap minus device-reported RR has median −79 ms, SD
     299 ms, p1–p99 spread 1275 ms. If the intervals were arrival-differenced that would be ~0; it is
     Polar's RR batching. So the VALUES are device-measured even though the AXIS is not, and the
     correct move is to ignore the stamps entirely and align the two interval series by INDEX.
     (A first attempt reconstructed the device train by cumulating from one arrival-stamped anchor. It
     drifted 510 ms across a night and paired 63.6 %. Index alignment needs no axis, so the
     arrival-only header stops mattering — which is also why the same exclusion applied to PpgDex's
     `_PPI.txt` is about the AXIS, not about the intervals.)

     ⚠️ A SINGLE GLOBAL OFFSET IS NOT SUFFICIENT, AND ASSUMING ONE FLATTERS THE RESULT. The two trains
     differ by a handful of beats over a night (17 848 self vs 17 881 device on the reference file), and
     that surplus is NOT necessarily at the ends. If any of it is distributed, the pairing decays with
     beat index and every downstream statistic is computed on progressively mismatched pairs. Measured
     on that same file: the best offset re-fits to 35 on the first two thirds and 33 on the last, and
     the median |self − device| interval difference by decile runs

         2.36  2.33  2.22  2.27  2.31  |  16.93  17.26  25.94  27.76  30.79   ms
         (p90: 5.4 ... 5.6 flat)       |  (p90 rising to 91.0)

     — flat for half the night, then climbing monotonically. The whole-night median still reads a
     healthy 4.88 ms and the beat COUNTS still match to 33 in 17 848, so neither `validateRR` nor any
     existing gate can see it. Only the index-vs-index view can.
     Therefore the offset is re-fitted per window and the decay is REPORTED, never averaged over. A
     comparison whose pairing silently degrades produces a number rather than an error, which is the
     failure mode this suite keeps paying for. */
  const RR_ALIGN_MAX_OFFSET = 60; // beats; beyond this the two files are not the same recording
  const RR_ALIGN_MIN_PAIRS = 300; // per window, for a median to mean anything
  const RR_ALIGN_WINDOWS = 10; // deciles — enough to see a trend, few enough to stay populated
  const RR_ALIGN_PLAUSIBLE_MS = 500; // a pair further apart than this is not the same beat
  function _rrBestOffset(selfNN, dev, lo, hi) {
    let bo = null,
      bs = Infinity;
    for (let off = -RR_ALIGN_MAX_OFFSET; off <= RR_ALIGN_MAX_OFFSET; off++) {
      const d = [];
      for (let i = Math.max(lo, -off); i < Math.min(hi, dev.length - off); i++) {
        const v = selfNN[i] - dev[i + off];
        if (Math.abs(v) < RR_ALIGN_PLAUSIBLE_MS) d.push(Math.abs(v));
      }
      if (d.length < RR_ALIGN_MIN_PAIRS) continue;
      d.sort((a, b) => a - b);
      const med = d[d.length >> 1];
      if (med < bs) {
        bs = med;
        bo = off;
      }
    }
    return bo == null ? null : { offset: bo, medianAbsMs: +bs.toFixed(2) };
  }
  function alignFirmwareRR(selfNN, deviceRR, opts) {
    /* THE RELATIVE TEST NEEDS AN ABSOLUTE FLOOR, or it calls sub-sample noise a defect. Two detectors
       reading the same ECG cannot disagree by less than the sampling interval in any meaningful sense —
       an R-peak lands on a sample. Observed: one file rises 2.27 -> 6.96 ms, a 3.07x jump that trips a
       purely relative rule, while 6.96 ms is still INSIDE one sample at 130.04 Hz (7.69 ms). Against
       that, the genuine decays reach 25-50 ms, i.e. 3-7 samples. So a window must exceed BOTH 3x the
       recording's own best AND one sample period to count. `fs` defaults to the H10's nominal rate when
       the caller does not supply it — the floor is then approximate, which is stated rather than
       hidden, and a caller with the real `fs` should pass it. */
    const fs = opts && opts.fs > 0 ? opts.fs : 130;
    const sampleMs = 1000 / fs;
    if (!selfNN || !deviceRR || selfNN.length < RR_ALIGN_MIN_PAIRS || deviceRR.length < RR_ALIGN_MIN_PAIRS) return null;
    const dev = deviceRR.map((d) => d.rr).filter((v) => v > 250 && v < 2500);
    if (dev.length < RR_ALIGN_MIN_PAIRS) return null;
    const N = selfNN.length;
    const whole = _rrBestOffset(selfNN, dev, 0, N);
    if (!whole) return null;
    // Re-fit per third. Agreement is the licence to treat one offset as global.
    const T = Math.floor(N / 3);
    const thirds = [_rrBestOffset(selfNN, dev, 0, T), _rrBestOffset(selfNN, dev, T, 2 * T), _rrBestOffset(selfNN, dev, 2 * T, N)];
    // Built explicitly: `.filter(Boolean)` is not a type predicate, so the nulls a refused third
    // legitimately produces stay in the element type and `.offset` reads as possibly-null.
    const offs = [];
    for (const t of thirds) if (t) offs.push(t.offset);
    const offsetStable = offs.length === 3 && offs[0] === offs[1] && offs[1] === offs[2];
    // Per-decile |difference| at the global offset: the FAN is what a single median hides.
    const g = whole.offset,
      step = Math.floor(N / RR_ALIGN_WINDOWS),
      byWindow = [];
    for (let k = 0; k < RR_ALIGN_WINDOWS; k++) {
      const d = [];
      for (let i = Math.max(k * step, -g); i < Math.min((k + 1) * step, dev.length - g); i++) {
        const v = selfNN[i] - dev[i + g];
        if (Math.abs(v) < RR_ALIGN_PLAUSIBLE_MS) d.push(Math.abs(v));
      }
      if (!d.length) {
        byWindow.push(null);
        continue;
      }
      d.sort((a, b) => a - b);
      byWindow.push(+d[d.length >> 1].toFixed(2));
    }
    const seen = byWindow.filter((v) => v != null);
    /* THE BASELINE IS THE BEST WINDOW, NOT THE FIRST. Comparing against the first window assumes the
       degradation is a suffix, and it is not always: on 2026-07-25 the pairing is BAD at the start
       (17.47, 18.71), clean through the middle (~2.5), and bad again at the end (20.24). Using the
       first window as the reference made that file's own worst data the yardstick, so nothing exceeded
       3x it and the verdict read "uniform". The minimum is what the strap achieves when the match
       holds, which is the only per-recording baseline that survives a bad start, a bad end, or both.
       Per-recording rather than a fixed bound because a noisier strap simply starts higher, and that
       is not a decay. 3x separates the two populations actually observed: the flat regions sit at
       2.0-2.8 ms across every file, the degraded ones at 13-31. */
    const best = seen.length ? Math.min.apply(null, seen) : null;
    const worst = seen.length ? Math.max.apply(null, seen) : null;
    /* TOLERANCE IS THE LOOSER OF (3x best) AND ONE SAMPLE. Two reasons, and the second is not academic:
       a difference below the sampling interval is not a detectable disagreement at all, and a very good
       match drives 3x best toward zero — on a synthetic with an exact match it IS zero, so a purely
       relative band would call a perfect recording non-uniform. */
    // Infinity, not null, when there is nothing to compare: it keeps `tol` a NUMBER so every later
    // comparison is total, and an empty window set makes both branches below false anyway.
    const tol = best != null ? Math.max(3 * best, sampleMs) : Infinity;
    const nonUniform = best != null && worst != null && worst > tol;
    /* The LONGEST CONTIGUOUS RUN within tolerance, not a prefix — same reason. A consumer wanting one
       trustworthy stretch needs where it is, not merely how long it is, so both ends are reported. */
    // -1 sentinels rather than nulls: the run length is the comparison, and tracking it as a NUMBER
    // avoids arithmetic on possibly-null bounds (which `checkJs` cannot narrow through a short-circuit).
    let runFrom = -1,
      runTo = -1,
      bestLen = 0,
      curFrom = -1;
    for (let k = 0; k <= byWindow.length; k++) {
      const w = k < byWindow.length ? byWindow[k] : null; // hoisted: element access is not narrowed
      const okk = w != null && w <= tol;
      if (okk && curFrom < 0) curFrom = k;
      if (!okk && curFrom >= 0) {
        const len = k - curFrom;
        if (len > bestLen) {
          bestLen = len;
          runFrom = curFrom;
          runTo = k - 1;
        }
        curFrom = -1;
      }
    }
    const decayed = nonUniform;
    return {
      offset: g,
      medianAbsMs: whole.medianAbsMs,
      nSelf: N,
      nDevice: dev.length,
      beatSurplus: dev.length - N,
      offsetPerThird: thirds.map((t) => (t ? t.offset : null)),
      offsetStable,
      medianAbsByWindow: byWindow,
      /* TRUE ⇒ the beat correspondence degrades through the recording, so any whole-record statistic
         derived from these pairs is computed on progressively mismatched beats. Reported, never
         silently corrected: which SIDE is dropping beats is not determinable from the intervals alone,
         and guessing it would fabricate the more interesting half of the answer. */
      /* THE MEDIAN FAN IS THE VERDICT; the offset disagreement is REPORTED BESIDE IT, not folded in.
         They are different observations and OR-ing them made the weaker one dominate: a one-beat offset
         difference between thirds is common when every window is already sub-sample, and flagging that
         as a decay fires on recordings where nothing is wrong. Where a distributed surplus is real, the
         fan appears too (2026-08-10 shows BOTH: offsets 35/35/33 and medians 2.2 -> 30.8). */
      pairingDecays: decayed,
      /* The prefix over which the pairing IS trustworthy — a consumer wanting one number should use
         this range rather than the whole record. Null when nothing decayed (use everything). */
      /* Window indices (0-based, inclusive) of the longest stretch whose pairing holds. Null when the
         whole record is uniform — use everything. A bad START is why this is a range and not a count. */
      stableWindowRange: nonUniform && bestLen > 0 ? [runFrom, runTo] : null,
      medianAbsBestMs: best,
      medianAbsWorstMs: worst,
      // The resolution floor the verdict used, so a reader can see what "disagreement" was measured against.
      sampleMs: +sampleMs.toFixed(2),
      note: 'per-beat index alignment; the H10 _RR.txt axis is ARRIVAL-stamped so timestamps are deliberately unused — only the interval VALUES are device-measured'
    };
  }

  // ─── self-HR vs device-HR cross-check ────────────────────────────────────────
  function _rollMedian(x, win) {
    const n = x.length,
      half = win >> 1,
      o = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = [];
      for (let k = -half; k <= half; k++) {
        const u = i + k;
        if (u >= 0 && u < n && isFinite(x[u])) s.push(x[u]);
      }
      if (!s.length) {
        o[i] = x[i];
        continue;
      }
      s.sort((a, b) => a - b);
      o[i] = s[s.length >> 1];
    }
    return o;
  }
  function _alignDevSeconds(rows, ecgT0Ms, durSec) {
    if (!rows || !rows.length) return [];
    let inWin = 0;
    if (ecgT0Ms)
      for (const r of rows) {
        const s = (r.tsMs - ecgT0Ms) / 1000;
        if (s >= -2 && s <= durSec + 2) inWin++;
      }
    const base = ecgT0Ms && inWin > rows.length * 0.5 ? ecgT0Ms : rows[0].tsMs;
    return rows.map((r) => ({ sec: (r.tsMs - base) / 1000, row: r }));
  }
  function validateHR(ecgHrSeries, deviceHR, ecgT0Ms) {
    if (!ecgHrSeries || !ecgHrSeries.length || !deviceHR || !deviceHR.length) return null;
    const M = ecgHrSeries.length;
    const aligned = _alignDevSeconds(deviceHR, ecgT0Ms, M);
    const dev = new Float64Array(M).fill(NaN);
    for (const a of aligned) {
      const s = Math.round(a.sec);
      if (s >= 0 && s < M) dev[s] = a.row.hr;
    }
    let last = NaN;
    for (let s = 0; s < M; s++) {
      if (isFinite(dev[s])) last = dev[s];
      else if (isFinite(last)) dev[s] = last;
    }
    // device HR is firmware-smoothed; smooth the ECG instantaneous HR the same way + clip
    // to a physiological window around the record's own median so artifact false-peaks
    // (burst-noise spans → spurious 150–180 bpm) don't pollute the comparison.
    const rawVals = Array.from(ecgHrSeries).filter((h) => h >= 30 && h <= 220);
    const hrMed = rawVals.length ? median(rawVals) : 60;
    const lo = Math.max(30, hrMed - 45),
      hi = Math.min(210, hrMed + 45);
    const ecgC = Float64Array.from(ecgHrSeries, (h) => (h >= lo && h <= hi ? h : NaN));
    const devC = Float64Array.from(dev, (h) => (h >= lo && h <= hi ? h : NaN));
    const ecgS = _rollMedian(ecgC, 9),
      devS = _rollMedian(devC, 9);
    // EXCLUDE the electrode-settling lead-in from the CORRELATION (not the overlay): the first
    // ~60 s after strap-on is unreliable on BOTH sensors and, moving in opposite directions
    // (ECG-derived rising as the device dips), drags r toward zero. Only on records long enough
    // that 60 s is a negligible fraction.
    const lead = M > 300 ? 60 : 0;
    const xs = [],
      ys = [];
    for (let s = lead; s < M; s++) {
      const e = ecgS[s],
        d = devS[s];
      if (isFinite(e) && isFinite(d) && e > 30 && d > 30) {
        xs.push(e);
        ys.push(d);
      }
    }
    if (xs.length < 10) return null;
    const me = mean(xs),
      md = mean(ys);
    let num = 0,
      dx = 0,
      dy = 0,
      mae = 0,
      maxe = 0;
    for (let i = 0; i < xs.length; i++) {
      const ce = xs[i] - me,
        cd = ys[i] - md;
      num += ce * cd;
      dx += ce * ce;
      dy += cd * cd;
      const ae = Math.abs(xs[i] - ys[i]);
      mae += ae;
      if (ae > maxe) maxe = ae;
    }
    const r = dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
    // Pearson r is MEANINGLESS when HR was near-constant (tiny variance → noise-dominated) or the
    // window is too short — flag it so a flat overnight stretch never reads as "weak beat
    // detection" (the RR-paired validateRR card is the authoritative agreement check). spreadE/D
    // are the smoothed-HR SDs the consumer uses to explain a flat verdict.
    const sdE = Math.sqrt(dx / xs.length),
      sdD = Math.sqrt(dy / ys.length);
    const rMeaningful = xs.length >= 120 && sdE >= 1.5 && sdD >= 1.5;
    const step = Math.max(1, Math.floor(M / 240)),
      overlay = [];
    for (let s = 0; s < M; s += step) overlay.push({ t: s, ecg: isFinite(ecgS[s]) ? +ecgS[s].toFixed(1) : null, dev: isFinite(devS[s]) ? +devS[s].toFixed(1) : null });
    return {
      n: xs.length,
      ecgMean: +me.toFixed(1),
      devMean: +md.toFixed(1),
      dMean: +Math.abs(me - md).toFixed(1),
      mae: +(mae / xs.length).toFixed(1),
      maxErr: +maxe.toFixed(0),
      r: +r.toFixed(3),
      rMeaningful,
      spreadE: +sdE.toFixed(1),
      spreadD: +sdD.toFixed(1),
      ecgMin: +arrMin(xs).toFixed(0),
      ecgMax: +arrMax(xs).toFixed(0),
      devMin: +arrMin(ys).toFixed(0),
      devMax: +arrMax(ys).toFixed(0),
      overlay
    };
  }

  // ─── device accelerometer: derived respiration + motion/activity ─────────────
  // resp rate via autocorrelation of the band-passed chest axis (robust to movement
  // noise, unlike zero-crossing counting).
  /* ── CARDIOPULMONARY COUPLING (Thomas et al. 2005; apnea application Hilmisson 2019) ──────────
     Coherence-weighted cross-power between heart rate and ECG-derived respiration, banded by the
     DOMINANT coupling frequency in each window:
        HFC  0.10–0.40 Hz   stable NREM
        LFC  0.01–0.10 Hz   UNSTABLE NREM — the apnea signature
        VLFC 0.004–0.01 Hz  REM / wake
     Both inputs must be UNDETRENDED (see the note at the edrRawU assignment): the existing
     `_detrendMov(40)` and `_bandResp` grids retain 0–22 % of LFC and 0 % of VLFC.

     WINDOW. Frequency resolution is 1/T — set by window DURATION, not by the 4 Hz grid rate (the
     beat series' own Nyquist is ~0.42 Hz at a 50 bpm sleep rate, so 4 Hz is already ~10x oversampled
     and a faster grid would add no information). Thomas uses 1024 samples at 2 Hz = 512 s, giving
     df = 0.00195 Hz — about three bins across VLFC. We keep the 512 s DURATION on the 4 Hz grid
     (2048 samples), so the resolution matches the published method rather than the sample count.
     A shorter window cannot resolve VLFC at all: 128 s gives df = 0.0078 Hz, one bin for the band.

     Returns null rather than a degraded number when the record cannot support the analysis. */
  function _cpc(hrRaw, edrRaw, fs) {
    const WIN_SEC = 512,
      N = 1 << Math.round(Math.log2(WIN_SEC * fs)); // 2048 @ 4 Hz
    const STEP = N >> 1; // 50 % overlap
    if (!hrRaw || !edrRaw || hrRaw.length < N) return null; // too short to resolve VLFC — say so
    const df = fs / N;
    const bandOf = (fHz) => (fHz >= 0.1 && fHz <= 0.4 ? 'hfc' : fHz >= 0.01 ? 'lfc' : fHz >= 0.004 ? 'vlfc' : null);
    const counts = { hfc: 0, lfc: 0, vlfc: 0 },
      lfcVals = [];
    let windows = 0;
    const kLo = Math.max(1, Math.floor(0.004 / df)),
      kHi = Math.min(N >> 1, Math.ceil(0.4 / df));
    for (let s0 = 0; s0 + N <= hrRaw.length; s0 += STEP) {
      // per-window linear detrend + Hann. A LINEAR detrend removes drift without touching 0.004 Hz,
      // which is exactly what the 40-beat moving average could not do.
      const xr = new Float64Array(N),
        xi = new Float64Array(N),
        yr = new Float64Array(N),
        yi = new Float64Array(N);
      let sx = 0,
        sy = 0,
        sxx = 0,
        sxy1 = 0,
        sxy2 = 0;
      for (let i = 0; i < N; i++) {
        sx += i;
        sxx += i * i;
        sy += hrRaw[s0 + i];
        sxy1 += i * hrRaw[s0 + i];
        sxy2 += i * edrRaw[s0 + i];
      }
      const meanI = sx / N,
        den = sxx - N * meanI * meanI;
      let sy2 = 0;
      for (let i = 0; i < N; i++) sy2 += edrRaw[s0 + i];
      const bH = den > 0 ? (sxy1 - meanI * sy) / den : 0,
        aH = sy / N - bH * meanI;
      const bE = den > 0 ? (sxy2 - meanI * sy2) / den : 0,
        aE = sy2 / N - bE * meanI;
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
        xr[i] = (hrRaw[s0 + i] - (aH + bH * i)) * w;
        yr[i] = (edrRaw[s0 + i] - (aE + bE * i)) * w;
      }
      _fft(xr, xi);
      _fft(yr, yi);
      // Coherence needs SMOOTHED spectra — a single-segment magnitude-squared coherence is
      // identically 1 at every bin and carries no information. Smooth over +/-2 bins (Welch-style
      // frequency averaging), which is what makes Cxy a real quantity here.
      const H = 2;
      const bandPow = { hfc: 0, lfc: 0, vlfc: 0 };
      for (let k = kLo; k <= kHi; k++) {
        let pxx = 0,
          pyy = 0,
          cr = 0,
          ci = 0;
        for (let j = Math.max(1, k - H); j <= Math.min((N >> 1) - 1, k + H); j++) {
          pxx += xr[j] * xr[j] + xi[j] * xi[j];
          pyy += yr[j] * yr[j] + yi[j] * yi[j];
          cr += xr[j] * yr[j] + xi[j] * yi[j]; // Re(X * conj(Y))
          ci += xi[j] * yr[j] - xr[j] * yi[j]; // Im(X * conj(Y))
        }
        const cross2 = cr * cr + ci * ci;
        if (pxx <= 0 || pyy <= 0) continue;
        const coh = cross2 / (pxx * pyy); // magnitude-squared coherence
        const power = coh * Math.sqrt(cross2); // Thomas: coherence x cross-power
        const b = bandOf(k * df);
        if (b) bandPow[b] += power;
      }
      if (bandPow.hfc + bandPow.lfc + bandPow.vlfc <= 0) continue;
      // INTEGRATED band power, not argmax of a single peak. Measured on uncorrelated noise, an
      // argmax estimator lands VLFC 7.5 % / LFC 32.5 % / HFC 60.0 % where the bandwidth-proportional
      // null is 1.5 / 23 / 76 — a 5x low-frequency over-pick, because the +/-2-bin smoothing spans
      // fewer independent bins near DC. Reporting "LFC 54 %" against an implicit null of zero would
      // have been wrong by the width of that bias. Integrating each band and normalising removes the
      // peak-picking step entirely, so a band's share reflects its power, not its luck.
      const tot = bandPow.hfc + bandPow.lfc + bandPow.vlfc;
      counts.hfc += bandPow.hfc / tot;
      counts.lfc += bandPow.lfc / tot;
      counts.vlfc += bandPow.vlfc / tot;
      windows++;
      lfcVals.push(bandPow.lfc / tot);
    }
    if (!windows) return null;
    const pct = (k) => +((100 * counts[k]) / windows).toFixed(1); // counts[] now accumulate FRACTIONS, so this is a mean share
    return {
      windows,
      windowSec: WIN_SEC,
      freqResHz: +df.toFixed(5),
      hfcPct: pct('hfc'),
      lfcPct: pct('lfc'),
      vlfcPct: pct('vlfc'),
      method: 'CPC — coherence x cross-power of HR vs EDR (Thomas 2005), 512 s windows, 50 % overlap'
    };
  }

  function _autocorrPeriod(x, fs, loSec, hiSec) {
    // classic pitch-detection: autocorrelate, skip to the first negative-going zero
    // crossing (past the central lobe), then take the lag of the largest peak. Avoids
    // locking onto half-period sidelobes that fooled a naive global-max search.
    const n = x.length,
      maxL = Math.min(n - 1, Math.round(hiSec * fs)),
      minL = Math.max(1, Math.round(loSec * fs));
    let denom = 0;
    for (let i = 0; i < n; i++) denom += x[i] * x[i];
    if (denom <= 0) return null;
    const ac = new Float64Array(maxL + 1);
    for (let lag = 0; lag <= maxL; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
      ac[lag] = s / denom;
    }
    let z = 1;
    while (z <= maxL && ac[z] > 0) z++; // first zero crossing
    const start = Math.max(z, minL);
    let best = -1,
      bestLag = 0;
    for (let lag = start; lag <= maxL; lag++) {
      if (ac[lag] > best) {
        best = ac[lag];
        bestLag = lag;
      }
    }
    if (!(bestLag > 0 && best > 0.1)) return null;

    /* ── HARMONIC CHECK (ECGDEX-EDR-RESP-ACCURACY §4 option 2) ─────────────────────────────────────
       The zero-crossing skip above defeats half-period SIDELOBES, but not a genuinely stronger
       harmonic. `_bandResp` is a DIFFERENCE OF TWO MOVING AVERAGES — a gentle roll-off — so a
       fundamental sitting AT the band edge is already attenuated while its second harmonic is not, and
       the search locks onto the harmonic. Measured before this fix: a 24 breaths/min carrier (0.4 Hz,
       exactly the upper band edge = the 2.5 s lower period bound) reported 12/min — exactly HALF —
       deterministically across three seeds.
       So: if HALF this lag is admissible and carries comparable correlation, the shorter period is the
       fundamental and the one found is its octave.

       ⚠ THE THRESHOLD IS A SIGN TEST, NOT A NEAR-EQUALITY TEST — and getting that wrong left the defect
       in place for the one rate this check exists for. The first version required `ac[half] > 0.8·best`,
       reasoning that an attenuated fundamental "only has to be close". It is not close: at 24/min the
       fundamental measures 0.745·best (0.766 on a second seed), so the check RAN and rejected the true
       answer by 0.035, and 24/min kept reporting 12. Tuning 0.8 down to 0.7 would just fit that one
       measurement.

       What actually separates the two cases is the SIGN, and the physics says why. If the found lag is
       the OCTAVE, the half-lag is a real period of the signal ⇒ ac[half] is positive. If the found lag
       is already the FUNDAMENTAL, the half-lag is ANTI-PHASE ⇒ ac[half] is strongly negative. Measured
       across 6–24/min × 2 seeds, that is exactly what happens and the populations do not overlap:

         half is WRONG (keep the lag found):  ac[half]/best = −1.26 … −2.89   (every rate 6–22)
         half is RIGHT (take the octave):     ac[half]/best = +0.745, +0.766  (24/min, both seeds)

       0.5·best sits in that gap with margin on both sides — 0.245 below the true positives, 1.76 above
       the nearest negative — and states the physical claim: the half-lag must be a genuine positive
       peak, not merely a shallower trough. */
    const half = Math.round(bestLag / 2);
    if (half >= start && half <= maxL && ac[half] > 0.5 * best) {
      best = ac[half];
      bestLag = half;
    }

    /* ── PARABOLIC INTERPOLATION (§4 option 1) ─────────────────────────────────────────────────────
       The search is over INTEGER lags on a 4 Hz grid, so the period quantises to 0.25 s — ~1.5 % at a
       3 s period but ~6 % at 4.3 s, which is why a true 14/min read 15.0 (lag 16 = 4.00 s rather than
       lag 17 = 4.25 s). Fitting a parabola through the peak and its two neighbours recovers the
       sub-sample maximum. Standard for autocorrelation/pitch estimation; it adds no assumption beyond
       local smoothness, which an autocorrelation peak has by construction.
       Guarded: needs both neighbours in range AND a real (negative-curvature) maximum — a degenerate or
       flat triple leaves the integer lag untouched rather than dividing by ~0. */
    let refined = bestLag;
    if (bestLag > 0 && bestLag < maxL) {
      const ym = ac[bestLag - 1],
        y0 = ac[bestLag],
        yp = ac[bestLag + 1];
      const curv = ym - 2 * y0 + yp;
      if (curv < 0) {
        const delta = (0.5 * (ym - yp)) / curv;
        if (delta > -1 && delta < 1) refined = bestLag + delta; // never leaves the neighbouring bins
      }
    }
    return refined / fs;
  }
  function _bandRespACC(x, fs) {
    // low-pass ~0.6 Hz then remove the ~<0.12 Hz baseline → isolate the respiratory band
    const lp = _maHalf(x, Math.max(1, Math.round((0.8 * fs) / 2)));
    const base = _maHalf(lp, Math.max(2, Math.round((4 * fs) / 2)));
    const o = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) o[i] = lp[i] - base[i];
    return o;
  }
  function _posture(gx, gy, gz) {
    // classify body position from the gravity (DC) vector. Orientation depends on how the
    // strap sensor is mounted; tilt from horizontal is the robust, mount-independent figure
    // (supine/prone ≈ 0°, upright ≈ 90°). Chest-strap convention: +z = anterior (chest-up).
    const g = Math.hypot(gx, gy, gz) || 1,
      ux = gx / g,
      uy = gy / g,
      uz = gz / g;
    const tiltDeg = +((Math.acos(Math.min(1, Math.abs(uz))) * 180) / Math.PI).toFixed(0);
    let label;
    if (Math.abs(uz) >= 0.7) label = uz > 0 ? 'Supine' : 'Prone';
    else if (Math.abs(uy) >= 0.55) label = uy > 0 ? 'Upright' : 'Head-down';
    else label = ux > 0 ? 'Left side' : 'Right side';
    return { label, tiltDeg };
  }
  // canonical sleep-position vocabulary shared across nodes (epoch.position + event meta.position).
  // Supine posture worsens OSA → consumers (Integrator) can weight osaConf/AHI by position.
  // 'Head-down' is sensor-mount noise; folds into 'upright'. Left/Right side → 'lateral'.
  function _normPosition(label) {
    switch (label) {
      case 'Supine':
        return 'supine';
      case 'Prone':
        return 'prone';
      case 'Left side':
      case 'Right side':
        return 'lateral';
      case 'Upright':
      case 'Head-down':
        return 'upright';
      default:
        return 'unknown';
    }
  }
  // Per-epoch body position from the companion accelerometer's gravity vector.
  // Mirrors accAnalyze's window math EXACTLY (same off/baseOffset alignment) so the
  // posture timeline shown in the UI and the position stamped on epochs/events agree.
  // Mutates each epoch in place (epoch.position) AND returns a sorted [{tMin,position}]
  // lookup for event-meta propagation. No ACC → every epoch.position = 'unknown'.
  function stampEpochPositions(epochs, deviceACC, accFs, ecgT0Ms, durSec) {
    if (!epochs || !epochs.length) return [];
    const fs = accFs || 4;
    if (!deviceACC || deviceACC.length < fs * 30) {
      epochs.forEach((e) => {
        e.position = 'unknown';
      });
      return epochs.map((e) => ({ tMin: e.tMin, position: 'unknown' }));
    }
    const xs = deviceACC.map((d) => d.x),
      ys = deviceACC.map((d) => d.y),
      zs = deviceACC.map((d) => d.z);
    const baseOffset = ecgT0Ms && deviceACC[0].tsMs ? (deviceACC[0].tsMs - ecgT0Ms) / 1000 : 0;
    const off = baseOffset >= -2 && baseOffset <= durSec ? baseOffset : 0;
    const N = deviceACC.length,
      out = [];
    for (const e of epochs) {
      const s0 = Math.max(0, Math.round((e.tMin * 60 - off) * fs)),
        s1 = Math.min(N, Math.round((e.tMin * 60 + 300 - off) * fs));
      const ex = [],
        ey = [],
        ez = [];
      for (let i = s0; i < s1; i++) {
        ex.push(xs[i]);
        ey.push(ys[i]);
        ez.push(zs[i]);
      }
      // need ≥30 s of samples for a trustworthy median gravity vector
      const pos = ex.length > fs * 30 ? _normPosition(_posture(median(ex), median(ey), median(ez)).label) : 'unknown';
      e.position = pos;
      out.push({ tMin: e.tMin, position: pos });
    }
    return out;
  }
  function accAnalyze(deviceACC, accFs, ecgT0Ms, durSec, epochs) {
    const fs = accFs || 4;
    if (!deviceACC || deviceACC.length < fs * 30) return null;
    const xs = deviceACC.map((d) => d.x),
      ys = deviceACC.map((d) => d.y),
      zs = deviceACC.map((d) => d.z);
    // vector-magnitude + timeline alignment
    const vm = new Float64Array(deviceACC.length);
    for (let i = 0; i < deviceACC.length; i++) vm[i] = Math.hypot(xs[i], ys[i], zs[i]);
    const baseOffset = ecgT0Ms && deviceACC[0].tsMs ? (deviceACC[0].tsMs - ecgT0Ms) / 1000 : 0;
    const off = baseOffset >= -2 && baseOffset <= durSec ? baseOffset : 0;
    // posture — robust gravity vector (per-axis median) → body position + tilt
    const overall = _posture(median(xs), median(ys), median(zs));
    // respiration: breathing is only cleanly visible when STILL, so locate the quietest
    // ~2-min window (lowest motion) and estimate the dominant respiratory period there.
    const winN = Math.min(vm.length, Math.round(Math.min(durSec, 120) * fs));
    let qStart = 0,
      qBest = Infinity;
    if (vm.length > winN) {
      const stepN = Math.max(1, Math.round(10 * fs));
      for (let s = 0; s + winN <= vm.length; s += stepN) {
        let m = 0;
        for (let i = s; i < s + winN; i++) m += vm[i];
        m /= winN;
        let v = 0;
        for (let i = s; i < s + winN; i++) v += (vm[i] - m) ** 2;
        v /= winN;
        if (v < qBest) {
          qBest = v;
          qStart = s;
        }
      }
    }
    const qEnd = Math.min(vm.length, qStart + winN);
    let bestAxis = 'x',
      bestP = -1,
      bestBand = null;
    for (const [name, arr] of [
      ['x', xs],
      ['y', ys],
      ['z', zs]
    ]) {
      const seg = Float64Array.from(arr.slice(qStart, qEnd));
      const b = _bandRespACC(seg, fs);
      let p = 0;
      for (let i = 0; i < b.length; i++) p += b[i] * b[i];
      if (p > bestP) {
        bestP = p;
        bestAxis = name;
        bestBand = b;
      }
    }
    const period = bestBand ? _autocorrPeriod(bestBand, fs, 2.5, 10) : null;
    const respRate = period ? +(60 / period).toFixed(1) : 0;
    // fixed-bin motion trace (always available, even for short spot recordings)
    const binSec = Math.max(4, Math.round(deviceACC.length / fs / 120)),
      motionSeries = [];
    const nb = Math.max(1, Math.floor(deviceACC.length / fs / binSec));
    for (let b = 0; b < nb; b++) {
      const i0 = Math.round(b * binSec * fs),
        i1 = Math.round((b + 1) * binSec * fs);
      let m = 0,
        c = 0;
      for (let i = i0; i < Math.min(vm.length, i1); i++) {
        m += vm[i];
        c++;
      }
      if (!c) continue;
      const mn = m / c;
      let v = 0;
      for (let i = i0; i < Math.min(vm.length, i1); i++) v += (vm[i] - mn) ** 2;
      motionSeries.push({ x: +(((b + 0.5) * binSec - off) / 60).toFixed(2), y: +Math.sqrt(v / c).toFixed(1) });
    }
    const mvVals = motionSeries.map((p) => p.y),
      mvMed = mvVals.length ? median(mvVals) : 0;
    // per-epoch movement + posture timeline
    const actSeries = [],
      postureSeries = [];
    if (epochs && epochs.length) {
      for (const e of epochs) {
        const s0 = Math.round((e.tMin * 60 - off) * fs),
          s1 = Math.round((e.tMin * 60 + 300 - off) * fs);
        const ex = [],
          ey = [],
          ez = [],
          seg = [];
        for (let i = Math.max(0, s0); i < Math.min(vm.length, s1); i++) {
          seg.push(vm[i]);
          ex.push(xs[i]);
          ey.push(ys[i]);
          ez.push(zs[i]);
        }
        if (seg.length > fs * 30) {
          actSeries.push({ tMin: e.tMin, act: +std(seg).toFixed(1), resp: e.resp || null });
          const pp = _posture(median(ex), median(ey), median(ez));
          postureSeries.push({ tMin: e.tMin, label: pp.label, tilt: pp.tiltDeg });
        }
      }
    }
    const acts = actSeries.map((a) => a.act),
      actMed = acts.length ? median(acts) : 0;
    const highMotion = actSeries.filter((a) => a.act > actMed * 2.2).map((a) => a.tMin);
    // time-in-posture + transition count
    const postureTally = {};
    let transitions = 0,
      prev = null;
    for (const ps of postureSeries) {
      postureTally[ps.label] = (postureTally[ps.label] || 0) + 1;
      if (prev && prev !== ps.label) transitions++;
      prev = ps.label;
    }
    const postureBreakdown = Object.entries(postureTally)
      .map(([label, n]) => ({ label, pct: Math.round((n / postureSeries.length) * 100) }))
      .sort((a, b) => b.pct - a.pct);
    return {
      respRate,
      respAxis: bestAxis,
      respConfident: !!period,
      accFs: fs,
      posture: overall.label,
      tiltDeg: overall.tiltDeg,
      postureSeries,
      postureBreakdown,
      postureTransitions: transitions,
      motionSeries,
      motionMedian: +mvMed.toFixed(1),
      activitySeries: actSeries,
      activityMedian: +actMed.toFixed(1),
      highMotionEpochs: highMotion,
      nSamples: deviceACC.length,
      durMin: +(deviceACC.length / fs / 60).toFixed(1)
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ACC FULL PIPELINE — RRacc · EDR-agreement · sleep-stage consensus · gait.
  //  Adapts the original 200/52-Hz·30-s-epoch brief to the suite's real data:
  //  4-Hz synthetic ground-truth ACC + the 5-min epoch engine. Respiration is
  //  recovered by FFT on an ~8-Hz working grid (Nyquist far above the 0.45-Hz
  //  resp band); steps run at the NATIVE fs and only when the band is resolvable
  //  (fs ≥ 7 Hz → Nyquist > 3.5 Hz). All timing stays relative-seconds off the
  //  floating t0Ms (Clock Contract) — no Date math here.
  // ════════════════════════════════════════════════════════════════════════

  // radix-2 iterative in-place FFT (Cooley–Tukey). re/im: Float64Array, len = 2^k.
  function _fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len,
        wr0 = Math.cos(ang),
        wi0 = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1,
          ci = 0;
        for (let k = 0; k < len >> 1; k++) {
          const a = i + k,
            b = a + (len >> 1);
          const tr = re[b] * cr - im[b] * ci,
            ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
          const ncr = cr * wr0 - ci * wi0;
          ci = cr * wi0 + ci * wr0;
          cr = ncr;
        }
      }
    }
  }
  // block-mean resample of a magnitude series fsIn → fsOut
  function _resampleMag(vm, fsIn, fsOut) {
    if (Math.abs(fsIn - fsOut) < 0.51) return Float64Array.from(vm);
    const ratio = fsIn / fsOut,
      M = Math.max(1, Math.floor(vm.length / ratio)),
      o = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const s0 = Math.floor(i * ratio),
        s1 = Math.max(s0 + 1, Math.floor((i + 1) * ratio));
      let a = 0,
        c = 0;
      for (let k = s0; k < Math.min(vm.length, s1); k++) {
        a += vm[k];
        c++;
      }
      o[i] = c ? a / c : 0;
    }
    return o;
  }
  // RBJ constant-0-dB bandpass biquad (causal) — used for the step band
  function _biquadBand(x, fs, f0, bw) {
    const w0 = (2 * Math.PI * f0) / fs,
      Q = f0 / bw,
      sw = Math.sin(w0),
      cw = Math.cos(w0),
      alpha = sw / (2 * Q);
    let b0 = alpha,
      b1 = 0,
      b2 = -alpha,
      a0 = 1 + alpha,
      a1 = -2 * cw,
      a2 = 1 - alpha;
    b0 /= a0;
    b1 /= a0;
    b2 /= a0;
    a1 /= a0;
    a2 /= a0;
    const N = x.length,
      y = new Float64Array(N);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < N; i++) {
      const xi = x[i],
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = yi;
      y[i] = yi;
    }
    return y;
  }
  // Feature 1 — RRacc per 30-s epoch: detrend (5-s moving avg) → Hann → FFT →
  // dominant bin in 0.15–0.45 Hz; SNR = peak / mean(out-of-band), gate at 3 dB.
  function _rraccEpochs(vm, fs, off) {
    const WR = 8,
      useRs = fs > WR + 0.5,
      wr = useRs ? _resampleMag(vm, fs, WR) : Float64Array.from(vm),
      wfs = useRs ? WR : fs,
      N = wr.length;
    const half = Math.max(1, Math.round(2.5 * wfs)),
      d = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - half),
        b = Math.min(N, i + half + 1);
      let s = 0;
      for (let k = a; k < b; k++) s += wr[k];
      d[i] = wr[i] - s / (b - a);
    }
    const epochLen = Math.round(30 * wfs);
    if (epochLen < 8 || N < epochLen) return [];
    let nf = 1;
    while (nf < epochLen) nf <<= 1;
    nf = Math.min(nf, 2048);
    const df = wfs / nf,
      loBin = Math.max(1, Math.round(0.15 / df)),
      hiBin = Math.min((nf >> 1) - 1, Math.round(0.45 / df)),
      out = [];
    for (let e = 0; (e + 1) * epochLen <= N; e++) {
      const s0 = e * epochLen,
        re = new Float64Array(nf),
        im = new Float64Array(nf);
      let mu = 0;
      for (let i = 0; i < epochLen; i++) mu += d[s0 + i];
      mu /= epochLen;
      for (let i = 0; i < epochLen; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (epochLen - 1));
        re[i] = (d[s0 + i] - mu) * w;
      }
      _fft(re, im);
      const half2 = nf >> 1,
        pw = new Float64Array(half2);
      for (let b = 1; b < half2; b++) pw[b] = re[b] * re[b] + im[b] * im[b];
      let peak = -1,
        peakBin = loBin,
        obSum = 0,
        obN = 0;
      for (let b = loBin; b <= hiBin; b++) {
        if (pw[b] > peak) {
          peak = pw[b];
          peakBin = b;
        }
      }
      for (let b = 1; b < half2; b++) {
        if (b < loBin || b > hiBin) {
          obSum += pw[b];
          obN++;
        }
      }
      const obMean = obN ? obSum / obN : 1e-9,
        snrDb = 10 * Math.log10((peak || 1e-12) / (obMean || 1e-12));
      out.push({ tStartMin: +((e * 30 - off) / 60).toFixed(2), rr: +(peakBin * df * 60).toFixed(1), snrDb: +snrDb.toFixed(1), conf: snrDb >= 3 ? 'high' : 'low' });
    }
    return out;
  }
  // Feature 4 — step detection + gait on the NATIVE-fs de-gravitated magnitude
  function _gait(vm, fs, off) {
    const N = vm.length,
      stepBandOK = fs >= 7;
    if (!stepBandOK) return { totalSteps: 0, walking: false, reason: 'lowfs', accFs: fs, bouts: [], cadEpochs: [], zonePct: [] };
    // vertical proxy: magnitude − 30-s running-mean gravity baseline (prefix sums)
    const win = Math.max(1, Math.round(30 * fs)),
      half = win >> 1,
      ps = new Float64Array(N + 1),
      V = new Float64Array(N);
    for (let i = 0; i < N; i++) ps[i + 1] = ps[i] + vm[i];
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - half),
        b = Math.min(N, i + half + 1);
      V[i] = vm[i] - (ps[b] - ps[a]) / (b - a);
    }
    const F = _biquadBand(V, fs, Math.sqrt(0.5 * 3.5), 3.0);
    const minGap = Math.round(0.25 * fs),
      maxGap = Math.round(2.0 * fs),
      peaks = [];
    let lastPk = -1e9;
    const recent = [];
    for (let i = 1; i < N - 1; i++) {
      if (F[i] > F[i - 1] && F[i] >= F[i + 1]) {
        const rms = recent.length ? Math.sqrt(recent.reduce((s, v) => s + v * v, 0) / recent.length) : 0,
          thr = 0.6 * rms;
        if (F[i] > thr && i - lastPk >= minGap) {
          peaks.push(i);
          lastPk = i;
          recent.push(F[i]);
          if (recent.length > 10) recent.shift();
        }
      }
    }
    // bouts: runs of peaks with gap ≤ maxGap, ≥10 steps
    const bouts = [];
    let cur = [];
    for (let k = 0; k < peaks.length; k++) {
      if (!cur.length) {
        cur = [peaks[k]];
        continue;
      }
      if (peaks[k] - cur[cur.length - 1] <= maxGap) cur.push(peaks[k]);
      else {
        if (cur.length >= 10) bouts.push(cur);
        cur = [peaks[k]];
      }
    }
    if (cur.length >= 10) bouts.push(cur);
    const boutObjs = bouts.map((b) => {
      const durS = (b[b.length - 1] - b[0]) / fs || 1,
        cad = [];
      for (let k = 1; k < b.length; k++) {
        const dt = (b[k] - b[k - 1]) / fs;
        if (dt > 0) cad.push(60 / dt);
      }
      const mc = cad.length ? mean(cad) : 0,
        cv = cad.length > 1 && mc > 0 ? (std(cad) / mc) * 100 : 0;
      return { startMin: +((b[0] / fs - off) / 60).toFixed(2), durSec: +durS.toFixed(0), steps: b.length, cadence: +mc.toFixed(0), cadenceCV: +cv.toFixed(0) };
    });
    const totalSteps = boutObjs.reduce((s, b) => s + b.steps, 0);
    const epLen = Math.round(60 * fs),
      cadEp = [];
    for (let e = 0; (e + 1) * epLen <= N; e++) {
      const s0 = e * epLen,
        s1 = (e + 1) * epLen;
      let c = 0;
      for (const p of peaks) {
        if (p >= s0 && p < s1) c++;
      }
      cadEp.push({ tMin: +((e * 60 - off) / 60).toFixed(2), cadence: c });
    }
    /** @type {[string,number,number,string][]} */
    const zoneDef = [
      ['Sedentary', 0, 20, 'gray'],
      ['Low active', 20, 60, 'blue'],
      ['Light walk', 60, 100, 'green'],
      ['Brisk walk', 100, 120, 'amber'],
      ['Vigorous', 120, 1e9, 'red']
    ];
    const zones = {};
    zoneDef.forEach((z) => (zones[z[0]] = 0));
    cadEp.forEach((c) => {
      for (const z of zoneDef) {
        if (c.cadence >= z[1] && c.cadence < z[2]) {
          zones[z[0]]++;
          break;
        }
      }
    });
    const totalEp = cadEp.length || 1,
      zonePct = zoneDef.map((z) => ({ zone: z[0], col: z[3], pct: Math.round((zones[z[0]] / totalEp) * 100), epochs: zones[z[0]] }));
    return { totalSteps, walking: totalSteps >= 50, accFs: fs, bouts: boutObjs, cadEpochs: cadEp, zonePct };
  }
  // Orchestrator — returns the four feature payloads (or null if no usable ACC).
  /* Discrete movement onsets from a motion grid.

     DUPLICATED, DELIBERATELY, from `PPGDSP.movementOnsets` — ECGDex.src.html does not bundle
     ppgdex-dsp.js, and adding a shared module would mean touching every co-load list, both
     orchestrators and the worker importScripts sets for twenty lines. The duplication is GATED
     instead: `movement-onset-parity` asserts both implementations return identical onsets for the
     same input, the same way `registry-defs-parity` gates a projection against its source. If they
     ever diverge, the suite reds rather than the two nodes quietly disagreeing about when you moved.

     Three conditions, all necessary — the shape `PATAlign.findAnchors` uses, for the same reason: a
     bare threshold fires repeatedly across one long turn, and every extra hit on the SAME movement is
     a correlated vote, not an independent one. */
  function _movementOnsets(grid, dtSec, opts) {
    opts = opts || {};
    const kSigma = opts.sigma != null ? opts.sigma : 3;
    const localBins = opts.localBins != null ? opts.localBins : Math.max(1, Math.round(5 / dtSec));
    const minGapSec = opts.minGapSec != null ? opts.minGapSec : 30;
    if (!grid || !grid.length || !(dtSec > 0)) return [];
    const n = grid.length;
    /* mean + k·SD. A MAD-based threshold was tried and REJECTED: MAD tracks the quiet baseline, which
       on a differenced (jerk) grid is almost zero, so the threshold collapses and the detector fired
       713 times in one night instead of 29. The tail this distribution carries is the SIGNAL, and a
       threshold that ignores it is not robust, it is blind. */
    let m = 0;
    for (let i = 0; i < n; i++) m += grid[i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = grid[i] - m;
      v += d * d;
    }
    const sd = Math.sqrt(v / n) || 1;
    const thr = m + kSigma * sd;
    const out = [];
    let last = -Infinity;
    for (let c = 0; c < n; c++) {
      if (grid[c] < thr) continue;
      let isMax = true;
      for (let k = c - localBins; k <= c + localBins; k++) {
        if (k >= 0 && k < n && grid[k] > grid[c]) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      const sec = c * dtSec;
      if (sec - last < minGapSec) continue;
      out.push(sec);
      last = sec;
    }
    return out;
  }

  function accExtras(deviceACC, accFs, ecgT0Ms, durSec, epochs, stages) {
    // Declared at function scope so the epoch motion series survives the staging block it is built in
    // (that block is conditional; a night with no HRV stages still has ACC observations worth exporting).
    let motionByTMin = null;
    const fs = accFs || 4;
    if (!deviceACC || deviceACC.length < fs * 30) return null;
    const N = deviceACC.length,
      xs = deviceACC.map((d) => d.x),
      ys = deviceACC.map((d) => d.y),
      zs = deviceACC.map((d) => d.z);
    const vm = new Float64Array(N);
    for (let i = 0; i < N; i++) vm[i] = Math.hypot(xs[i], ys[i], zs[i]);
    const baseOffset = ecgT0Ms && deviceACC[0].tsMs ? (deviceACC[0].tsMs - ecgT0Ms) / 1000 : 0;
    const off = baseOffset >= -2 && baseOffset <= durSec ? baseOffset : 0;

    // ── Feature 1: RRacc per 30-s epoch ──
    /* CHEST MOVEMENT ONSETS — the arousal fiducial an apnea leaves on the H10's accelerometer.
       From JERK (|d|vm||), not |vm| itself: the vector magnitude is dominated by gravity plus the
       always-present respiratory chest excursion, so thresholding it marks BREATHING, not movement.
       Differencing suppresses both and leaves gross body motion, which is what an arousal produces.
       Binned to 0.25 s to match the grid PpgDex uses, so the two nodes' onsets are directly comparable
       (gated by the movement-onset parity test).
       Deliberately computed here rather than in the staging block below, which only runs when epochs
       AND stages both exist — a clock fit must not silently lose its best channel because staging was
       unavailable. */
    const _mvDt = 0.25;
    const _mvN = Math.max(1, Math.ceil(durSec / _mvDt));
    const _mvGrid = new Float64Array(_mvN);
    for (let i = 1; i < N; i++) {
      const d = Math.abs(vm[i] - vm[i - 1]);
      if (!Number.isFinite(d)) continue;
      const g = Math.floor((i / fs - off) / _mvDt);
      if (g >= 0 && g < _mvN && d > _mvGrid[g]) _mvGrid[g] = d;
    }
    const movementOnsets = _movementOnsets(_mvGrid, _mvDt, {});

    const rracc = _rraccEpochs(vm, fs, off);
    const hi = rracc.filter((e) => e.conf === 'high'),
      rrVals = hi.map((e) => e.rr);
    const rraccSummary = rracc.length
      ? { mean: rrVals.length ? +mean(rrVals).toFixed(1) : null, sd: rrVals.length > 1 ? +std(rrVals).toFixed(1) : null, highPct: Math.round((hi.length / rracc.length) * 100), nEpochs: rracc.length }
      : null;

    // ── Feature 2: RRacc vs EDR agreement (paired at the 5-min EDR cadence) ──
    let agreement = null;
    const edrEp = (epochs || []).filter((e) => e.resp > 0).map((e) => ({ tMin: e.tMin, edr: e.resp }));
    if (rracc.length && edrEp.length) {
      const pairs = [];
      for (const ep of edrEp) {
        const inWin = hi.filter((r) => r.tStartMin >= ep.tMin && r.tStartMin < ep.tMin + 5);
        if (inWin.length) pairs.push({ acc: median(inWin.map((r) => r.rr)), edr: ep.edr, tMin: ep.tMin });
      }
      if (pairs.length >= 3) {
        const deltas = pairs.map((p) => p.acc - p.edr),
          md = mean(deltas),
          sdd = std(deltas),
          mae = mean(deltas.map((d) => Math.abs(d)));
        const ax = pairs.map((p) => p.acc),
          ex = pairs.map((p) => p.edr),
          max = mean(ax),
          mex = mean(ex);
        let num = 0,
          da = 0,
          de = 0;
        for (let i = 0; i < pairs.length; i++) {
          const va = ax[i] - max,
            ve = ex[i] - mex;
          num += va * ve;
          da += va * va;
          de += ve * ve;
        }
        const r = da > 0 && de > 0 ? num / Math.sqrt(da * de) : 0,
          disagree = deltas.filter((x) => Math.abs(x) > 3).length;
        agreement = {
          n: pairs.length,
          meanDelta: +md.toFixed(2),
          sdDelta: +sdd.toFixed(2),
          mae: +mae.toFixed(2),
          r: +r.toFixed(2),
          disagreeRate: Math.round((disagree / pairs.length) * 100),
          loa: [+(md - 1.96 * sdd).toFixed(1), +(md + 1.96 * sdd).toFixed(1)],
          ba: pairs.map((p) => ({ mean: +((p.acc + p.edr) / 2).toFixed(1), diff: +(p.acc - p.edr).toFixed(1) }))
        };
      }
    }

    // ── Feature 3: sleep-stage consensus (ACC motion vote vs HRV stages) ──
    let consensus = null;
    if (epochs && epochs.length && stages && stages.length) {
      const stageBy = {};
      stages.forEach((s) => (stageBy[s.tMin.toFixed(1)] = s.stage));
      // GROSS-motion index from jerk (|Δ vector-magnitude|): suppresses the always-present
      // respiratory chest movement + gravity baseline, so only real body movement scores.
      const dmv = new Float64Array(N);
      for (let i = 1; i < N; i++) dmv[i] = Math.abs(vm[i] - vm[i - 1]);
      const rawMot = [];
      for (const e of epochs) {
        const s0 = Math.round((e.tMin * 60 - off) * fs),
          s1 = Math.round((e.tMin * 60 + 300 - off) * fs);
        let a = 0,
          c = 0;
        for (let i = Math.max(1, s0); i < Math.min(N, s1); i++) {
          // A NON-FINITE sample is a HOLE, not a reading. It must lower COVERAGE (c), never enter the
          // mean: one NaN would otherwise make the whole epoch's activity NaN. Holes appear when a
          // caller lays several ACC sessions onto one uniform grid and pads the silence between them —
          // the only way to keep index↔time alignment across a gap. Inert for a single continuous
          // session, where parseDeviceACC has already dropped every non-finite row.
          const d = dmv[i];
          if (!Number.isFinite(d)) continue;
          a += d;
          c++;
        }
        rawMot.push({ tMin: e.tMin, act: c > fs * 30 ? a / c : null });
      }
      const actVals = /** @type {number[]} */ (rawMot.filter((m) => m.act != null).map((m) => m.act)).slice().sort((a, b) => a - b);
      const qOf = (p) => (actVals.length ? actVals[Math.min(actVals.length - 1, Math.floor(actVals.length * p))] : 0);
      const floor = qOf(0.5),
        top = qOf(0.95),
        span = Math.max(top - floor, 1e-6); // typical-sleep median → 0, p95 → 100
      let agreed = 0,
        total = 0,
        abstained = 0;
      const conflicts = [],
        voteRows = [];
      /* The per-epoch motion index, keyed by tMin, for EVERY epoch the ACC actually observed.
         It was already being computed here — but only INSIDE the vote loop, which `continue`s
         whenever the HRV stage for that epoch is missing, and it never left this block. So ECGDex
         exported no motionIndex at all while PpgDex and OxyDex both do, and the correlated-TCH's
         motion-ρ leg had two corners instead of three: measured over the 2026-07-16..26 corpus,
         every one of 11 nights folded with "ECGDex … 0 motion".
         Built here rather than in the loop because a motion observation does not depend on the HRV
         stager having an opinion — gating the two together is what made an available measurement
         look absent. Scale is the night's own median→0, p95→100, same as the vote reads; ρ is a
         correlation, so a per-node scale is what the other two corners use too. */
      // SINGLE-SOURCED with the stager (epochMotion). This block used to own the only copy of the
      // computation, which is why it could not be reached before staging; it now consumes the same
      // helper, so the index the classifier votes on and the index the bus publishes cannot drift.
      motionByTMin = epochMotion(deviceACC, fs, ecgT0Ms, durSec, epochs);
      for (const m of rawMot) {
        if (m.act == null) continue;
        const hrv = stageBy[m.tMin.toFixed(1)];
        if (!hrv) continue;
        const idx = Math.max(0, Math.min(100, ((m.act - floor) / span) * 100)),
          vote = idx > 20 ? 'Wake (motion)' : idx >= 5 ? 'Ambiguous' : 'Sleep (still)',
          hrvWake = hrv === 'Wake';
        total++;
        let status;
        if (vote === 'Ambiguous') {
          /* AN ABSTENTION IS NOT AN AGREEMENT (DEEP-AUDIT-III §6.1). The ACC vote is explicitly
             tri-state — the exported method string says "Wake>20 / Ambiguous 5–20 / Sleep<5" — and
             the middle state is the accelerometer DECLINING TO VOTE. Counting it as `agreed++` put
             it in the numerator while it also sat in the denominator, inflating the surfaced staging
             consensus % and its Strong/Moderate/Weak pill. It now leaves BOTH, which is what class
             3a requires of an epoch that carries no observation. */
          abstained++;
          status = 'ambiguous';
        } else if (hrvWake && vote === 'Wake (motion)') {
          agreed++;
          status = 'confirm-wake';
        } else if (!hrvWake && vote === 'Sleep (still)') {
          agreed++;
          status = 'confirm-sleep';
        } else {
          status = 'conflict';
          conflicts.push({ tMin: m.tMin, hrv, vote, dir: hrvWake ? 'HRV Wake · ACC still' : 'HRV ' + hrv + ' · ACC motion' });
        }
        voteRows.push({ tMin: m.tMin, idx: Math.round(idx), vote, hrv, status });
      }
      // Denominator = epochs where the ACC actually VOTED. `n` stays the epochs examined so the two
      // can never be confused, and `nAbstained` is published so a mostly-ambiguous night is visible
      // as thin evidence rather than as a confident score.
      const nVoted = total - abstained;
      if (nVoted >= 3) consensus = { rate: Math.round((agreed / nVoted) * 100), n: total, nVoted, nAbstained: abstained, nConflict: conflicts.length, conflicts: conflicts.slice(0, 40), voteRows };
    }

    // ── Feature 4: step count & gait ──
    const gait = _gait(vm, fs, off);

    return { rracc, rraccSummary, agreement, consensus, gait, off, accFs: fs, motionByTMin, movementOnsets, durMin: +(N / fs / 60).toFixed(1) };
  }

  // ── multi-part split files (Polar Sensor Logger) ───────────────────────────
  // `…_ECG_part01of05.txt` … `of05` (and split ACC). Each part repeats the header.
  // Group by part-stripped base, concatenate in numeric part order (header from
  // part 1 only). Pure + DOM-free → unit-tested in both runners. The ECGDex app
  // streams primary-ECG part groups into one worker run and uses mergeMultipart
  // for the small companion (ACC/RR/HR) text streams.
  function partKey(name) {
    var m = String(name || '').match(/^(.*)_part(\d+)of(\d+)(\.[^.]*)?$/i);
    return m ? { base: m[1] + (m[4] || ''), part: +m[2], total: +m[3] } : null;
  }
  function mergeMultipart(parsed) {
    // parsed = [{name,text,kind?,stampMs?}]
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
      merged.push({ name: base, text: text, kind: arr[0].kind, stampMs: arr[0].stampMs, parts: arr.length });
    });
    return singles.concat(merged);
  }

  global.ECGDSP = {
    genSynthetic,
    analyze,
    classifyMode,
    validateRR,
    alignFirmwareRR,
    validateHR,
    accAnalyze,
    accExtras,
    movementOnsets: _movementOnsets, // exported for `movement-onset-parity` — the gate on the duplication
    /* Exposed for the `ecgdex-hrv-geometry` known-answer gate. Both were measured PSEUDO-TESTED
       2026-08-12 — covered by `analyze`, asserted by nobody — and the only route to them was a full
       raw-ECG run, which cannot pin a hand-derived histogram. Reaching them directly is what makes a
       known-answer possible. Additive export; nothing else consumes these. */
    triangularIndex,
    fragmentation,
    /* Same reason as the two above (`ecgdex-hrv-geometry`): measured PSEUDO-TESTED, and the only
       route to it was a full raw-ECG `analyze` run, which cannot pin a hand-derived thirds split.
       Additive; nothing else consumes it. */
    surgeEscalation,
    // Additive (contract rule: new data via a NEW field, never by changing an existing shape) —
    // the staging rules and the motion index are now gateable in their own right.
    stageSleep,
    epochMotion,
    stampEpochPositions,
    bandpass,
    detectPeaks,
    /* Additive, same contract rule as the block above. DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS §EP-rest could
       not reach the composite per-beat SQI weights (0.30·kSQI + 0.28·bSQI + 0.24·rrPlaus + 0.18·ampOK)
       through `analyze`, because `genSynthetic` — even `scenario:'ambulatory'` — emits beats at sqi≈1,
       where every term is 1 and any weights summing to 1 give the same answer. Exposing the pure function
       lets a test hand it crafted beats in which exactly ONE term differs, so each weight is pinned by a
       DIFFERENCE. Export-only: no call site changes, so this is compute-inert. */
    computeSQI,
    /* Additive, and it is what makes `computeSQI` REACHABLE from outside for the bSQI term.
       TCH-FUSED-ROBUST-HAT-FOLLOWUPS Do 5 finding 3: `computeSQI(int16, fs, peaks, times, peaksB)`
       requires `peaksB`, and only `detectPeaksB` produces it — so exporting the scorer without its
       second detector left the two-detector-agreement term unreachable, and a suspected-dead cue
       unmeasurable, from any consumer or gate. Export-only: no call site changes, compute-inert. */
    detectPeaksB,
    buildNN,
    beatConfidence,
    hrConfidence,
    median,
    mean,
    std,
    rmssd,
    partKey,
    mergeMultipart,
    lombScargle,
    /* Exported so their refusal guards are directly assertable. Additive only — no existing caller
       reaches them through this surface, and the internal call sites are unchanged. */
    poincareGeo,
    detectCVHR,
    cardiorespCoupling,
    dfaAlpha1,
    sampEn,
    parseTimestamp
  };

  /* ════════════════════════════════════════════════════════════════════════════════════════════
     THE ECG TIMING WALK — ONE implementation, BOTH lanes (DEEP-AUDIT-VI F2, 2026-09-01)
     ─────────────────────────────────────────────────────────────────────────────────────────────
     Everything this node knows about an ECG file's CLOCK — the sample rate, the dropouts, the
     mid-file resyncs, the host discipline, the device epoch — used to exist TWICE: here, and as a
     hand-written mirror inside `ecgdex-app.js`'s Blob worker. The banner below claimed the two
     were byte-for-byte; measured 2026-09-01 they were 96–320 ppm apart on real corpus nights,
     because this side gained the integer ns-counter rate, the host-axis correction and the resync
     discriminator and the worker's copy gained none of them. The app therefore analysed the same
     bytes on a different time axis than the gated headless path, and its exports carried no
     `hostAxis`/`deviceEpoch`/`tMsAt` at all.

     The fix is NOT to port the missing arithmetic into the worker — that is a third mirror, and
     this file already carries the tombstone of the last one (`CLOCK-UNIFY`, the worker's inline
     `_ckPF` that silently skipped the Clock Contract §2.7 range guard). It is to split the walk at
     the ONE line a Worker cannot cross:

       · `ecgTimingScan()`   — pure, SELF-CONTAINED arithmetic over rows. No DexClock, no closure
                               over module scope: `ecgdex-app.js` builds its worker from this
                               function's own `toString()`, so the worker RUNS this text rather
                               than a copy of it (gate: `ecgdex-app · worker runs the DSP's scan`).
                               It parses no timestamps — every stamp it meets travels out RAW.
       · `ecgTimingResolve()` — every DECISION, on the main thread where DexClock lives: which
                               candidates are resyncs, which axis sets `fs`, whether the host
                               correction is trustworthy, where each sample sits in time.

     WHY A RAW SCAN IS SUFFICIENT — the property that makes the split honest: a resync shifts the
     device axis by a constant, and every quantity the scan computes is a DIFFERENCE (sample-step
     sums, gap candidate deltas) or a value carried out verbatim (an anchor's raw counter). All of
     them are invariant under that shift, so the scan never needs to know a seam happened and
     `ecgTimingResolve` owns 100 % of the offset arithmetic. A scan that had to apply offsets could
     not be split from the parser, and this whole section would be a mirror again. */
  function ecgTimingScan() {
    // Local, deliberately: this function's TEXT is shipped into the app's Worker, so it may not
    // reference module scope. The two rate constants are the same numbers `ecgTimingResolve` and
    // the parser used before the split; the gate asserts the worker's copy of them agrees.
    var AXIS_EVERY = 500; // ≈3.8 s at 130 Hz → ~4000 anchors on a 434 min file
    var SAMPLE_MAX_MS = 50; // above this a delta is a dropout candidate, never a sample interval
    var nsCol = null,
      sawFirstRow = false;
    var prevMs = null,
      msStep = null,
      stepSum = 0,
      stepN = 0,
      firstRelMs = null,
      lastRelMs = null;
    var prevNsMs = null,
      firstNsMs = null,
      nsStepSum = 0,
      nsStepN = 0;
    var headStamps = [],
      lastStamp = null,
      prevStamp = null;
    var candidates = [],
      anchors = [];
    return {
      /* Called for the FIRST line only, and only when its last column is non-numeric (i.e. it is a
         header). Locating the ns column BY HEADER NAME rather than by position is the same rule
         PpgDex's channel layout follows, and for the same reason: a positional guess is silently
         wrong on a layout it was not written for. */
      header: function (cols) {
        for (var hc = 0; hc < cols.length; hc++) if (/sensor\s*timestamp/i.test(cols[hc])) nsCol = hc;
      },
      /* One DATA row. `sampleIdx` is the caller's post-push sample count (1 for the first row), so
         `sampleIdx - 1` is the index of this row's sample — the `gaps[].idx` first-after-the-hole
         convention both producers must agree on (INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS §2.1). */
      row: function (p, sampleIdx) {
        var stamp = p[0] != null && String(p[0]).trim() ? p[0] : null;
        /* THE RECORDING'S ANCHOR is Clock Contract §4's "tMs of the first VALID sample" — the first
           stamp that PARSES, not merely the first that is non-empty: one malformed leading row
           invalidates that row, not the night. The scan cannot parse, so it carries the head stamps
           out and `ecgTimingResolve` takes the first that resolves.
           BOUNDED AT 64 (≈0.5 s of ECG), and the bound is stated rather than silent: an unbounded
           list would be an unbounded worker payload on a file whose stamp column is junk throughout,
           and a file with 64 consecutive unparseable stamps does not have a clock column this parser
           understands — `ecgTimingResolve` says exactly that instead of returning a later row's
           anchor. */
        if (stamp !== null && headStamps.length < 64) headStamps.push(stamp);
        /* The LAST valid row's phone stamp is the recording's clock END — kept RAW, empty included,
           so an unstamped final row resolves to `null` rather than reaching back for an earlier row's
           clock. READING the end is honest where reconstructing it from `durSec` + `gaps` is not:
           durSec is DATA seconds, so t0+durSec lands short of the truth by exactly the dropout time.
           Measured on the 2026-07-16..26 capture corpus, that shortfall put ECGDex's own events
           outside its declared window on 11 of 11 nights, by +8 min to +326 min. */
        lastStamp = p[0];
        sawFirstRow = true;
        // Device counter for THIS row, in ms, RAW. `Number('')` is 0, not NaN, so the empty-string
        // case is excluded explicitly rather than by a sign test — and `> 0` would be WRONG: a
        // counter legitimately STARTS at 0, and rejecting row 0 anchors `firstNsMs` one sample late,
        // which reads as a 7.692 ms host↔device spread and flips `independent` on a derived column.
        var nsMs = null,
          prevNsOfRow = null;
        if (nsCol !== null && p.length > nsCol) {
          var nsRaw = p[nsCol];
          var rawNs = nsRaw === '' || nsRaw == null ? NaN : Number(nsRaw);
          if (isFinite(rawNs)) {
            nsMs = rawNs / 1e6;
            if (firstNsMs === null) firstNsMs = nsMs;
            if (prevNsMs !== null) {
              var dn = nsMs - prevNsMs;
              // The ns column carries no float noise, so it needs no `msStep * 2.5` slack — the same
              // `< 50` guard the `[ms]` path uses excludes dropout rows from the rate.
              if (dn > 0 && dn < SAMPLE_MAX_MS) {
                nsStepSum += dn;
                nsStepN++;
              }
            }
            /* The resync decision needs the PREVIOUS row's ns value; `prevNsMs` is about to hold
               THIS row's stepped one, and re-anchoring against that computes the adjustment off the
               wrong baseline (caught on the real 2026-08-27 seam: +86 s instead of −2.41e11 ms). */
            prevNsOfRow = prevNsMs;
            prevNsMs = nsMs;
          }
        }
        if (p.length >= 3) {
          var ms = parseFloat(p[2]);
          if (isFinite(ms)) {
            if (firstRelMs === null) firstRelMs = ms;
            lastRelMs = ms;
            if (prevMs !== null) {
              var d = ms - prevMs;
              if (d > 0) {
                if (msStep === null && d < SAMPLE_MAX_MS) msStep = d; // provisional step — anchors the gap threshold
                if (msStep && d > msStep * 2.5) {
                  /* A CANDIDATE, not a verdict. Which clock says so is `ecgTimingResolve`'s
                     question, and answering it needs the phone stamps parsed — so both stamps
                     travel out and nothing here decides. */
                  candidates.push({ idx: sampleIdx - 1, d: d, rawMs: ms, prevRawMs: prevMs, rawNsMs: nsMs, prevRawNsMs: prevNsOfRow, stamp: stamp, prevStamp: prevStamp });
                } else if (d < SAMPLE_MAX_MS) {
                  stepSum += d;
                  stepN++;
                }
              }
            }
            prevMs = ms;
            /* The seam discriminator's "previous row" is the previous MS-CHAIN row, not simply the
               previous data row — a row without a usable `[ms]` column took part in neither delta. */
            prevStamp = p[0];
          }
        }
        /* Host anchor, sampled. Emitted with the RAW device values and the RAW stamp; whether it is
           usable (does the stamp parse? did a resync invalidate it?) is resolved later. Row 1 is
           included so anchor 0 is exactly (0,0) once rebased — the node has already anchored `t0Ms`
           there, and a non-zero start would double-count it. */
        if (firstRelMs !== null && p.length >= 3 && (sampleIdx === 1 || sampleIdx % AXIS_EVERY === 0) && stamp !== null) {
          var aRel = parseFloat(p[2]);
          if (isFinite(aRel) || nsMs !== null) anchors.push({ idx: sampleIdx - 1, rawMs: isFinite(aRel) ? aRel : null, rawNsMs: nsMs, stamp: stamp });
        }
      },
      done: function () {
        return {
          nsCol: nsCol,
          sawFirstRow: sawFirstRow,
          msStep: msStep,
          stepSum: stepSum,
          stepN: stepN,
          nsStepSum: nsStepSum,
          nsStepN: nsStepN,
          firstRelMs: firstRelMs,
          lastRelMs: lastRelMs,
          firstNsMs: firstNsMs,
          headStamps: headStamps,
          lastStamp: lastStamp,
          candidates: candidates,
          anchors: anchors
        };
      }
    };
  }

  /* Every clock DECISION, from a scan. Runs where DexClock does — the headless parser calls it
     directly, the app calls it on the main thread with the scan its Worker shipped back — so the
     two lanes cannot drift: there is one copy of this arithmetic and one copy of the scan's.
     Returns the timing half of a rec; the caller supplies `int16`/`source`. */
  function ecgTimingResolve(scan) {
    /* ── MID-FILE CLOCK RESYNC (DEEP-AUDIT-VI F1, 2026-09-01) ─────────────────────────────────────
       The H10 boots on its 2019-01-01 firmware epoch and adopts real time when a sync lands — and
       when that happens MID-FILE, both device columns (`[ms]` and `sensor [ns]`) step by the whole
       epoch difference (+241,586,765 s measured, 2026-08-27) while the phone column advances 86 s.
       The gap walk used to trust the device delta unconditionally, publishing a 2.41e8 s "dropout":
       coverage segments in 2034, coveragePct 0, and the Integrator silently dropping the night.
       THE DISCRIMINATOR IS PHYSICAL: through a real BLE dropout both clocks keep ticking, so the
       device delta ≈ the phone delta; only a clock step makes them disagree — by 7.6 years here,
       against which the 60 s bound below has 5 orders of headroom. An over-bound step is a
       RE-ANCHOR POINT (session-boundary semantics), never a dropout duration: the device axis is
       shifted so it continues at the phone-measured pace, the real gap (the phone delta) is
       recorded if it clears the normal gap threshold, and the event is surfaced via `clockResyncs`
       all the way to the export. When the phone stamps at the seam do not parse, a delta over the
       24 h ceiling still re-anchors — with `phoneDeltaMs: null` and NO gap entry, because a
       duration nothing measured must stay visible as unmeasured (§2.6), never fabricated. */
    var ECG_RESYNC_BOUND_MS = 60000;
    var ECG_GAP_CEIL_MS = 86400000;
    /* THE RECORDING'S ANCHOR — Clock Contract §4: `t0Ms` is the tMs of the FIRST VALID sample, i.e.
       the first stamp that PARSES. A malformed leading row invalidates that ROW, not the night, so
       the walk reads on; what it must never do is fabricate one (§2.6), and a file with no parseable
       stamp in `headStamps` keeps `t0Ms: null`. The app's Worker used to anchor on the first
       NON-EMPTY stamp instead — a quieter rule that turns one junk row into an anchorless night —
       and unifying the lanes here means the app adopts the contract's rule, not the reverse. */
    var t0Ms = null,
      offsetMin = null;
    var heads = scan.headStamps || [];
    for (var hi = 0; hi < heads.length; hi++) {
      var ht = parseTimestamp(heads[hi]);
      if (ht && ht.tMs != null) {
        t0Ms = ht.tMs;
        offsetMin = ht.offsetMin != null ? ht.offsetMin : null;
        break;
      }
    }

    // ── the seams, in row order: each one may shift the device axis and may leave a real gap ──
    var gaps = [];
    var clockResyncs = [];
    var relOffsetMs = 0,
      nsOffsetMs = 0;
    var offsetAt = []; // {idx, relOffsetMs, nsOffsetMs} AFTER the seam at that row — for the anchors
    var msStep = scan.msStep;
    for (var ci = 0; ci < scan.candidates.length; ci++) {
      var c = scan.candidates[ci];
      var prevAdj = c.prevRawMs + relOffsetMs;
      /* The phone stamps are parsed lazily, only at candidates. `pdc` clamps the known
         non-monotonic host stamps (≤287 ms backward) to zero rather than letting a negative
         "gap" through. */
      var rsPd = null;
      if (c.prevStamp != null) {
        var rsPrev = parseTimestamp(c.prevStamp);
        var rsCur = c.stamp != null ? parseTimestamp(c.stamp) : null;
        if (rsPrev && rsPrev.tMs != null && rsCur && rsCur.tMs != null) rsPd = rsCur.tMs - rsPrev.tMs;
      }
      var pdc = rsPd != null ? Math.max(0, rsPd) : null;
      if (pdc != null && c.d - pdc > ECG_RESYNC_BOUND_MS) {
        // CLOCK RESYNC — re-anchor; the honest gap is the phone delta, if it is a gap at all
        relOffsetMs -= c.d - pdc;
        clockResyncs.push({ idx: c.idx, deviceStepMs: Math.round(c.d), phoneDeltaMs: Math.round(Number(pdc)), atRelMs: prevAdj, hostOffsetMs: /** @type {number|null} */ (null) });
        if (c.rawNsMs != null && c.prevRawNsMs != null) {
          // the ns chain stepped at the same seam — re-anchor it identically
          var nsAdj = c.rawNsMs - c.prevRawNsMs - pdc;
          if (Math.abs(nsAdj) > ECG_RESYNC_BOUND_MS) nsOffsetMs -= nsAdj;
        }
        if (msStep && pdc > msStep * 2.5) gaps.push({ idx: c.idx, ms: pdc, atRelMs: prevAdj, endRelMs: prevAdj + pdc });
      } else if (pdc == null && c.d > ECG_GAP_CEIL_MS) {
        // over the ceiling with no measurable phone delta: re-anchor, annotate, no gap entry
        relOffsetMs -= c.d;
        clockResyncs.push({ idx: c.idx, deviceStepMs: Math.round(c.d), phoneDeltaMs: null, atRelMs: prevAdj, hostOffsetMs: /** @type {number|null} */ (null) });
      } else {
        /* a dropout, not a sample interval — excluded from fs.
           THE `gaps[i].idx` CONVENTION: **`idx` is the FIRST SAMPLE AFTER the dropout — never the
           last one before it.** Both producers of this structure must agree; `tools/trio-batch.mjs
           mergeEcg` wrote `idx - 1` until 2026-07-31 and now writes `idx`. The consumer — the
           dead-time walk earlier in this file — tests `g.idx <= refIdx[k]`, which is only correct
           under first-after: a beat landing ON the boundary sample is after the hole and must carry
           the dead time. Pinned by the `gaps[].idx` leg in tests/dex-tests.js. */
        gaps.push({ idx: c.idx, ms: c.d, atRelMs: prevAdj, endRelMs: c.rawMs + relOffsetMs });
      }
      offsetAt.push({ idx: c.idx, relOffsetMs: relOffsetMs, nsOffsetMs: nsOffsetMs });
    }

    /* DEEP-AUDIT-II §4.3 (#5): derive fs from the MEAN non-gap sample interval — a stamp-span
       cross-check, NOT a single delta. The Polar Sensor Logger's `timestamp [ms]` column loses float
       precision as the value grows (7.692288 early → integer "8" late), so any ONE delta reads 125–167 Hz
       for a true 130 Hz stream (part-files parse at 143/167). Averaging every interval quantises the 7/8 ms
       jitter back to ~7.69 ms → 130, and gap dropouts are excluded. Falls back to the provisional step.
       PREFER THE INTEGER COUNTER, AND DO NOT ROUND IT. The `Math.round` below is right for the `[ms]`
       column and WRONG for this one, and the difference is seconds per night. Rounding forces the
       estimate to the NOMINAL 130 and discards the crystal: measured over the box corpus the H10's
       real rate is 129.9866–129.9966 Hz, so the rounded axis runs −45.9 to −125.5 ppm fast, i.e.
       −1.25 to −4.16 s across one night. That error then survives the host correction below, because
       correcting a rate cannot recover a rate that was quantised away first — the shipped axis
       diverged from the file's OWN host↔device record by up to 2894 ms on 2026-08-03, which is 2.4
       cardiac cycles and is what made PAT unmeasurable (`PAT-SAWTOOTH-ANSWERS-THE-130MS`).
       `nsStepN > 0` IS the "is it a counter" test: a stuck or absent column advances zero times, so it
       never reaches here, and the anchors fall back to `[ms]` in the same breath — one condition
       governing both, because an fs from one axis and anchors from the other would not compose. */
    var fs = 130;
    var nsUsable = scan.nsStepN > 0;
    if (nsUsable) fs = (1000 * scan.nsStepN) / scan.nsStepSum;
    else if (scan.stepN > 0) fs = Math.round((1000 * scan.stepN) / scan.stepSum);
    else if (scan.msStep && scan.msStep > 0) fs = Math.round(1000 / scan.msStep);

    /* ONE DEVICE CLOCK PER AXIS — anchors from BEFORE the last resync are not on the clock the rest
       of the file is on, so they are dropped before `hostAxis` sees them. The resync block above
       makes the device axis CONTINUOUS across the seam (it imposes the phone delta), but continuity
       is not sameness: the pre-sync H10 counter is a different oscillator, and `hostAxis` measures
       every divergence RELATIVE TO ITS FIRST ANCHOR. Measured on the real 2026-08-27 seam file
       (resync 9.5 s in, 50 min long): the host−device residual walks +1508 ms across those first
       9.5 s and then holds flat (post-seam slope 38 ppm), so with anchor 0 inside the pre-sync
       segment `hostAxis` read the STEP as a rate — 484.7 ppm — and the span gate (50 min ≥ 40 min)
       let it into `fs`: 129.968 → 129.903, 500 ppm off the same H10's 6.5 h sibling, which is what
       `trio-batch mergeEcg` refused ("sessions disagree on fs"). A step is REPORTED, never absorbed
       into fs (the maxStepMs paragraph below) — and a clock CHANGE is the hardest step there is.
       Cost: the pre-seam rows get the flat out-of-range correction of the first post-seam anchor,
       and the seam's host↔device offset is surfaced on `clockResyncs[].hostOffsetMs`. */
    /* An anchor is usable only if its own stamp parses — which also settles the "was `t0Ms` known
       yet?" question the row-walk used to ask: `t0Ms` is the first stamp in the file, so any LATER
       stamp that parses arrives with the anchor already established. */
    var parsedAnchors = [];
    for (var ai = 0; ai < scan.anchors.length; ai++) {
      var a = scan.anchors[ai];
      var aTs = t0Ms !== null ? parseTimestamp(a.stamp) : null;
      if (!(aTs && aTs.tMs != null)) continue;
      // the offsets in force at this row — the seam arithmetic above, replayed onto the anchors
      var relOff = 0,
        nsOff = 0;
      for (var oi = 0; oi < offsetAt.length; oi++) {
        if (offsetAt[oi].idx <= a.idx) {
          relOff = offsetAt[oi].relOffsetMs;
          nsOff = offsetAt[oi].nsOffsetMs;
        }
      }
      /* BOTH candidate device axes were recorded by the scan and the choice is made HERE, once it is
         known whether the counter actually counts. A column present but STUCK — some writers emit a
         literal `0` placeholder — is not a clock (Clock Contract §7: "a device whose axis was DRAWN
         is not a clock"), and preferring it collapses every anchor onto devMs = 0, which hands
         hostAxis a degenerate axis and silently inverts `independent`. */
      var devVal = nsUsable
        ? a.rawNsMs != null && scan.firstNsMs != null
          ? a.rawNsMs + nsOff - scan.firstNsMs
          : null
        : a.rawMs != null && scan.firstRelMs != null
          ? a.rawMs + relOff - scan.firstRelMs
          : null;
      parsedAnchors.push({ idx: a.idx, devMs: devVal, hostMs: aTs.tMs - t0Ms });
    }
    var lastResyncRow = clockResyncs.length ? clockResyncs[clockResyncs.length - 1].idx : null;
    var preResyncAnchorsDropped = 0;
    if (lastResyncRow !== null && parsedAnchors.length) {
      var postResync = [];
      for (var pi = 0; pi < parsedAnchors.length; pi++) {
        if (parsedAnchors[pi].idx >= lastResyncRow) postResync.push(parsedAnchors[pi]);
        else preResyncAnchorsDropped++;
      }
      if (postResync.length) {
        var seamAnchor = postResync[0];
        clockResyncs[clockResyncs.length - 1].hostOffsetMs = seamAnchor.devMs != null && isFinite(seamAnchor.devMs) ? Math.round(seamAnchor.hostMs - seamAnchor.devMs) : null;
      }
      parsedAnchors = postResync;
    }
    var ecgAxisAnchors = [];
    for (var qi = 0; qi < parsedAnchors.length; qi++) {
      var qDev = parsedAnchors[qi].devMs;
      if (qDev != null && isFinite(qDev)) ecgAxisAnchors.push({ devMs: qDev, hostMs: parsedAnchors[qi].hostMs });
    }

    /* Discipline `fs` to the host clock. Every beat time in this file is `peaks[k] / fs`, so correcting
       fs is what actually reaches the export — a separate `fsExact` nothing consumed would have been a
       fix in name only. Applied AFTER the integer rounding above, deliberately: that rounding exists to
       make the ESTIMATE robust (§4.3 — a single delta misreads 130 Hz as 125), and it must not then
       round the correction away. Result is a non-integer fs on real captures (130 → 130.0035) and an
       exactly unchanged one whenever the two clocks agree or too few anchors resolved.
       Unlike PpgDex — which carries a per-sample relSec and takes the full piecewise correction — an
       ECG rec is (int16, fs), and one scalar can express a RATE but not a STEP. A step is therefore
       REPORTED via hostAxis.maxStepMs and deliberately NOT corrected: absorbing a 3.22 s jump into fs
       would spread it across 434 min of otherwise good signal.

       SPAN GATE — a RATE needs a BASELINE, and `hostAxis` deliberately does not enforce one.
       That omission is correct for PpgDex, which consumes `correctionAt()`: an interpolation through
       measured anchors, whose residual is bounded by the jitter that caused it. It is NOT correct
       here, because this is the one consumer that reads `.ppm` — a rate — and a rate divides by the
       span. Short fragment ⇒ tiny denominator ⇒ host-stamp jitter is amplified into a fabricated
       crystal. Measured over 260 ECG fragments of the 2026-07-16..29 capture corpus, |ppm| against
       fragment span:

           <60 s   median 1208, max 16512   |   600-1200 s  median 43, max  196
          60-120   median  714, max 24036   |  1200-2400 s  median 42, max  151
         120-300   median  177, max 23235   |  2400-4800 s  median 20, max   52
         300-600   median   74, max   464   |     >4800 s   median 22, max   31

       The H10's real crystal is ~-25 ppm (the >2400 s fragments agree on that to within 30 ppm). Above
       2400 s no fragment exceeds 100 ppm; below 120 s, 86-89 % of them do. So 2400 s is where the
       estimate stops being a measurement of the crystal and starts being a measurement of the jitter.

       Why this matters beyond the time axis: `fs` is not only the beat clock. `detectPeaks`, the
       bandpass coefficients (aHp/aLp are built from 1/fs), `refinePeaks` and `computeSQI` all consume
       it as a RATE, so an uncorrected 133.2 Hz — which this corpus produced from a 62 s fragment —
       mis-designs the filter and the sub-sample refinement, not merely the timestamps.
       Refused ⇒ fs keeps the DEVICE crystal, the pre-WEARABLE-HOST-AXIS behaviour: wrong by ~25 ppm,
       where the ungated correction was wrong by up to 24036. The refusal is REPORTED, never silent. */
    var ECG_AXIS_MIN_SPAN_MS = 2400e3; // 40 min — the knee in the table above
    var ecgHostAx = typeof DexClock !== 'undefined' && DexClock.hostAxis ? DexClock.hostAxis(ecgAxisAnchors, {}) : { ok: false };
    /* Span from the anchors themselves — they are pushed in row order, so first→last IS the baseline
       the rate was divided by. Computed here rather than added to `DexClock.hostAxis` on purpose:
       clock.js is inlined into every bundle, so a field only ECGDex reads would re-stamp all eight
       provenance fragments to carry it. */
    var ecgAxisSpanMs = ecgAxisAnchors.length >= 2 ? ecgAxisAnchors[ecgAxisAnchors.length - 1].devMs - ecgAxisAnchors[0].devMs : 0;
    var ecgAxisApplied = false;
    /* INDEPENDENCE GATE — Clock Contract §7 states it outright: "FIRST ASK WHETHER THERE IS A SECOND
       CLOCK AT ALL — read `independent`, never a ~0 ppm." This consumer did not, and it is the one
       consumer that reads `.ppm` and divides `fs` by it.
       `independent === false` means the capture app DERIVED the host column from the device stamp, so
       the two columns are one clock and `ppm` measures the ROUNDING, not a crystal. Correcting by it
       fabricates a rate — the absence of a measurement wearing the shape of one, which is precisely
       what §7 says the spread discriminates. Measured 2026-08-09: the H10 ECG captures in this corpus
       show a host↔device residual spread of 0.98 ms on every night checked (one stamp quantum, against
       101.89–5124 ms where a real second clock exists), so EVERY one of them is a phone capture and
       every `fs` correction applied to them was derived from a column that is not a clock.
       `ok` is not enough and neither is the span gate: both are satisfied by a derived column. */
    var fsDevice = fs; // BEFORE any rate correction — `tMsAt` below needs the RAW device rate
    if (ecgHostAx.ok && ecgHostAx.independent !== false && isFinite(ecgHostAx.ppm) && ecgAxisSpanMs >= ECG_AXIS_MIN_SPAN_MS) {
      fs = fs / (1 + ecgHostAx.ppm / 1e6);
      ecgAxisApplied = true;
    }
    /* ── A SAMPLE'S POSITION IN TIME IS NOT A RATE — `tMsAt` rides the INTERPOLATION, not the ppm ────
       The block above corrects `fs`, and `fs` is the right thing to correct there: `detectPeaks`, the
       bandpass coefficients (built from 1/fs), `refinePeaks` and `computeSQI` all consume it as a RATE,
       and a rate needs the span gate that block spends a table justifying.

       A sample's POSITION IN TIME is a different quantity, and it was being derived from that same
       scalar — every consumer computing `t0Ms + (i / fs) * 1000`. Clock Contract §7 draws exactly this
       line: "`hostAxis` does not QUOTE a rate, it interpolates measured divergence, so its residual is
       bounded by what it observed. Gating on span would refuse the short fragments whose real error is
       ~3 s, i.e. exactly the case that needs it. A consumer that reads `.ppm` instead of
       `correctionAt()` is quoting a rate and DOES need a baseline."

       ECGDex sat on the wrong side of that sentence for TIME. The cost is measured, not theoretical:
       on 2026-08-03 the H10 reads -34.7 ppm, which over 475 min is 989 ms of divergence against the
       host-disciplined PpgDex axis (PpgDex already consumes `correctionAt` per sample). The observed
       ECG-to-PPG beat-lag walk on that night is ~1000 ms and WRAPS mod one RR — a sawtooth. The two
       agree, and that wrap is why whole-night PAT scatter reads 131-136 ms against a ~35 ms two-PPG
       control that couples on 11 of 14 nights.

       WHY `fsDevice`, NOT `fs`: if the span gate fired, `fs` already carries the ppm, and applying
       `correctionAt` on top would count the same divergence twice. The interpolation is measured
       against the DEVICE axis, so it must be applied to the device axis.

       WHY NO SPAN GATE HERE, and why that is not the oversight the ppm path was: `correctionAt` is
       linear between anchors and FLAT outside them, so a short fragment receives a small bounded
       correction rather than an amplified one. That boundedness is precisely what `.ppm` lacks. */
    var _ecgCorrAt = ecgHostAx.ok && ecgHostAx.independent !== false && typeof ecgHostAx.correctionAt === 'function' ? ecgHostAx.correctionAt : null;
    var _ecgMsPerSample = 1000 / fsDevice;
    // endEpochMs — the CLOCK position of the last sample, read from the file, never derived. Null when
    // the row carries no parseable stamp (§2.6: a missing stamp is visible, never fabricated). Kept
    // ALONGSIDE durSec, not instead of it: durSec answers "how much signal do I have", endEpochMs
    // answers "where does this recording end on the clock" — two questions one scalar cannot both answer.
    var endTs = scan.lastStamp != null ? parseTimestamp(scan.lastStamp) : null;
    var endEpochMs = endTs && endTs.tMs != null ? endTs.tMs : null;
    /* ── DEVICE-EPOCH PLAUSIBILITY — the 2019-origin annotation (H10-2019-ORIGIN, 2026-09-01) ─────────
       The H10 boots its sensor clock at a 2019-01-01 firmware default and adopts real time only when a
       sync lands. Measured over the full corpus: 87 of 455 H10 ECG files START on that fabricated
       origin and 84 of them never sync — a fifth of the H10 nights, internally perfect (130.00 Hz,
       monotonic) and absolutely wrong by ~7.6 years. Nothing in the capture persisted the sync outcome
       per night (live STATUS is a snapshot, journald rotates), so the file itself is the only evidence
       channel that survives — and the evidence IS in the file: the sensor-ns column counts from the
       Polar device epoch (2000-01-01, written in LOCAL wall time by the capture host's sync, so it
       compares against floating tMs with no zone term), and a synced device reads ~26 years where a
       2019-origin one reads ~19.
       ANNOTATE, NEVER REFUSE. These files' uV samples are fine and hostAxis anchoring measures
       divergence relative to the first anchor, so every relative quantity is sound — a first-row
       absolute-implausibility refusal would throw away 19 % of H10 nights.
       48 h threshold, deliberately coarse: it must keep the Verity's constant ~4 h offset and any
       zone/DST confusion (≤ ~14 h) on the plausible side — those are wrong-clock problems, not
       fabricated-epoch problems, and they are the hostAxis machinery's business. */
    var POLAR_EPOCH_MS = Date.UTC(2000, 0, 1); // sensor-ns epoch (capture-host `_POLAR_EPOCH`)
    var deviceEpochOffsetMs = scan.firstNsMs !== null && t0Ms !== null ? POLAR_EPOCH_MS + scan.firstNsMs - t0Ms : null;
    var deviceEpoch = deviceEpochOffsetMs !== null ? { offsetMs: Math.round(deviceEpochOffsetMs), plausible: Math.abs(deviceEpochOffsetMs) <= 48 * 3600e3 } : null;
    return {
      fs: fs,
      /* Absolute floating wall-clock ms of sample `i`, host-disciplined where a second clock exists.
         `i` may be fractional — `refinePeaks` returns sub-sample R positions and they must not be
         rounded before the correction is applied. Consumers that need a TIME use this; consumers that
         need a RATE keep using `fs`. */
      tMsAt: function (i) {
        var devMs = i * _ecgMsPerSample;
        return t0Ms + devMs + (_ecgCorrAt ? _ecgCorrAt(devMs) : 0);
      },
      /* Whether `tMsAt` is actually disciplined. Reported so a caller can tell a corrected axis from a
         device-clock one WITHOUT re-deriving the condition — and so `applied:false` on `hostAxis`
         (a REFUSED ppm) is never mistaken for "the time axis is uncorrected too". They are different
         gates now: the ppm is span-gated, the interpolation is not. */
      tMsCorrected: !!_ecgCorrAt,
      /* Mid-file device clock resyncs (DEEP-AUDIT-VI F1) — [] on every clean recording. Each entry:
         { idx, deviceStepMs, phoneDeltaMs (null when the seam's phone stamps did not parse), atRelMs }. */
      clockResyncs: clockResyncs,
      gaps: gaps,
      t0Ms: t0Ms,
      offsetMin: offsetMin,
      endEpochMs: endEpochMs,
      firstRelMs: scan.firstRelMs,
      lastRelMs: scan.lastRelMs != null ? scan.lastRelMs + relOffsetMs : null,
      // See the block above — null when the file carries no sensor-ns column or no parseable host stamp.
      deviceEpoch: deviceEpoch,
      /* See the fs block above. `maxStepMs` is the one to read: a step is reported, never corrected.
         `applied` is the field that says whether `fs` actually moved — `ok` alone does NOT mean the
         correction reached the axis, because the span gate can measure a rate and still decline to
         trust it. A consumer asking "is this recording host-disciplined?" must read `applied`. */
      hostAxis: ecgHostAx.ok
        ? {
            ok: true,
            applied: ecgAxisApplied,
            anchors: ecgHostAx.n,
            /* Forwarded so a consumer can tell "corrected" from "declined, and why". Without these,
               `applied:false` is indistinguishable between a short fragment and a recording that
               never had a second clock — different problems with different remedies. */
            independent: ecgHostAx.independent != null ? ecgHostAx.independent : null,
            spreadMs: ecgHostAx.spreadMs != null ? ecgHostAx.spreadMs : null,
            /* PpgDex's provenance lattice (Clock Contract §7), restricted to the arms this layout can
               reach: the ECG axis is a REAL per-sample device counter here — never drawn — so the
               'host'/'none' arms do not arise. `independent === false` (every phone capture: the host
               column is the device stamp rounded, spread ≈ one quantum) means one clock ⇒ 'device';
               a genuinely independent host column ⇒ 'device+host'. NOTE this says which clocks set the
               RATE/RELATIVE axis — `deviceEpoch` above is the orthogonal ABSOLUTE-origin fact. */
            timingSource: ecgHostAx.independent === false ? 'device' : 'device+host',
            totalMs: ecgHostAx.totalMs,
            ppm: ecgHostAx.ppm,
            maxStepMs: ecgHostAx.maxStepMs,
            spanMs: ecgAxisSpanMs,
            /* σ_y(τ) of the host−device divergence, forwarded from the spine. Like the fields above,
               this block RENAMES and therefore drops anything not listed — the same trap that ate this
               field in PpgDex on its first real-data run.
               WHY IT MATTERS HERE SPECIFICALLY: this node is the one that QUOTES a rate (it corrects
               `fs` from `ppm`), so it is the one that needs to say how much of that rate is real.
               `ppmUncertainty` is σ_y at the recording's own span — read the `ppm` above WITH it.
               It does NOT change the span gate: `ECG_AXIS_MIN_SPAN_MS` is untouched here, and the claim
               that 2400 s is too permissive was measured and WITHDRAWN (HOSTAXIS-STABILITY §3 —
               6.8-32.7 ppm uncertainty against 20-90 ppm errors is marginal, not wrong). Revisiting it
               needs a bound derived for the estimator `fs` actually uses, which ADEV is not. */
            stability: ecgHostAx.stability || null,
            /* ONE DEVICE CLOCK PER AXIS (see the resync block above): anchors read off the pre-resync
               counter were not fed to the spine. Present only when it happened, so clean fixtures keep
               today's bytes; a consumer reading `anchors` beside this knows the count is post-seam. */
            anchorsDroppedPreResync: preResyncAnchorsDropped > 0 ? preResyncAnchorsDropped : undefined,
            reason: ecgAxisApplied
              ? undefined
              : 'span ' + Math.round(ecgAxisSpanMs / 1000) + ' s < ' + ECG_AXIS_MIN_SPAN_MS / 1000 + ' s — too short to resolve a crystal rate, fs left on the device clock'
          }
        : {
            ok: false,
            applied: false,
            reason: ecgHostAx.reason || 'no host anchors',
            // No usable host↔device anchor set ⇒ the published axis rides the device crystal alone.
            timingSource: 'device',
            anchorsDroppedPreResync: preResyncAnchorsDropped > 0 ? preResyncAnchorsDropped : undefined
          }
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PURE ECG TEXT PARSER  (the headless lane of the timing walk above)
  //  ─────────────────────────────────────────────────────────────────────
  //  The app streams raw ECG in a Web Worker (built from a Blob so it bundles) —
  //  but a Worker cannot run in the co-load realm (Data Unifier / OverDex / the
  //  test suite), so the headless compute() path needs a PURE, DOM-free parser
  //  for the SAME Polar Sensor Logger `*_ECG.txt` layout the worker reads:
  //    Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]   (~130 Hz)
  //  It no longer MIRRORS the worker — the two lanes now share `ecgTimingScan`
  //  (the worker runs its source) and `ecgTimingResolve` (both call it), so the
  //  only thing this function still owns is reading µV samples out of the text.
  //  A stampless file keeps t0Ms:null (Clock Contract §2.6: a missing anchor
  //  stays visible, never now()), and gangliorEvents already emits t:null/tMs:null
  //  for that case. Returns the SAME rec shape genSynthetic/the worker hand
  //  analyze(): { int16, fs, gaps, t0Ms, offsetMin, source, durSec, … }.
  // ════════════════════════════════════════════════════════════════════════
  function parseECGText(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var cap = 1 << 16,
      arr = new Int16Array(cap),
      n = 0;
    var scan = ecgTimingScan();
    var sawHeaderRow = false;
    function push(v) {
      if (n >= cap) {
        cap *= 2;
        var na = new Int16Array(cap);
        na.set(arr);
        arr = na;
      }
      arr[n++] = v;
    }
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) continue;
      var p = line.split(/[;\t,]/);
      var v = parseFloat(p[p.length - 1]);
      if (!isFinite(v)) {
        // header / junk row (non-numeric last column) — only the FIRST one is read for the layout
        if (!sawHeaderRow && n === 0) {
          sawHeaderRow = true;
          scan.header(p);
        }
        continue;
      }
      push(Math.max(-32768, Math.min(32767, Math.round(v))));
      scan.row(p, n);
    }
    var t = ecgTimingResolve(scan.done());
    return {
      int16: arr.slice(0, n),
      fs: t.fs,
      tMsAt: t.tMsAt,
      tMsCorrected: t.tMsCorrected,
      clockResyncs: t.clockResyncs,
      gaps: t.gaps,
      t0Ms: t.t0Ms,
      offsetMin: t.offsetMin,
      source: 'file',
      durSec: n / t.fs,
      endEpochMs: t.endEpochMs,
      firstRelMs: t.firstRelMs,
      lastRelMs: t.lastRelMs,
      deviceEpoch: t.deviceEpoch,
      hostAxis: t.hostAxis
    };
  }

  /* recording.coverage for an ECG recording — INTEGRATOR-GAP-AWARE-OVERLAP part 2.
     The dropouts `parseECGText` already found ARE the session boundaries: a BLE link drop ends one
     segment and its recovery starts the next. On the 2026-07-16..26 capture corpus one H10 night runs
     3 segments and one Verity night 24, so the envelope this node used to declare on its own is a
     bracket around a recording, not the recording.

     Prefers the exact relative-ms edges (`atRelMs`/`endRelMs`); falls back to `idx/fs` for a rec that
     reached us without them — a worker hand or a SignalFrame carries `{idx, ms}` only, and a coverage
     block reconstructed to the nearest sample period is still enormously better than an envelope. */
  function ecgCoverage(rec) {
    if (!rec || rec.t0Ms == null || !isFinite(rec.t0Ms)) return null;
    var gaps = rec.gaps;
    if (!Array.isArray(gaps) || !gaps.length) return null; // contiguous ⇒ no claim (DexExport contract)
    var fs = rec.fs > 0 ? rec.fs : 130;
    var nSamp = rec.int16 && rec.int16.length != null ? rec.int16.length : null;
    var t0 = rec.t0Ms,
      segs = [];
    if (rec.firstRelMs != null && isFinite(rec.firstRelMs) && rec.lastRelMs != null && isFinite(rec.lastRelMs) && gaps[0] && gaps[0].atRelMs != null) {
      // ── EXACT: the parser kept both edges of every dropout, in the file's own ms column. ──
      var base = rec.firstRelMs,
        cur = 0;
      for (var i = 0; i < gaps.length; i++) {
        var g = gaps[i];
        if (!g || g.atRelMs == null || !isFinite(g.atRelMs) || g.endRelMs == null || !isFinite(g.endRelMs)) continue;
        var gs = g.atRelMs - base,
          ge = g.endRelMs - base;
        if (!(ge > gs)) continue;
        if (gs > cur) segs.push([t0 + cur, t0 + gs]);
        cur = Math.max(cur, ge);
      }
      var endOff = rec.lastRelMs - base;
      if (endOff > cur) segs.push([t0 + cur, t0 + endOff]);
    } else if (nSamp) {
      /* ── FALLBACK: `{idx, ms}` only. A sample index is DATA time, not wall-clock time — after one
         dropout, sample k sits at k/fs PLUS every gap before it, so reading `idx/fs` as a clock
         position under-states every boundary by the accumulated silence. Walk instead: consume the
         segment's data seconds, then jump the gap. This is the path the trio-batch session merge
         takes (it rebuilds `gaps` by hand and carries no ms column), i.e. the exact shape this whole
         brief is about — so it has to be the correct one, not the convenient one.

         The merge writes `idx` as the LAST sample BEFORE the join while the parser writes the FIRST
         sample AFTER the dropout. That is a one-sample disagreement — 7.7 ms at 130 Hz — against
         segments measured in hours, so it is left alone rather than papered over with a heuristic
         that would have to guess which producer it is reading. */
      var sorted = gaps
        .filter(function (x) {
          return x && x.idx != null && isFinite(x.idx) && x.ms != null && isFinite(x.ms) && x.ms > 0;
        })
        .sort(function (a, b) {
          return a.idx - b.idx;
        });
      var wall = 0,
        prevIdx = 0;
      for (var j = 0; j < sorted.length; j++) {
        var gi = Math.max(prevIdx, Math.min(nSamp, sorted[j].idx));
        var dataMs = ((gi - prevIdx) / fs) * 1000;
        if (dataMs > 0) segs.push([t0 + wall, t0 + wall + dataMs]);
        wall += dataMs + sorted[j].ms;
        prevIdx = gi;
      }
      var tailMs = ((nSamp - prevIdx) / fs) * 1000;
      if (tailMs > 0) segs.push([t0 + wall, t0 + wall + tailMs]);
    } else return null;
    return typeof DexExport !== 'undefined' && DexExport && DexExport.coverageFromSegments ? DexExport.coverageFromSegments(segs, { source: 'ble-dropout' }) : null;
  }

  // COMPANION device-stream parsers (ECG-PPG-FOLLOWUPS-HANDOFF §2(b)) — the Polar Sensor
  // Logger sidecars the app's loadDeviceRR/HR/ACC parse with DOM FileReaders. These are the
  // PURE headless mirrors (Clock-Contract-faithful — regex parseTimestamp, NEVER Date.parse /
  // now()), referenced BY the polar-h10-ecg adapter so a Unifier/OverDex-routed `*_ECG.txt`
  // carries its matched `*_RR/_HR/_ACC` companions on the orchestrate path. compute() reads
  // rec.deviceRR/deviceHR/deviceACC straight off the frame; analyze() then runs
  // stampEpochPositions(deviceACC) → epochs[].position (posture) + accExtras. Mirrors PpgDex's
  // DSP-resident parseSensorXYZ/parseDevicePPI (companion parsers live in the DSP).
  // `*_RR.txt` (device RR, ms in the last column) → [{tsMs, rr}], 200–3000 ms.
  function parseDeviceRR(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/),
      out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var p = t.split(/[;\t,]/);
      var rr = parseFloat(p[p.length - 1]);
      if (!isFinite(rr) || rr < 200 || rr > 3000) continue;
      var ts = parseTimestamp(p[0]);
      out.push({ tsMs: ts && ts.tMs != null ? ts.tMs : null, rr: rr });
    }
    return out;
  }
  /* Resolve HR's column BY HEADER — never by position (DEEP-AUDIT-III §6.3).
     This read `p[p.length - 1]`, the LAST column. On BOTH real `_HR.txt` layouts the last column is
     an INTERVAL IN MILLISECONDS, not a rate:
        capture-host  Phone timestamp;sensor timestamp [ns];HR [bpm];RR-interval [ms]  → last = RR ms
        Polar SL      Phone timestamp;HR [bpm];HRV [ms];Breathing interval [rpm];      → last = HRV ms
                      (PSL writes 2 fields when HRV is absent and 3 when present, so the last column
                       is HR on some rows and HRV on others WITHIN ONE FILE)
     Measured on a real 21 613-row PSL file: the truth (its `HR [bpm]` column) is n=21613, mean 50.5,
     range 46–78; the positional read returned n=6396, mean 39.9 — 70 % of rows dropped and the
     survivors are millisecond values laundered through the 20–260 "plausible bpm" band. That feeds
     ECGDex's surfaced ECG-vs-device validation card: mean, range, mean-abs-error, correlation r and
     its excellent/good/weak pill. The correct implementation already existed one node over —
     `motiondex-dsp.js xyzColsFromHeader`; this is that, ported. */
  function hrColsFromHeader(headerLine) {
    var p = String(headerLine || '').split(/[;\t,]/);
    var idx = { hr: -1, rr: -1 };
    for (var i = 0; i < p.length; i++) {
      var h = p[i].trim().toLowerCase();
      // `\bhr\b` deliberately does NOT match "hrv" (no word boundary before the v), so the interval
      // column can never be taken for the rate column.
      if (idx.hr < 0 && (/\bhr\b/.test(h) || /heart\s*rate/.test(h) || /\[bpm\]/.test(h))) idx.hr = i;
      else if (idx.rr < 0 && (/rr[-\s]?interval/.test(h) || /\bhrv\b/.test(h))) idx.rr = i;
    }
    return idx.hr >= 0 ? idx : null;
  }
  // `*_HR.txt` (device onboard HR) → [{tsMs, hr}], 20–260 bpm.
  function parseDeviceHR(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/),
      out = [];
    var cols = null,
      headerless = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var p = t.split(/[;\t,]/);
      if (cols === null && !headerless) {
        var fromHdr = hrColsFromHeader(t);
        if (fromHdr) {
          cols = fromHdr;
          continue; // the header line is not data
        }
        headerless = true;
      }
      // Headerless → decide BY SHAPE, per row: a bare list of rates has HR in column 0; anything
      // wider puts it in the first field after the stamp. Both known layouts agree, and unlike "the
      // last column" neither choice can land on an interval. A row whose chosen column is not a
      // plausible rate fails the band below and is skipped — an honest empty result rather than
      // milliseconds relabelled as bpm.
      var hrIdx = cols ? cols.hr : p.length === 1 ? 0 : 1;
      var hr = parseFloat(p[hrIdx]);
      if (!isFinite(hr) || hr < 20 || hr > 260) continue;
      var ts = parseTimestamp(p[0]);
      out.push({ tsMs: ts && ts.tMs != null ? ts.tMs : null, hr: hr }); // null stamp stays null — never fabricated
    }
    return out;
  }
  // `*_ACC.txt` (tri-axial accelerometer; last 3 numeric cols = x,y,z) → { acc:[{tsMs,x,y,z}],
  /* ── Companion hand-off (DEEP-AUDIT-II §10.4) ────────────────────────────────────────────────
     A dropped `_RR / _HR / _ACC` may arrive BEFORE its ECG, so the app parks it and grafts it onto
     the next recording that lacks its own. The parking slots were module-scope globals cleared ONLY
     by resetAll(), and the multi-file queue drain never cleared them between recordings — so once
     night A's companions were parked, night B inherited them whenever B's own companions were
     absent. `deviceKey` cannot discriminate: it is POLAR_<model>_<id>, per DEVICE, so two nights
     from the same H10 share it exactly.
     The missing rule is that a parked companion is CONSUMED by the recording it grafts onto. It
     belongs to one recording; after that it must not be pending for anything else.
     Pure and app-free so it can be gated at all — the graft decision previously lived inside a
     DOM-mutating handler where no test could reach it, which is why a cross-night leak that reaches
     the EXPORT (the ACC leg re-stamps `ev.meta.position`) shipped unnoticed.
     Returns { graft, remaining }: `graft` is what this recording should take, `remaining` is what
     stays parked. Never mutates either argument. */
  function planCompanionGraft(pending, rec) {
    var p = pending || {},
      r = rec || {};
    var graft = {},
      tookACC = false;
    if (p.deviceRR && !r.deviceRR) graft.deviceRR = p.deviceRR;
    if (p.deviceHR && !r.deviceHR) graft.deviceHR = p.deviceHR;
    if (p.deviceACC && !r.deviceACC) {
      graft.deviceACC = p.deviceACC;
      graft.accFs = p.accFs != null ? p.accFs : null;
      tookACC = true;
    }
    return {
      graft: graft,
      remaining: {
        deviceRR: graft.deviceRR ? null : p.deviceRR || null,
        deviceHR: graft.deviceHR ? null : p.deviceHR || null,
        deviceACC: tookACC ? null : p.deviceACC || null,
        accFs: tookACC ? null : p.accFs != null ? p.accFs : null
      }
    };
  }

  // accFs } — fs inferred from the median stamp dt. A stampless file is relative-from-0
  // (+ _relBase) so the caller can re-base onto the ECG's t0Ms (Clock Contract §2.6 — never now()).
  function parseDeviceACC(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/),
      out = [],
      ns0 = null;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var p = t.split(/[;\t,]/);
      var nums = [];
      for (var k = 0; k < p.length; k++) {
        var v = parseFloat(p[k]);
        if (isFinite(v)) nums.push(v);
      }
      if (nums.length < 3) continue;
      // Column 1 is `sensor timestamp [ns]` (ns since 2000-01-01) on EVERY PSL stream variant —
      // verified across 104 real Polar Sensor Logger ACC files and both of our own capture-host
      // layouts (the transitional 6-col one that carried `timestamp [ms]`, and the current 5-col).
      // BigInt is required: these values (~6e17) exceed Number.MAX_SAFE_INTEGER. A file without the
      // column throws here and falls back to the phone stamp below.
      // NOTE the /^\d+$/ guard: BigInt('') is 0n, NOT a throw. Without it a blank ns column makes
      // every row relNs=0, collapsing the whole file onto a single timestamp (fs then falls to the
      // default 4 Hz). Only an all-digit field is a device stamp; anything else falls back to phone.
      var relNs = NaN,
        nsRaw = String(p[1] == null ? '' : p[1]).trim();
      if (/^\d+$/.test(nsRaw)) {
        try {
          var bn = BigInt(nsRaw);
          if (ns0 === null) ns0 = bn;
          relNs = Number(bn - ns0);
        } catch (e) {}
      }
      var ts = parseTimestamp(p[0]);
      out.push({ tsMs: ts && ts.tMs != null ? ts.tMs : null, relNs: relNs, x: nums[nums.length - 3], y: nums[nums.length - 2], z: nums[nums.length - 1] });
    }
    if (out.length < 30) return { acc: null, accFs: null };
    // ── Per-sample time comes from the DEVICE clock, anchored ONCE on the phone stamp ──────────────
    // The phone column is a host ARRIVAL stamp: decode_frame back-times each BLE frame from its own
    // notification arrival, and arrival jitters (bursty delivery) while the device clock does not. So
    // the phone column steps BACKWARDS at ~0.5-0.8 % of rows, always at a frame boundary (measured on
    // 2.4 M real rows, 2026-07-18: device column 0 backward steps, phone column 274/60 000, worst
    // 175 ms). Anchoring absolute time once on the phone stamp and spacing samples by the device
    // clock keeps the Clock-Contract floating wall-clock while removing the arrival jitter — the same
    // device-clock-preferred rule MotionDex/PpgDex already apply via relSecOf(). Falls back to the
    // per-row phone stamp when the ns column is absent or sparse.
    var anchor = -1;
    for (var a = 0; a < out.length; a++) {
      if (isFinite(out[a].tsMs) && isFinite(out[a].relNs)) {
        anchor = a;
        break;
      }
    }
    if (anchor >= 0) {
      var nNs = 0;
      for (var b = 0; b < out.length; b++) if (isFinite(out[b].relNs)) nNs++;
      if (nNs > out.length * 0.9) {
        var tA = out[anchor].tsMs,
          rA = out[anchor].relNs;
        for (var c = 0; c < out.length; c++) {
          if (isFinite(out[c].relNs)) out[c].tsMs = tA + (out[c].relNs - rA) / 1e6;
        }
      }
    }
    var fs = 4,
      ts2 = [];
    for (var j = 0; j < out.length; j++) {
      if (isFinite(out[j].tsMs)) ts2.push(out[j].tsMs);
    }
    if (ts2.length > 5) {
      var dt = [];
      for (var m = 1; m < ts2.length; m++) dt.push(ts2[m] - ts2[m - 1]);
      dt.sort(function (a, b) {
        return a - b;
      });
      var md = dt[dt.length >> 1];
      if (md > 0) fs = Math.max(1, Math.min(200, Math.round(1000 / md)));
    }
    if (!isFinite(out[0].tsMs)) {
      for (var q = 0; q < out.length; q++) out[q].tsMs = Math.round((q / fs) * 1000);
      /** @type {any} */
      (out)._relBase = true;
    }
    return { acc: out, accFs: fs };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PHASE-9 SIGNAL-ADAPTER — namespaced node surface (ECGDex.compute)
  //  (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 3 of 4 — the ECGDex leg.)
  //  Shared node-export builder: ONE event source (analyze→gangliorEvents→r.events)
  //  feeds BOTH the app's exportGanglior() and the headless compute(). DOM-free and
  //  self-contained — kernel/provenance arrive via opts (never reached off window
  //  here, CONTRIBUTING.md §6 / brief §1B). ECG is SINGLE-CHANNEL, so the canonical
  //  ecg SignalFrame uses the STANDARD {samples:Float32Array, fs, t0Ms} shape
  //  signal-spec.ecg declares — NOT PpgDex's packed multi-channel `samples` object
  //  (PPGDEX-FOLLOWUPS §8); compute() reads samples+fs straight off the frame.
  // ════════════════════════════════════════════════════════════════════════
  function ecgBuildNodeExport(r, opts) {
    opts = opts || {};
    // strip the internal _sec helper (surge events carry it for late-ACC re-stamp) —
    // mirrors buildV2's event map so the LIGHT Ganglior stream matches the rich one.
    var events = (r.events || []).map(function (ev) {
      var c = {};
      for (var k in ev) {
        if (k !== '_sec' && Object.prototype.hasOwnProperty.call(ev, k)) c[k] = ev[k];
      }
      return c;
    });
    var out = {
      // DEEP-AUDIT-2026-07-11 §16: NORMALIZE the stamp to the contract shape {version, hash}. Passing
      // opts.kernel through raw exported the DexKernel object itself ({K, VERSION, HASH}), and the
      // Integrator reads the lowercase keys — so this node always audited as kernel 'missing'.
      kernel: opts.kernel
        ? { version: (opts.kernel.version != null ? opts.kernel.version : opts.kernel.VERSION) || null, hash: (opts.kernel.hash != null ? opts.kernel.hash : opts.kernel.HASH) || null }
        : null,
      schema: {
        name: 'ganglior.node-export',
        version: '2.0',
        node: 'ECGDex',
        nodeVersion: '1.0',
        bus: 'ganglior',
        generated: opts.generated || new Date().toISOString(),
        provenance: opts.provenance || null,
        doc: 'ECGDex beat-derived events → Ganglior bus. tMs = floating wall-clock ms (UTC getters). null = unknown, never fabricated.'
      },
      // EXPORT-IDENTITY §2.1 / -FOLLOWUPS-II §1: identity-free contentId, single-sourced in this
      // shared builder (both app exportGanglior + headless compute reach it). Folds the NN beat series.
      recording: {
        source: 'ecg',
        contentId:
          typeof SignalFrame !== 'undefined' && SignalFrame && SignalFrame.computeContentId && r.nn && r.nn.length
            ? SignalFrame.computeContentId({ signalType: 'ecg', kind: 'intervals', intervals: r.nn, t0Ms: r.t0Ms != null ? r.t0Ms : null, usable: true })
            : null,
        startEpochMs: r.t0Ms != null ? r.t0Ms : null,
        // Declare the recording LENGTH so the Integrator can place a real window on this leg.
        // CAPTURE-HOST-INTEGRATOR-FOLD §2: without a duration key, integrator-dsp adaptEnvelopeNode
        // derives endMs from the LAST event only — so an EVENT-SPARSE ECG segment (e.g. a short clean
        // clip that trips no arrhythmia/CVHR event) collapses to a zero-length window at t0Ms and is
        // EXCLUDED from the fold's overlap intersection, dropping the strongest concurrent leg even
        // though its raw ECG genuinely overlapped the other nodes. `durSec` is the key the adapter
        // already honors generically (DEEP-AUDIT-II §7.6, added for MotionDex) — additive + back-compat.
        durSec: r.durSec != null ? r.durSec : null,
        // …and the CLOCK end alongside it (the duration-semantics ruling, option (c)). `durSec` is DATA
        // seconds here (`n / fs`), so `t0 + durSec` is NOT where the recording ends whenever the link
        // dropped — it lands short by exactly the dropout time. `integrator-dsp normalizeFile` already
        // prefers `endEpochMs` over every duration key, so this is additive: absent ⇒ today's behaviour.
        endEpochMs: r.endEpochMs != null ? r.endEpochMs : null,
        offsetMin: r.offsetMin != null ? r.offsetMin : opts.offsetMin != null ? opts.offsetMin : null,
        events: events.length
      },
      ganglior_events: events,
      reserved: { doc: 'Awaiting other fleet nodes; null until available.' }
    };
    /* SELF vs FIRMWARE — ON THE INTEGRATOR-FACING SURFACE, which is the whole point. `validateRR` has
       always been computed and shown in `valCard`, then discarded: it reached `ecgdex-app.js buildV2`
       (the AI-readable export) at most, and NEVER this builder. A cross-node consumer therefore could
       not see whether ECGDex's own detector agrees with the strap's, while PpgDex publishes the
       equivalent — an asymmetry with no reason behind it.
       ⚠️ The builder matters more than the field: `buildNodeExport` is what `trio-batch` writes, what
       the Integrator reads, and what the equivalence legs re-run. `buildV2` is none of those. A field
       added to the wrong one is invisible to every consumer AND to the gate that would have said so.
       ATTACHED ONLY WHEN THERE IS SOMETHING TO REPORT. An absent `_RR.txt` yields no key at all rather
       than `validation: null` — a null key is still a changed export shape, and every committed fixture
       lacks the companion, so omission keeps them byte-identical while real recordings gain the field. */
    /* THE HOST AXIS, ON THE INTEGRATOR-FACING SURFACE (HOSTAXIS-STABILITY §4.2). ECGDex has always
       COMPUTED one — it is what `tMsAt` rides — and never exported it, so a downstream reader could not
       tell a disciplined ECG axis from a raw device-clock one without re-deriving the condition.
       `applied` and `tMsCorrected` are different questions and both travel: the ppm correction to `fs`
       is span-gated, the interpolation is not, so `applied:false` does NOT mean the time axis is
       uncorrected. `stability.ppmUncertainty` is the number that makes `ppm` readable — measured
       −21.9 ± 9.3 ppm on a real box night, i.e. 2.4σ from zero. Omitted entirely when there is no host
       axis, rather than a null key: no committed fixture has one. */
    if (r.hostAxis && r.hostAxis.ok) {
      out.recording.hostAxis = {
        applied: r.hostAxis.applied,
        anchors: r.hostAxis.anchors,
        ppm: r.hostAxis.ppm,
        ppmUncertainty: r.hostAxis.stability ? r.hostAxis.stability.ppmUncertainty : null,
        maxStepMs: r.hostAxis.maxStepMs,
        spanMs: r.hostAxis.spanMs,
        independent: r.hostAxis.independent,
        spreadMs: r.hostAxis.spreadMs,
        timingSource: r.hostAxis.timingSource || null,
        tMsCorrected: r.tMsCorrected === true,
        stability: r.hostAxis.stability
          ? {
              slope: r.hostAxis.stability.slope,
              slopeSE: r.hostAxis.stability.slopeSE,
              noise: r.hostAxis.stability.noise,
              candidates: r.hostAxis.stability.candidates,
              optimalTauSec: r.hostAxis.stability.optimalTauSec,
              tauMaxSec: r.hostAxis.stability.tauMaxSec
            }
          : null,
        note: 'quote `ppm` WITH `ppmUncertainty`; `stability:null` means there was no second clock (host column ≡ device stamp), not that the clock was perfect'
      };
    }
    /* TIMING PROVENANCE on the Integrator-facing surface (H10-2019-ORIGIN, 2026-09-01). ATTACHED ONLY
       WHEN PRESENT, same discipline as `hostAxis`/`validation` above: a null key is still a changed
       export shape, so recordings the parser could not judge (no ns column, no host stamp — every
       synthetic rec) keep today's bytes.
       `recording.timingSource` is a resolution path `integrator-dsp normalizeFile` already honors —
       which clocks built the RELATIVE axis. `recording.deviceEpoch` is the orthogonal ABSOLUTE fact:
       `plausible:false` marks a 2019-origin H10 (a fifth of the corpus's H10 nights) whose device
       clock never adopted real time — absolute time on such a night is host-provenance or nothing,
       while every relative/HRV quantity remains sound. Annotate, never refuse. */
    if (r.hostAxis && r.hostAxis.timingSource) out.recording.timingSource = r.hostAxis.timingSource;
    if (r.deviceEpoch) out.recording.deviceEpoch = { offsetMs: r.deviceEpoch.offsetMs, plausible: r.deviceEpoch.plausible };
    /* Mid-file clock resyncs (DEEP-AUDIT-VI F1) — attached only when one occurred, same
       no-null-key discipline as every provenance field above, so clean fixtures keep today's bytes.
       A consumer seeing this knows the device axis was RE-ANCHORED at these points and that the
       recording fuses two device epochs; the published times are already on the re-anchored axis. */
    if (Array.isArray(r.clockResyncs) && r.clockResyncs.length)
      out.recording.clockResyncs = r.clockResyncs.map(function (c) {
        var rs = { idx: c.idx, deviceStepMs: c.deviceStepMs, phoneDeltaMs: c.phoneDeltaMs, atRelMs: c.atRelMs };
        /* host−device offset at the seam, measured off the first post-resync anchor — the one place
           the two epochs' relationship is a NUMBER rather than a rate. Absent when no anchor landed
           past the seam (a resync inside the last 500 rows). */
        if (c.hostOffsetMs != null) rs.hostOffsetMs = c.hostOffsetMs;
        return rs;
      });
    if (r.deviceRR && r.deviceRR.length) {
      const _v = validateRR(r.nn, r.deviceRR);
      if (_v) {
        const _al = alignFirmwareRR(r.nn, r.deviceRR, { fs: r.fs });
        out.validation = {
          source: 'device-rr',
          beatsCompared: _v.nSelf,
          nDevice: _v.nDev,
          dMeanPct: _v.dMean,
          dRMSSDPct: _v.dRMSSD,
          dSDNNPct: _v.dSDNN,
          devEctopyCorrected: _v.devEctopyCorrected,
          devRawRMSSD: _v.devRawRMSSD,
          /* The summary fields above are invariant to WHICH beat matched which, so they stay healthy on
             a recording whose correspondence has come apart. `alignment.pairingDecays` is the leg that
             sees it; when true, every summary above is computed over progressively mismatched pairs and
             `stableWindowRange` names the deciles that are trustworthy. */
          alignment: _al
            ? {
                offset: _al.offset,
                medianAbsMs: _al.medianAbsMs,
                beatSurplus: _al.beatSurplus,
                offsetPerThird: _al.offsetPerThird,
                offsetStable: _al.offsetStable,
                medianAbsByWindow: _al.medianAbsByWindow,
                pairingDecays: _al.pairingDecays,
                stableWindowRange: _al.stableWindowRange,
                sampleMs: _al.sampleMs
              }
            : null,
          note: 'self-computed RR (sub-sample-refined Pan-Tompkins) vs the strap firmware RR; both Malik-corrected. Validation lane only — self-RR is never replaced by device RR'
        };
      }
    }
    /* SPARSE COVERAGE — INTEGRATOR-GAP-AWARE-OVERLAP part 2 (the emitter half of DEEP-AUDIT-III §6.2).
       `durSec` says how much signal there is and `endEpochMs` says where the recording ends on the
       clock; NEITHER says WHERE INSIDE that span the signal actually is. On a night of BLE reconnects
       those are different questions with a 3.3× different answer: measured 2026-07-23, three-way
       recorded overlap 2.1 h against a 6.86 h envelope — on the one night in eleven marked
       `confirmedAHIReportable`, whose `confirmedAHI` is divided by exactly that figure.
       ASSIGNED CONDITIONALLY, like `stats.sensorWarmupTrimmed` in oxydex-dsp and for the same reason:
       an always-present `coverage:null` would move EVERY clean export's bytes, including the committed
       provenance fixtures, to say nothing. Absent ⇒ no coverage claim ⇒ the Integrator uses the
       envelope, which for a contiguous recording IS the coverage. */
    if (r.coverage) out.recording.coverage = r.coverage;
    // ── RICH export (gated: opts.rich) — ECG-PPG-FOLLOWUPS-HANDOFF §1 option (a) / ECGDEX-FOLLOWUPS-II §2 ──
    // By DEFAULT this builder emits the LIGHT export above (recording + ganglior_events) and the app's
    // exportGanglior() calls WITHOUT opts.rich → the app's Ganglior stream stays BYTE-IDENTICAL. Only the
    // orchestrate emitter (signal-orchestrate.emitEcgNodeExport) passes opts.rich, so a Unifier/OverDex-routed
    // ECG file additionally carries the slice the Integrator's adaptEnvelopeNode('ECGDex') consumes: the
    // whole-record HRV axis (wholeRecordRMSSD/SDNN — the consensus key), hrv.frequency.lfhf, quality.analyzablePct,
    // the per-5-min timeseries.epochs[].position grid (posture — populated once companions land, §2b), and the
    // sleep stage minutes. Field math MIRRORS ecgdex-app.js buildV2 (same `r`, same numbers). SHARED SHAPE with
    // ppgBuildNodeExport (PPGDEX-FOLLOWUPS §1) — keep the two aligned (the handoff's no-divergence mandate).
    if (opts.rich) {
      var nz = function (v) {
        return v == null || (typeof v === 'number' && !isFinite(v)) ? null : v;
      };
      var amb = !!r.ambulatory,
        lng = !!r.longRec;
      var _geom = baevskyGeom(r.nn); // Baevsky-SI inputs for the envelope (FOLLOWUP-FINDINGS P4)
      out.quality = { analyzablePct: nz(r.analyzablePct), cleanBeatPct: nz(r.cleanBeatPct), coveragePct: nz(r.coveragePct) };
      out.hrv = {
        time: {
          hr: nz(r.dispHr),
          meanRR: nz(r.meanRR),
          sdnn: nz(r.dispSd),
          rmssd: nz(r.dispRm),
          pnn50: nz(r.dispPn),
          sdnnIndex: nz(r.sdnnIdx),
          wholeRecordHR: nz(r.hr),
          wholeRecordSDNN: nz(r.sdnn),
          wholeRecordRMSSD: nz(r.rmssd),
          // FOLLOWUP-FINDINGS P4 — the orchestrate path omitted these while ecgdex-app.js buildV2
          // emitted them, so an ECG file routed through Data Unifier / OverDex gave HRVDex a null
          // Baevsky-SI while the same file exported from the app gave a populated one. Both
          // builders now call ONE `baevskyGeom`, so they agree in value as well as in presence.
          amo50: nz(_geom.amo50),
          mode: nz(_geom.mode),
          mxDMn: nz(_geom.mxDMn),
          units: 'ms',
          geometricNote:
            'Baevsky-SI inputs (Brennan/Welltory convention): amo50 = amplitude of the modal RR (%), mode = modal RR (ms), mxDMn = RR variation range (SECONDS). Same values as the ⬇ HRVDex CSV columns; null when the NN series is empty.',
          windowNote:
            'sdnn/rmssd/pnn50 here are DISPLAY values = representative 5-min epoch median on overnight recordings (short recs: whole-record). For CROSS-NODE comparison use wholeRecordSDNN/wholeRecordRMSSD.'
        },
        /* TCH-REFERENCE-VALIDATION §D2 — ECGDex derives respiration TWO independent ways and used to
         export NEITHER: this block carried only {lf,hf,lfhf,method}. Both now ride the bus.
           respRate     — HF-peak of the RR spectrum (RSA). Same method PpgDex now uses (§D1), so the
                          two nodes are directly comparable.
           respFromEDR  — R-peak AMPLITUDE modulation (cardiorespCoupling). A genuinely INDEPENDENT
                          estimator: morphology, not rhythm. Do not conflate the two.
         Validated against CPAP's measured flow-sensor respiration: the RSA route under-reads by
         ~1.35 br/min, so consumers must treat these as biased estimates, not truth.

         DEEP-AUDIT-2026-07-11 §10: emit ALL FOUR bands, on ONE time scale. Dropping vlf/totalPower here
         was also the upstream half of §3 — HRVDex derives normalized units as hf/(totalPower − vlf), so an
         export carrying lf/hf but no totalPower collapsed its denominator to an epsilon and surfaced
         HF n.u. = 125,000,000 %. `window` names the scale the bands were measured on, so a consumer can
         refuse to compare a 5-min epoch median against a whole-record value. */
        frequency: {
          vlf: nz(r.vlf),
          lf: nz(r.lf),
          hf: nz(r.hf),
          totalPower: nz(r.tp),
          lfhf: nz(r.lfhf),
          window: r.specWindow || null,
          method: 'Lomb–Scargle',
          respRate: nz(r.respRate),
          respRateMethod: 'RSA (HF-peak of RR spectrum)',
          respFromEDR: r.crc && r.crc.respFromEDR != null ? nz(r.crc.respFromEDR) : null,
          /* §1.10: a null `respFromEDR` is a REFUSAL and the export says why — but the reason is
             emitted ONLY when there is one. A `respFromEDRReason: null` on every measuring night
             would move every committed ECGDex export to carry a field that says nothing (the rich
             golden's equiv leg caught exactly that), so the key is present iff the rate is refused.
             `respFromEDR: null` alone already marks the refusal; this is its diagnostic. */
          ...(r.crc && r.crc.respFromEDRReason ? { respFromEDRReason: r.crc.respFromEDRReason } : {}),
          respFromEDRMethod: 'EDR (R-peak amplitude modulation)'
        }
      };
      /* PER-BEAT INTERVALS ON THE BUS (INTERVAL-SERIES-EXPORT).
         ECGDex computed RR for every beat and let it leave only through the app's ⬇ RR button — a
         human clicking, producing a file. Nothing headless could reach it: not the Integrator, not
         trio-batch, not any analysis. The cross-node feed was 5-minute epoch aggregates, so every
         question about beat timing had to re-run the DSP.

         That matters beyond convenience. The published joint clock-skew framework — Abdessalem K.
         (2026), "A software-only framework for synchronization of independently clocked cardiac-linked
         biomedical signals", Meas Sci Technol
         (doi:10.1088/1361-6501/ae6a09) — synchronises independently-clocked sensors to 0.2-0.4 ms from
         IBI SEQUENCES ALONE — and this suite has three interval sources (chest RR, arm PPI, finger
         PPI) and exported none of them, which is why its alignment work has been fighting +/-45 s
         plateaus. */
      out.timeseries = {
        doc: 'Per-5-min-epoch aggregates — the primary cross-node feed (posture rides on epochs[].position; motionIndex = chest-ACC activity, night-normalised median→0 p95→100, null where the ACC did not observe that epoch; vlf·lf·hf·totalPower are absolute band powers in ms² on ONE scale, mirroring the night-level frequency block, so tp = vlf+lf+hf holds per epoch and a consumer can form VLF/LF or normalized units without a collapsed denominator — lfhf alone cannot see the VLF band where CVHR lives).',
        // §D2: the internal epoch already carried `resp` (ls.respRate) — this map dropped it, so no
        // per-epoch respiration ever reached the bus. It is the per-epoch series any cross-node
        // respiration work needs (a night median cannot be correlated against anything).
        // …and the SAME shape of loss applied to motion: the chest-ACC activity index was computed for
        // the staging vote and never left that block, so ECGDex published no motionIndex while PpgDex
        // and OxyDex both do — the correlated-TCH motion-ρ leg ran on two corners, not three. Measured
        // over the 2026-07-16..26 corpus, all 11 nights folded "ECGDex … 0 motion" with the H10 ACC
        // sitting right there in `rec.deviceACC`. Null (not 0) where the ACC observed nothing: "no
        // accelerometer covered this epoch" is not "the body was still".
        epochs: (r.epochs || []).map(function (e) {
          var _ax = r._accEx; // analyze() carries it on its return; it is NOT a local here
          var _mot = _ax && _ax.motionByTMin ? _ax.motionByTMin.get(e.tMin.toFixed(1)) : undefined;
          /* ALL FOUR BANDS ride here, not just the ratio (DEEP-STAGE-DESAT-CONFOUND §9, and
             DEEP-AUDIT-2026-07-11 §10 applied one level down). The epoch already carried vlf/lf/hf/tp;
             this map published only `lfhf`, which is structurally blind to the VLF band — so a consumer
             could not see cyclical-variation-of-heart-rate at all. CVHR is a 20–45 s oscillation ⇒
             0.022–0.05 Hz, and VLF is banded f < 0.04 (:1120), so its power lands in VLF while
             lfhf = LF/HF excludes VLF by construction. Measured on 38 nights: `lfhf` separates
             desat-overlapping Deep epochs from clean ones by −0 % (AUC 0.477, CI spans 0.5) while
             `vlf/lf` separates by +78 % (AUC 0.610, CI excludes 0.5).

             WHY THE WHOLE SET AND NOT JUST vlf+lf. §10 is the precedent and the warning: emitting
             lf/hf WITHOUT totalPower is what collapsed HRVDex's normalized-units denominator
             (hf/(totalPower − vlf)) and surfaced HF n.u. = 125,000,000 %. A partial band set is a
             known-harmful shape in this codebase, so the per-epoch series now mirrors the night-level
             `frequency` block exactly — vlf · lf · hf · totalPower · lfhf, one scale, Task-Force
             identity tp = vlf+lf+hf holding per epoch by construction (:1133).
             There is no MF/SF/ULF/VHF band anywhere in this DSP — the Task-Force set here is VLF, LF,
             HF, and that is the complete set a consumer can expect.

             ADDITIVE ONLY — this publishes what analyze() already computed. No metric changes, no rule
             reads it, and §9.4 explicitly does NOT ship a VLF-keyed Deep rule (measured to make the
             metric worse on base-rate grounds). This exists so the separability question is answerable
             from a committed export instead of only from a raw-corpus re-analysis. */
          return {
            tMin: e.tMin,
            hr: nz(e.hr),
            rmssd: nz(e.rmssd),
            sdnn: nz(e.sdnn),
            vlf: nz(e.vlf),
            lf: nz(e.lf),
            hf: nz(e.hf),
            totalPower: nz(e.tp),
            lfhf: nz(e.lfhf),
            resp: nz(e.resp),
            /* The EXPORTED epoch is built here, separately from the internal one — so the `hrStat`
               label has to be repeated at this seam or the field never leaves the node. It did not,
               on the first attempt: the bundles carried the string and every committed golden still
               read `hrStat: undefined`. Same statistic as the internal builder (60000/mean(RR)). */
            hrStat: 'rate-of-mean',
            /* PER-EPOCH QUALITY (TRIO-ARTIFACT-GATE §1) — projected at this seam too, because the
               exported epoch is built separately from the internal one and a field added only to the
               builder never leaves the node (that is exactly how `hrStat` shipped inert the first
               time). `beats` is the epoch's NN count AFTER artifact gating, so a consumer can tell a
               118 bpm epoch backed by 590 clean beats from one backed by 40. */
            sqi: nz(e.sqi),
            beats: e.n == null ? null : e.n,
            motionIndex: _mot == null ? null : _mot,
            position: e.position || 'unknown'
          };
        }),
        sleepStages:
          lng && !amb && Array.isArray(r.stages)
            ? r.stages.map(function (s) {
                return { tMin: s.tMin, stage: s.stage };
              })
            : null
      };
      /* ATTACHED ONLY WHEN NON-EMPTY, so a record without beats carries no field rather than an empty
         array a consumer would read as "measured, and flat" — and so existing fixtures stay inert. */
      if (r.nn && r.nn.length && r.tt && r.tt.length === r.nn.length) {
        out.timeseries.rr = {
          doc: "Per-beat RR intervals from SELF-COMPUTED, sub-sample-refined Pan-Tompkins R-peaks, Malik-corrected (the same series the app's ⬇ RR button writes). tSec[i] is the beat time in seconds from startEpochMs; ms[i] is the interval ENDING at that beat. Beat times are EXPLICIT, never reconstructed by cumulative sum: a dropout would otherwise be closed silently and every later beat shifted. Device firmware RR is deliberately NOT this series — the H10 _HR.txt is smoothed and under-states variance.",
          n: r.nn.length,
          tSec: r.tt.map(function (v) {
            return +v.toFixed(3);
          }),
          ms: r.nn.map(function (v) {
            return Math.round(v);
          }),
          /* WHICH INTERVALS ARE MEASUREMENTS. 1 = the value was interpolated by the Malik/ectopy gate,
             not observed. Without it the series mixes the two and a consumer cannot tell — and rMSSD
             over interpolated beats is not a measurement of anything. It also exposes an honest quirk
             this export made visible: `rr[0] = rr[1] || 1000` (computeSQI), because beat 0 has no
             predecessor, so the FIRST interval is a copy and is flagged as such. */
          corrected: r.nnCorrected && r.nnCorrected.length === r.nn.length ? r.nnCorrected.slice() : null,
          /* HOW MUCH TO TRUST EACH BEAT — the fused-weight hat's `c` (TCH-FUSED-ROBUST-HAT).
             density × SQI vs the record's own medians, AF-safe (a real fast rhythm keeps clean QRS ⇒
             c≈1); low only where beat-density is an upper outlier AND SQI is depressed, i.e. a
             spurious-detection burst. Distinct from `corrected` (an interpolation FLAG) and from
             epochs[].sqi (a 5-min mean): this is the per-beat weight `tchSigmasFused` multiplies in.
             Surviving beats are ≥0.5 — below that the beat was dropped, not down-weighted. */
          conf: r.nnConf && r.nnConf.length === r.nn.length ? r.nnConf.slice() : null
        };
        if (out.timeseries.rr.corrected) out.timeseries.rr.corrected[0] = 1;
      }
      out.sleep = amb
        ? { suppressed: true, suppressedReason: (r.sleepSuppressed && r.sleepSuppressed.suppressedReason) || 'high-activity / ambulatory', stages: null }
        : lng
          ? { totalSleepMin: nz(r.totSleep), stageMinutes: r.stageMin || null }
          : null;
      // ECGDEX AUDIT F — the Integrator's adaptEnvelopeNode('ECGDex') reads json.apnea.cvhrIndex and
      // json.hrvStability.mean_lnRMSSD_slope, but this orchestrate-routed rich export OMITTED both
      // blocks — so a nocturnal ECG fused DIFFERENTLY by ingest route (the app's ⬇JSON button, which
      // runs buildV2, carried CVHR/slope; a raw-file→OverDex route did not).
      // MIRRORS ecgdex-app.js buildV2 field-for-field (same `r`, same reportable:false ambulatory
      // handling, same null cases when r.cvhr/r.hrvStab are absent) — honoring this builder's own
      // SHARED-SHAPE no-divergence mandate (ppgBuildNodeExport carries the sibling out.apnea).
      // 2026-07-31: the mandate had drifted — `cpc` shipped here (#580) but not in buildV2, so the
      // app's own ⬇JSON export omitted the very metric §9 validated. Both now carry it.
      // The Integrator also read json.apnea.estimatedAHI.value; that field is retired (§10) and the
      // read is left in place upstream, where it degrades to null. See the FOLLOWUPS brief.
      var p = r.profile || {};
      out.apnea = amb
        ? {
            reportable: false,
            suppressedReason: (r.apneaSuppressed && r.apneaSuppressed.suppressedReason) || 'ambulatory — CVHR invalid under exercise',
            cvhrIndex: null,
            onCPAP: !!p.cpap,
            method:
              'CVHR (Hayano) + CPC (Thomas 2005) — WITHHELD: recording is ambulatory/awake-active, exercise HR dynamics read as cardiogenic oscillation. Mirrors the R5 null-model pattern (index withheld with a reason, never fabricated).'
          }
        : lng
          ? {
              cvhrIndex: r.cvhr.index,
              cvhrEvents: r.cvhr.events.length,
              onCPAP: !!p.cpap,
              /* `method` RE-WRITTEN 2026-07-31 (ECGDEX-CARDIOPULMONARY-COUPLING §10). It read
                 "CVHR/cardiopulmonary-coupling proxy (Hilmisson 2019) — ECG-only, screen not
                 diagnosis": half of it named a coupling computation that did not exist until #580,
                 and the whole of it implied this block estimates apnea burden. It now names what IS
                 computed and states the one validated relationship WITH its measured strength, so a
                 consumer sees how weak the link is instead of inferring one from a citation.
                 `estimatedAHI` + `riskCategory` are REMOVED, not nulled — a null field invites
                 someone to fill it, which is how the AHI-labelled proxy arrived. */
              method:
                'CVHR index (cyclic variation of HR, Hayano) + CPC band shares (Thomas 2005). NOT an apnea–hypopnea index: against device-scored residual AHI over 39 paired nights the CVHR index did not track it (r = −0.151, p = 0.36); only cpc.hfcPct did (r = −0.408, p = 0.009). Screen-adjacent signal, not diagnosis.',
              /* CPC (Thomas 2005) — the half of the FORMER `method` string that had no implementation
                 until 2026-07-30. Exported UNREGISTERED and UNBADGED on purpose: it is here so the
                 published bands can be validated against device-scored residualAHI across the paired
                 CPAP nights, which is the evidence a badge would have to rest on. Per
                 ECGDEX-CARDIOPULMONARY-COUPLING §6, no tier above `emerging` before that passes, and
                 §9.4 of DEEP-STAGE-DESAT-CONFOUND still governs: nothing about `Deep` moves on this.
                 Shares are of COUPLING POWER, not of sleep time, and are only interpretable against
                 the uncorrelated-noise null measured for this estimator (VLFC 1.6 / LFC 23.6 /
                 HFC 74.8 %) — a band share is not "percent of the night". */
              cpc: r.crc && r.crc.cpc ? r.crc.cpc : null,
              surgeEscalationPct: r.surgeEsc ? r.surgeEsc.escalationPct : null
            }
          : null;
      /* The index's DENOMINATOR travels with it (DEEP-AUDIT-VI F3): `cvhrIndex` is events per
         hour of OBSERVED recording (nnRes.activeSec), not per hour of wall span, and a consumer
         reading "N /h" should be able to see which hours. Attached only when the index was
         computed — a refusal (N<60, implausible span) carries no basis, and the no-null-key
         discipline keeps the common export byte-stable on the refusal path. */
      if (out.apnea && out.apnea.cvhrIndex != null && r.cvhr && r.cvhr.denomSec > 0) out.apnea.cvhrHours = +(r.cvhr.denomSec / 3600).toFixed(2);
      out.hrvStability = r.hrvStab
        ? {
            sigma_lnRMSSD_slope: r.hrvStab.sigma_lnRMSSD_slope,
            var_lnRMSSD_slope: r.hrvStab.var_lnRMSSD_slope,
            mean_lnRMSSD_slope: r.hrvStab.mean_lnRMSSD_slope,
            classification: r.hrvStab.classification,
            windows: r.hrvStab.nWindows,
            ref: 'Li & Kiyono 2026 Sensors 26(4):1118 [CC BY 4.0]',
            interpretation: 'slope<0 stabilizing (favourable) · slope>0 rising instability (glycemic-risk signal)',
            series: r.hrvStab.series
          }
        : null;
    }
    return out;
  }

  // Headless public surface — parse → analyze (REAL Pan-Tompkins pipeline, no Worker)
  // → shared node-export. Accepts a Polar Sensor Logger `*_ECG.txt` string, {text}, an
  // already-parsed rec {int16,fs}, or the canonical ecg SignalFrame {samples:Float32Array,fs,t0Ms}.
  function compute(input, opts) {
    opts = opts || {};
    var rec;
    if (input && input.samples != null && input.samples.length != null && !Array.isArray(input.samples.ch)) {
      // Canonical ecg SignalFrame (signal-frame.js): single-channel samples (Float32Array|Int16Array|number[])
      // + fs/t0Ms/offsetMin on the frame. signal-orchestrate.emitEcgNodeExport hands this STRAIGHT to
      // compute() (the §1/§4#2 compute()-shape contract — accept the canonical frame, not only {text}).
      // Rebuild the analyze-rec DIRECTLY from the frame's own samples (the polar-h10-ecg adapter already
      // ran ECGDex.parseECG — do NOT re-parse). Int16 is what analyze's SQI/rail checks expect, so coerce.
      var s = input.samples,
        N = s.length,
        int16 = s instanceof Int16Array ? s : new Int16Array(N);
      if (!(s instanceof Int16Array)) {
        for (var i = 0; i < N; i++) {
          var vv = Math.round(s[i]);
          int16[i] = vv > 32767 ? 32767 : vv < -32768 ? -32768 : vv;
        }
      }
      var fs = input.fs != null ? input.fs : 130;
      rec = {
        int16: int16,
        fs: fs,
        gaps: input.gaps || [],
        t0Ms: input.t0Ms != null ? input.t0Ms : null,
        offsetMin: input.offsetMin != null ? input.offsetMin : null,
        source: opts.source || 'signal-frame',
        durSec: N / (fs || 130),
        deviceRR: input.deviceRR || null,
        deviceHR: input.deviceHR || null,
        deviceACC: input.deviceACC || null,
        accFs: input.accFs || null
      };
    } else if (input && input.int16 != null && input.fs != null) {
      rec = input; // already a parsed rec (app / synthetic / test path)
    } else {
      var txt = typeof input === 'string' ? input : input && typeof input.text === 'string' ? input.text : input && input.samples && typeof input.samples.text === 'string' ? input.samples.text : null;
      if (txt == null) throw new Error('ECGDex.compute: need a Polar Sensor Logger *_ECG.txt string, {text}, a parsed rec {int16,fs}, or an ecg SignalFrame {samples:Float32Array,fs}.');
      rec = parseECGText(txt);
    }
    if (opts.source) rec.source = opts.source;
    if (opts.offsetMin != null && rec.offsetMin == null) rec.offsetMin = opts.offsetMin;
    var r = analyze(rec, null);
    if (r.offsetMin == null && rec.offsetMin != null) r.offsetMin = rec.offsetMin; // carry zone (analyze doesn't propagate it)
    return ecgBuildNodeExport(r, opts);
  }

  global.ECGDSP.parseECG = parseECGText;
  /* THE TWO HALVES OF THE TIMING WALK, exported because the APP LANE IS A CONSUMER (DEEP-AUDIT-VI F2)
     — not merely for assertability. `ecgdex-app.js` builds its streaming Worker from
     `ecgTimingScan.toString()` and calls `ecgTimingResolve` on the scan the Worker ships back, so
     these two are the app's parser as much as the headless one's. A change here changes both lanes,
     which is the entire point: the app used to carry a hand-written mirror that was 96–320 ppm off. */
  global.ECGDSP.ecgTimingScan = ecgTimingScan;
  global.ECGDSP.ecgTimingResolve = ecgTimingResolve;
  global.ECGDSP.parseDeviceRR = parseDeviceRR;
  global.ECGDSP.parseDeviceHR = parseDeviceHR;
  global.ECGDSP.parseDeviceACC = parseDeviceACC;
  global.ECGDSP.planCompanionGraft = planCompanionGraft; // §10.4 — pure, so the graft rule is gateable
  global.ECGDSP.hrvStability = hrvStability; // DEEP-AUDIT-II #39 — pure, so the per-window epoch count n is gateable
  /* TRIO-ARTIFACT-GATE §1 — pure, so "an absent per-beat SQI yields a null epoch sqi, never a
     clean-looking 1" is reachable. Attached to ECGDSP (the surface the suite consumes) rather than to
     ECGDex: the first attempt put it on ECGDex, and the three legs that depend on it SKIPPED silently
     while the group still read 10/10 green. A leg that cannot run is not a gate. */
  global.ECGDSP.epochEngine = epochEngine;
  global.ECGDSP.baevskyGeom = baevskyGeom; // FOLLOWUP-FINDINGS P4 — ONE source for both node-export builders (app buildV2 + orchestrate); pure, so the two are gateable against each other
  global.ECGDSP.compute = compute;
  global.ECGDSP.buildNodeExport = ecgBuildNodeExport;
  // ONE namespaced global (brief §1A). ECGDex leaks nothing bare (the whole DSP is in this
  // IIFE) → no __DEX_NAMESPACED__ suppression gate needed; this is an explicit named global,
  // collision-free in the co-load realm. Standalone bundles still read ECGDSP.
  // ═══════════════════════════════════════════════════════════════════════════
  //  SELF-INGEST — reload ECGDex's OWN ganglior.node-export as a review-mode
  //  clinical VIEW (SELF-INGEST-FOLLOWUPS · ECGDex pass, EXPORT-INERT). ECGDex
  //  already emits a RICH node-export (buildV2 / exportSummary: recording +
  //  quality + hrv + epochs) AND a light one (exportGanglior: recording + events)
  //  — both schema.node 'ECGDex'. This reader accepts EITHER, single or a
  //  recordings[] multi wrapper, and returns whatever derived layer is present
  //  VERBATIM. PURE + DOM-FREE; never recomputes, never re-stamps (§3).
  // ═══════════════════════════════════════════════════════════════════════════
  function ecgLoadOwnExport(json) {
    if (!(json && json.schema && json.schema.name === 'ganglior.node-export'))
      return { ok: false, reason: 'not-node-export', message: 'Not a node-export \u2014 drop a raw Polar H10 *_ECG.txt, or ECGDex\u2019s own .json export.' };
    var node = ((json.schema.node || '') + '').trim();
    if (node !== 'ECGDex')
      return {
        ok: false,
        reason: 'foreign-node',
        node: node,
        message: 'This is a ' + (node || 'non-ECGDex') + ' export \u2014 open it in ' + (node || 'its own node') + ', or drop it into the Integrator to fuse.'
      };
    var carrier = Array.isArray(json.recordings) ? json.recordings : [json];
    var elements = carrier.map(function (el) {
      var e = JSON.parse(JSON.stringify(el));
      e._fromExport = true;
      e._reviewMode = true;
      return e;
    });
    var evAll = Array.isArray(json.ganglior_events) ? json.ganglior_events.slice() : [];
    if (!evAll.length)
      carrier.forEach(function (el) {
        if (Array.isArray(el.ganglior_events)) evAll = evAll.concat(el.ganglior_events);
      });
    evAll.sort(function (a, b) {
      return ((a && a.tMs) || 0) - ((b && b.tMs) || 0);
    });
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
      recording: (carrier[0] && carrier[0].recording) || json.recording || null,
      hrv: (carrier[0] && carrier[0].hrv) || json.hrv || null,
      quality: (carrier[0] && carrier[0].quality) || json.quality || null,
      crossNight: json.crossNight || null,
      scrubbed: !!(json.schema && json.schema.scrubbed),
      multiNight: elements.length > 1,
      raw: json
    };
  }

  global.ECGDex = global.ECGDex || {
    compute: compute,
    parseECG: parseECGText,
    analyze: analyze,
    genSynthetic: genSynthetic,
    buildNodeExport: ecgBuildNodeExport,
    _build: ecgBuildNodeExport,
    parseDeviceRR: parseDeviceRR,
    parseDeviceHR: parseDeviceHR,
    parseDeviceACC: parseDeviceACC,
    coverage: ecgCoverage, // INTEGRATOR-GAP-AWARE-OVERLAP part 2 — pure, so the segment derivation is gateable
    planCompanionGraft: planCompanionGraft // §10.4 — pure, so the graft rule is gateable
  };
  global.ECGDex.loadOwnExport = ecgLoadOwnExport; // SELF-INGEST reload (review-mode clinical view)
  // scrub-for-sharing → the SHARED dexScrubExport (D1); lazy delegate, co-load order irrelevant.
  global.ECGDex.scrubExport = function (env) {
    if (global.DexExport && typeof global.DexExport.scrubExport === 'function') return global.DexExport.scrubExport(env);
    if (typeof global.dexScrubExport === 'function') return global.dexScrubExport(env);
    return env;
  };
})(window);

// ESM-MIGRATION: ecgdex-dsp is now a DUAL-MODE module. The IIFE above still attaches window.ECGDSP /
// window.ECGDex — the headless node API AND every classic co-load consumer (the orchestrators, both
// test runners, and the raw analysis workers, which classic-load this file via tools/build-core.js
// `classicify`). These re-exports let the owned ESM bundle's ecgdex-app.js `import { ECGDSP }` instead
// of reading window. The inlined WORKER_SRC in ecgdex-app.js is a hermetic string (references no module
// binding), so this export does not touch the worker realm.
export const ECGDSP = window.ECGDSP;
export const ECGDex = window.ECGDex;
