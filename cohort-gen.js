/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   cohort-gen.js — Ganglior Cohort Validation: synthetic patient sampler
   ----------------------------------------------------------------------------
   Generalizes the single-subject corpus (synth-gen.js / SYNTH) into N
   physiologically-coherent synthetic PATIENTS. Each patient is a seeded draw
   over the parameter space (age × sex × BMI × OSA severity × event mix × CPAP
   state × glycemia × autonomic baseline × artifact × missingness × longitudinal
   arc), rendered into every device's native file format by REUSING the SYNTH
   renderers UNCHANGED. Deterministic: seed = patient index → byte-reproducible.

   CohortGen.patient(seed) → { pid, seed, profile, nights[], files, groundTruth }
     · nights[i] = { cfg, tl, groundTruth, files:{ oxyCSV, rrText } }
     · files     = { glucoCSV, hrvCSV }  (continuous across the patient's nights)

   FAST mode (default, the 10k lane): emits OxyDex CSV + RR text + CGM + HRV
   summary rows. NO 176 Hz PPG waveform (that's the ≤500 Full lane — runtime
   driver, measured separately). PPG is omitted here by construction.

   CLOCK CONTRACT: all SYNTH renderers emit floating wall-clock ms. The SYNTH
   glucose hypo/dawn injectors are pinned to civil May-2026 dates (bed[2]+1 =
   next-morning), so every patient's nights are placed in **May 2026** with
   pre-midnight bedtimes — that keeps the planted couplings landing on the right
   absolute instants while each patient still gets an independent arc.
   100% local, no network, no deps beyond window.SYNTH.
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var VERSION = 'cohort-gen/1.9';   // 1.9: re-fit rsaGainFor for synth-gen v2.1 texture — variance-space form sqrt(t²−7²)/19.15, clamp [0.06, 4.35]. Raised ceiling (was 3.2) so high-HRV targets (61–80 ms) render distinctly instead of stacking on a flat top line; lowered floor const 15.5→7 + min clamp 0.30→0.06 so the low-HRV tail spreads (paired with v2.1's HRV-scaled fast-variability floor) instead of a flat bottom line. 1.8: variance-space rsaGainFor for v2.0 (old linear fit ran +3–4 ms over target); 1.7: soft AHI-ceiling saturation (no vertical pileup at the cap in ODI–AHI calibration); 1.6: realistic CGM adoption; 1.5: saturating rMSSD suppression; 1.4: continuous age; 1.3: jittered rMSSD bounds; 1.2: jittered AHI ceiling; 1.1: jittered CPAP residual

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) { var u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function chance(rng, p) { return rng() < p; }

  // ── parameter-space dictionaries (the credibility axis) ────────────────────
  var SEVERITY = [
    { key: 'none',   ahi: [0, 5],   w: 1 },
    { key: 'mild',   ahi: [5, 15],  w: 1 },
    { key: 'mod',    ahi: [15, 30], w: 1 },
    { key: 'severe', ahi: [30, 80], w: 1 },
  ];
  var GLYC = ['normal', 'preDM', 'T2D'];
  var ARC  = ['flat', 'improving', 'worsening', 'intervention'];
  var CPAP_STATE = ['untreated', 'new', 'adherent-residual', 'non-adherent'];

  // rsaGain that drives rMSSD in SYNTH.buildRR. Re-fit to the v2.1 texture (HRV-level-scaled
  // fast variability). Variance-space form: rendered rMSSD ≈ sqrt(floor² + (gain·scale)²), so the
  // inverse is gain = sqrt(max(0, t² − floor²)) / scale, anchored on post-artifactClean rMSSD
  // through the REAL PulseDex chain (floor=7, scale=19.15; verified target≈rendered ±1 ms, 25–60).
  //  • CEILING 4.35 (was 3.2): high-HRV targets 61–80 ms now render distinctly — no flat top line.
  //  • FLOOR const 7 + min clamp 0.06 (were 15.5 / 0.30): low-HRV targets get DISTINCT low gains,
  //    and v2.1's HRV-scaled texture lowers their rendered floor — so the low tail SPREADS
  //    (≈8–19 ms) instead of stacking on a flat bottom line. DFA-α1 preserved (≈0.76).
  function rsaGainFor(rmssd) { return clamp(Math.sqrt(Math.max(0, rmssd * rmssd - 7 * 7)) / 19.15, 0.06, 4.35); }

  // BMI → OSA severity prior (heavier ⇒ worse). Returns a SEVERITY index draw.
  // BMI + sex → OSA severity prior. Heavier ⇒ worse; male ⇒ worse (well-established
  // epidemiology: male OSA prevalence runs ~2× female, the gap narrowing with age as the
  // post-menopausal female risk rises). `sexPressure` is added to the obesity pressure that
  // tilts the categorical draw toward higher-severity strata. Returns a SEVERITY index draw.
  function sampleSeverity(rng, bmi, sex, age) {
    // base obesity pressure: BMI 19→~0, 48→~1
    var p = clamp((bmi - 22) / 24, 0, 1);
    // male tilt: +0.18 at 40, fading to +0.06 by 75 as the female gap closes
    var sexPressure = (sex === 'M') ? clamp(0.18 - Math.max(0, age - 40) * 0.0034, 0.06, 0.18) : 0;
    p = clamp(p + sexPressure, 0, 1);
    var r = rng();
    // tilt the categorical draw toward higher severity as p rises
    var w = [ (1 - p) * 1.2 + 0.15, 0.6 + 0.3 * (1 - Math.abs(p - 0.33) * 2), 0.5 + p * 0.8, 0.1 + p * 1.4 ];
    var s = w[0] + w[1] + w[2] + w[3], acc = 0; r *= s;
    for (var i = 0; i < 4; i++) { acc += w[i]; if (r <= acc) return i; }
    return 3;
  }

  // arc shaping: per-night AHI multiplier + cpap flag, given the planted arc.
  function arcNightAHI(arc, baseAHI, i, nNights, interventionNight) {
    var t = nNights > 1 ? i / (nNights - 1) : 0;
    switch (arc) {
      case 'improving':    return baseAHI * (1 - 0.55 * t);
      case 'worsening':    return baseAHI * (1 + 0.7 * t);
      case 'intervention': return i < interventionNight ? baseAHI * (0.9 + 0.2 * (i / Math.max(1, interventionNight)))
                                                        : baseAHI * (0.18 + 0.05 * (nNights - i));
      default:             return baseAHI; // flat (jitter added by caller)
    }
  }
  function arcNightCPAP(arc, cpapState, i, interventionNight) {
    if (arc === 'intervention') return i >= interventionNight;
    if (cpapState === 'adherent-residual') return true;
    if (cpapState === 'new') return i >= 1;
    if (cpapState === 'non-adherent') return false;
    return false; // untreated
  }

  // ── profile sampler ────────────────────────────────────────────────────────
  function sampleProfile(seed) {
    var rng = mulberry32((seed >>> 0) ^ 0x9e3779b9);
    var age = +(20 + rng() * 65).toFixed(2);               // 20–85, continuous (years.months) so the age axis is a smooth cloud, not integer columns (v1.4)
    var sex = chance(rng, 0.52) ? 'M' : 'F';
    var bmi = +(19 + rng() * 29).toFixed(1);               // 19–48
    var sevIdx = sampleSeverity(rng, bmi, sex, age);       // BMI + sex (male→worse) prior
    var sev = SEVERITY[sevIdx];
    var baseAHI = +(sev.ahi[0] + rng() * (sev.ahi[1] - sev.ahi[0])).toFixed(1);
    var arc = pick(rng, ARC);
    var nNights = 1 + Math.floor(rng() * 12);              // variable 1–12 (longitudinal lane)
    var interventionNight = arc === 'intervention'
      ? clamp(1 + Math.floor(rng() * (nNights - 1)), 1, Math.max(1, nNights - 1)) : -1;
    var cpapState = arc === 'intervention' ? 'new' : pick(rng, CPAP_STATE);

    // glycemia
    var glyc = pick(rng, GLYC);
    var hypoFlag = (glyc !== 'normal') && chance(rng, glyc === 'T2D' ? 0.45 : 0.22);
    var dawnFlag = chance(rng, glyc === 'T2D' ? 0.6 : glyc === 'preDM' ? 0.4 : 0.12);

    // autonomic baseline (rMSSD) — declines with age, individual offset. Wide, breathing
    // clamp bounds so the ceiling/floor are reached only in the gaussian tail (density fades
    // into them rather than piling a flat line) (v1.5).
    var rmssdBase = clamp(52 - (age - 25) * 0.42 + gauss(rng) * 6, 8 + rng() * 5, 64 + rng() * 9);

    // artifact + missingness model
    var artifact = +clamp(0.02 + Math.abs(gauss(rng)) * 0.06, 0, 0.35).toFixed(3); // extra-dropout fraction
    var motion = +clamp(0.05 + rng() * 0.4, 0, 1).toFixed(2);
    var offBody = chance(rng, 0.04);                        // whole-patient off-body weirdness

    // which nodes this patient carries (missingness). Always keep ≥1 cardiac source.
    var hasOxy   = chance(rng, 0.93);
    var hasRR    = chance(rng, 0.90);                       // drives ECGDex + PulseDex
    if (!hasOxy && !hasRR) hasRR = true;
    var hasGluco = chance(rng, glyc === 'normal' ? 0.7 : 0.92);   // OTC consumer CGM (Lingo) — high, continuous-wear adoption (v1.6)
    var hasHRV   = chance(rng, 0.7);

    // start day in May 2026, leaving room for nNights+1 (the +1 next-morning pin)
    var startDay = 1 + Math.floor(rng() * (30 - nNights));
    startDay = clamp(startDay, 1, 30 - nNights);

    return {
      version: VERSION, seed: seed >>> 0,
      age: age, sex: sex, bmi: bmi,
      osaSeverity: sev.key, baseAHI: baseAHI,
      arc: arc, nNights: nNights, interventionNight: interventionNight, cpapState: cpapState,
      glycemic: glyc, nocturnalHypo: hypoFlag, dawnPhenomenon: dawnFlag,
      rmssdBaseline: +rmssdBase.toFixed(1),
      artifactLevel: artifact, motionDensity: motion, offBody: offBody,
      nodes: { OxyDex: hasOxy, ECGDex: hasRR, PulseDex: hasRR, GlucoDex: hasGluco, HRVDex: hasHRV },
      startDay: startDay, year: 2026, month: 5,
    };
  }

  // ── per-night cfg (the shape SYNTH.masterTimeline expects) ─────────────────
  function buildNightConfigs(profile, rng) {
    var cfgs = [];
    var hypoNight = profile.nocturnalHypo ? Math.floor(rng() * profile.nNights) : -1;
    for (var i = 0; i < profile.nNights; i++) {
      var day = profile.startDay + i;
      var bedH = 21 + Math.floor(rng() * 3);                 // 21–23 (pre-midnight → next-morning pin holds)
      var bedM = Math.floor(rng() * 60);
      var durSec = Math.round((6.8 + rng() * 1.4) * 3600);   // ~6.8–8.2 h
      var ahi = arcNightAHI(profile.arc, profile.baseAHI, i, profile.nNights, profile.interventionNight);
      // flat arc jitter + general night-to-night noise, then a SOFT saturation toward the
      // ceiling (asymptotic, like the v1.5 rMSSD floor) so worsening-arc severe overshoot fades
      // toward ~95 instead of piling into a vertical band at the cap (v1.7; replaces v1.2 hard
      // jittered clamp 80–92 which still stacked a red vertical line in the ODI–AHI calibration).
      var _ahiJit = Math.max(0, ahi * (0.9 + rng() * 0.2)), _ahiCap = 95;
      ahi = +(_ahiCap * (1 - Math.exp(-_ahiJit / _ahiCap))).toFixed(1);
      var cpap = arcNightCPAP(profile.arc, profile.cpapState, i, profile.interventionNight);
      // residual AHI under therapy: a proportional, jittered reduction (15–40% of baseline,
      // never above baseline). Replaces the former hard `Math.min(ahi, clamp(ahi*0.6,0,15))`,
      // which pinned every treated night with baseAHI≥25 to EXACTLY 15 — a ~10%-of-all-nights
      // spike that drew a spurious vertical line at AHI=15 in the rMSSD-vs-AHI scatter. (v1.1)
      if (cpap) ahi = clamp(ahi * (0.15 + rng() * 0.25), 0, ahi);

      // glucose story for this night
      var gluc = 'flat';
      if (i === hypoNight) gluc = 'hypo';
      else if (profile.dawnPhenomenon && i >= profile.nNights - 2) gluc = 'dawn';

      // rMSSD this night: lower with apnea burden, recovers on therapy / improving arc
      // rMSSD suppression by apnea SATURATES toward a soft floor instead of decreasing
      // linearly past it: for low–moderate AHI it is ~0.22 ms/AHI (the planted coupling), but
      // it asymptotes so severe nights settle just above the floor and fade in rather than
      // all clipping onto it (removes the bottom flat line) (v1.5).
      var rmRoom = Math.max(2, profile.rmssdBaseline - 6);
      var rmSupp = rmRoom * (1 - Math.exp(-(ahi * 0.22) / rmRoom));
      var rmssd = clamp(profile.rmssdBaseline - rmSupp + (cpap ? 6 : 0) + gauss(rng) * 2.5, 3 + rng() * 4, 74 + rng() * 6);

      cfgs.push({
        n: i + 1, date: profile.year + '-' + p2(profile.month) + '-' + p2(day),
        bed: [profile.year, profile.month, day, bedH, bedM],
        durSec: durSec, ahi: +ahi.toFixed(1), cpap: cpap,
        gluc: gluc, rmssd: +rmssd.toFixed(1), rsaGain: +rsaGainFor(rmssd).toFixed(3),
        story: profile.arc + (cpap ? ' · CPAP' : '') + (gluc !== 'flat' ? ' · ' + gluc : ''),
      });
    }
    return cfgs;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  // ── extra-dropout post-processor (artifact model on top of SYNTH's baked span)
  //    Blanks a SMALL fraction (~frac of rows) as a FEW contiguous finger-off /
  //    contact-loss bursts so the QC gate sees patient-varying missingness while
  //    ≥1 long clean span always survives (the validation lane). frac is a total
  //    blanked-fraction target, NOT a per-row probability.
  function injectDropout(csv, frac, seed) {
    if (!frac || frac <= 0) return csv;
    var rng = mulberry32(seed >>> 0);
    var lines = csv.split('\n');
    var nData = lines.length - 1;                          // minus header
    if (nData < 600) return csv;
    var blankTotal = Math.min(Math.round(nData * Math.min(frac, 0.3)), Math.round(nData * 0.3));
    var nBursts = 1 + Math.floor(rng() * 3);               // 1–3 bursts
    var perBurst = Math.max(20, Math.round(blankTotal / nBursts));
    // confine bursts to the middle 60% so the night's first/last fifths stay clean
    var lo = Math.round(nData * 0.2), hi = Math.round(nData * 0.8) - perBurst;
    for (var b = 0; b < nBursts && hi > lo; b++) {
      var start = lo + Math.floor(rng() * (hi - lo));
      for (var j = 0; j < perBurst; j++) {
        var idx = 1 + start + j;
        if (idx >= lines.length) break;
        var t = lines[idx] && lines[idx].split(',')[0];
        if (t) lines[idx] = t + ',--,--,0';
      }
    }
    return lines.join('\n');
  }

  // ── the patient ────────────────────────────────────────────────────────────
  //  opts.only = subset of ['oxy','rr','gluco','hrv'] → render ONLY those files
  //  (the worker pool splits nodes across cores; each worker renders just what it
  //  analyzes, so the heavy CSV/RR string-building isn't duplicated). Ground truth
  //  + profile are always built (cheap, needed for scoring). Default = all.
  function patient(seed, opts) {
    if (!global.SYNTH) throw new Error('cohort-gen requires window.SYNTH (load synth-gen.js first)');
    var S = global.SYNTH;
    opts = opts || {};
    var only = opts.only ? { oxy: opts.only.indexOf('oxy') >= 0, rr: opts.only.indexOf('rr') >= 0,
                             gluco: opts.only.indexOf('gluco') >= 0, hrv: opts.only.indexOf('hrv') >= 0 }
                         : { oxy: true, rr: true, gluco: true, hrv: true };
    seed = seed >>> 0;
    var profile = sampleProfile(seed);
    var rng = mulberry32(seed ^ 0x1234567);
    var cfgs = buildNightConfigs(profile, rng);

    // build one master timeline per night (deterministic per patient+night)
    var timelines = cfgs.map(function (cfg, i) { return S.masterTimeline(cfg, (seed + i * 7919) >>> 0); });

    // per-night raw files (FAST: OxyDex CSV + RR text), honoring missingness
    var nights = timelines.map(function (tl, i) {
      var present = nightNodes(profile, i, rng);   // call FIRST (advances rng deterministically)
      var files = {};
      if (present.OxyDex && only.oxy) {
        var oxy = S.renderOxy(tl);
        oxy = injectDropout(oxy, profile.artifactLevel, (seed + i * 31 + 5) >>> 0);
        files.oxyCSV = oxy;
      }
      if ((present.ECGDex || present.PulseDex) && only.rr) files.rrText = S.renderRR(tl);
      var night = {
        n: tl.cfg.n, cfg: tl.cfg, present: present,
        groundTruth: JSON.parse(S.groundTruth(tl)),
        files: files,
      };
      // FULL lane needs the live timeline object (for renderPPG / renderECGInt16). Not
      // serializable across postMessage cleanly, so only attach when asked (same realm).
      if (opts.attachTimelines) night.tl = tl;
      return night;
    });

    // continuous-across-nights files
    var files = {};
    if (profile.nodes.GlucoDex && only.gluco) files.glucoCSV = S.renderGlucoAll(timelines);
    if (profile.nodes.HRVDex   && only.hrv)   files.hrvCSV   = S.renderHRVAll(timelines);

    // aggregate ground truth (for scoring / coverage)
    var truthAHI = nights.map(function (nt) { return nt.cfg.ahi; });
    var groundTruth = {
      pid: 'p' + String(seed).padStart(6, '0'),
      profile: profile,
      nights: nights.map(function (nt) {
        var apneas = nt.groundTruth.events.filter(function (e) { return e.type === 'apnea' || e.type === 'hypopnea'; });
        return {
          n: nt.cfg.n, date: nt.cfg.date, t0Ms: nt.groundTruth.t0Ms, durSec: nt.groundTruth.durSec,
          ahiTruth: nt.cfg.ahi, cpap: nt.cfg.cpap, gluc: nt.cfg.gluc, rmssdTarget: nt.cfg.rmssd,
          nApnea: apneas.length, nPB: nt.groundTruth.periodicBreathing.length,
          eventsTMs: apneas.map(function (e) { return e.t0Ms; }),
        };
      }),
      interventionNight: profile.interventionNight,
      arc: profile.arc, truthAHI: truthAHI,
    };

    return {
      pid: 'p' + String(seed).padStart(6, '0'), seed: seed,
      profile: profile, nights: nights, files: files, groundTruth: groundTruth,
    };
  }

  // per-night missingness: occasionally drop a node on a single night (partial nights)
  function nightNodes(profile, i, rng) {
    return {
      OxyDex:   profile.nodes.OxyDex   && !(chance(rng, 0.05)),
      ECGDex:   profile.nodes.ECGDex   && !(chance(rng, 0.05)),
      PulseDex: profile.nodes.PulseDex && !(chance(rng, 0.05)),
    };
  }

  // ── CPAPDex synthetic input ────────────────────────────────────────────────
  //  KNOWN HARD PART #3: CpapDsp._synthEdfSet is test-shaped (fixed 10-min, 5 events).
  //  Build an AHI-parameterized EDF-shaped `set` matching buildSessionFromEdf's input
  //  (decoded records, NOT raw bytes): PLD detail channels @0.5 Hz + SA2 oximetry @1 Hz
  //  + EVE/CSL device-scored annotations. residualAHI = nEvents / therapyHours, so we
  //  plant round(ahi·hours) EVE events spread across the night. CPAP only exists on a
  //  night the patient is actually on therapy (cfg.cpap===true). Pressure ~ patient's
  //  set pressure; leak ~ mask-fit. Clock Contract: t0Ms is the night's floating ms.
  function mkSig(n, fn, fs, dim) { var a = new Float32Array(n); for (var i = 0; i < n; i++) a[i] = fn(i); return { data: a, fs: fs, dim: dim, _spr: Math.round(fs * 60) }; }
  function buildCpapEdfSet(night, profile, seed) {
    var rng = mulberry32((seed >>> 0) ^ 0xc9a9);
    var t0 = night.groundTruth.t0Ms;
    var durSec = night.cfg.durSec;
    var recDur = 60, R = Math.max(1, Math.round(durSec / recDur));
    var nH = Math.round(durSec * 0.5);          // 0.5 Hz PLD detail length
    var n1 = durSec;                            // 1 Hz SA2 length
    var hours = durSec / 3600;

    var setPress = 8 + Math.round(rng() * 7);   // 8–15 cmH2O fixed-CPAP set pressure
    var epr = 3;                                // EPR relief
    // leak: base by mask fit; heavier for high-artifact patients, occasional large-leak span
    var baseLeakLs = 0.06 + profile.artifactLevel * 0.18 + rng() * 0.04;  // L/s
    var bigLeak = chance(rng, 0.18);
    var leakStart = Math.round(nH * (0.4 + rng() * 0.3)), leakLen = Math.round(nH * 0.12);

    var PLD = { clock: { t0Ms: t0 }, recordsRead: R, recDurSec: recDur, numRecords: R, truncated: false, signals: {
      'Press.2s':    mkSig(nH, function (i) { return setPress + Math.sin(i / 60) * 0.2; }, 0.5, 'cmH2O'),
      'EprPress.2s': mkSig(nH, function () { return setPress - epr; }, 0.5, 'cmH2O'),
      'Leak.2s':     mkSig(nH, function (i) { var l = baseLeakLs; if (bigLeak && i >= leakStart && i < leakStart + leakLen) l = 0.55 + rng() * 0.2; return l; }, 0.5, 'L/s'),
      'RespRate.2s': mkSig(nH, function () { return 13 + Math.round(rng() * 3); }, 0.5, 'bpm'),
      'TidVol.2s':   mkSig(nH, function () { return 0.45 + rng() * 0.12; }, 0.5, 'L'),
      'MinVent.2s':  mkSig(nH, function () { return 6.5 + rng() * 1.2; }, 0.5, 'L/min'),
      'Snore.2s':    mkSig(nH, function () { return 0.04; }, 0.5, ''),
      'FlowLim.2s':  mkSig(nH, function () { return 0.08; }, 0.5, ''),
      'Crc16':       mkSig(R, function () { return 1; }, 1 / 60, '')
    } };

    // SA2 oximetry: present for most therapy nights; gentle desats co-located with events
    var hasOxi = chance(rng, 0.7);
    var spo2 = new Float32Array(n1), pulse = new Float32Array(n1);
    if (hasOxi) { for (var z = 0; z < n1; z++) { spo2[z] = 95 + Math.round(rng() * 2); pulse[z] = 56 + Math.round(rng() * 8); } }
    else { for (var z2 = 0; z2 < n1; z2++) { spo2[z2] = -1; pulse[z2] = -1; } }
    var SA2 = { clock: { t0Ms: t0 }, recordsRead: R, recDurSec: recDur, signals: {
      'SpO2.1s':  { data: spo2,  fs: 1, dim: '%',   _spr: 60 },
      'Pulse.1s': { data: pulse, fs: 1, dim: 'bpm', _spr: 60 }
    } };

    // EVE device-scored events → residual AHI. round(ahi·hours), mixed classes.
    var nEv = Math.max(0, Math.round(night.cfg.ahi * hours));
    var classes = ['Obstructive Apnea', 'Hypopnea', 'Hypopnea', 'Central Apnea', 'RERA'];
    var ann = [];
    for (var e = 0; e < nEv; e++) {
      var onset = Math.round(60 + (durSec - 120) * (e + 0.5) / Math.max(1, nEv) + (rng() - 0.5) * 30);
      onset = Math.max(1, Math.min(durSec - 5, onset));
      var cls = classes[Math.floor(rng() * classes.length)];
      var dur = cls === 'RERA' ? 8 : cls === 'Hypopnea' ? 16 + Math.round(rng() * 8) : 12 + Math.round(rng() * 10);
      ann.push({ class: cls, durSec: dur, onsetSec: onset, tMs: t0 + onset * 1000 });
      if (hasOxi && cls !== 'RERA') { var di = Math.min(n1 - 1, onset); for (var d = 0; d < 25 && di + d < n1; d++) spo2[di + d] = Math.max(85, 95 - Math.min(d, 12) * 0.7); }
    }
    var EVE = { clock: { t0Ms: t0 }, recordsRead: 1, recDurSec: 0, signals: {}, annotations: ann.length ? ann : [{ class: 'Unclassified', durSec: 0, onsetSec: 0, tMs: t0 }] };

    // CSL Cheyne-Stokes span for some central-heavy / CSR patients
    var hasCSR = night.cfg.ahi > 25 && chance(rng, 0.25);
    var CSL = { clock: { t0Ms: t0 }, annotations: hasCSR
      ? [{ class: 'Cheyne-Stokes', durSec: 120 + Math.round(rng() * 180), onsetSec: Math.round(durSec * 0.3), tMs: t0 + Math.round(durSec * 0.3) * 1000 }]
      : [{ class: 'Unclassified', durSec: 0, onsetSec: 0, tMs: t0 }] };

    return { PLD: PLD, SA2: SA2, EVE: EVE, CSL: CSL };
  }

  global.CohortGen = {
    VERSION: VERSION,
    patient: patient,
    sampleProfile: sampleProfile,
    buildNightConfigs: buildNightConfigs,
    buildCpapEdfSet: buildCpapEdfSet,
    _mulberry32: mulberry32,
  };
})(typeof window !== 'undefined' ? window : this);
