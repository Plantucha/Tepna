/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   cohort-worker.js — Web Worker for the Ganglior Cohort Validation Harness.
   ----------------------------------------------------------------------------
   Build-order step 2: parallelize the pilot loop across navigator.hardwareConcurrency
   cores. One worker = ONE realm dedicated to one KIND of node set, so the plain-global
   DSP files (which collide on parseCSV / parseTimestamp / mean / std / const decls)
   never share a scope, AND so we don't double-render the heavy CSV/RR strings:

     kind 'oxy'     → synth-gen + cohort-gen + kernel + OxyDex stack.   renders only oxy.
     kind 'rrgluco' → synth-gen + cohort-gen + kernel + PulseDex + GlucoDex (IIFE, no
                      collision with PulseDex's globals). renders rr + gluco + hrv.

   The worker GENERATES its patient (cohort-gen is pure, runs fine off-DOM) and runs the
   REAL DSP, returning the MINIMAL ganglior envelopes the Integrator reads + compact
   scoring companions. The Integrator + final scoring stay on the main thread (cheap,
   and they must combine both kinds' envelopes per patient).

   DOM shim: OxyDex binds #uploadArea / reads document.documentElement at top-level load.
   A worker has no document, so we install a permissive Proxy DOM + window===self BEFORE
   importScripts — nothing here touches the real file-drop UI, the elements just must exist.
   100% local.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── permissive DOM / window shim (load-time only; pipeline math is DOM-free) ── */
(function installDomShim() {
  var stub = new Proxy(function () {}, {
    get: function (t, p) {
      if (p === 'outerHTML' || p === 'innerHTML') return '';
      if (p === Symbol.toPrimitive || p === 'toString')
        return function () {
          return '';
        };
      return stub;
    },
    set: function () {
      return true;
    },
    apply: function () {
      return stub;
    },
    construct: function () {
      return stub;
    },
    has: function () {
      return true;
    }
  });
  var doc = new Proxy(
    {},
    {
      get: function (t, p) {
        if (p === 'getElementById' || p === 'querySelector' || p === 'querySelectorAll' || p === 'createElement' || p === 'getElementsByClassName' || p === 'getElementsByTagName')
          return function () {
            return stub;
          };
        if (p === 'documentElement' || p === 'head' || p === 'body') return stub;
        if (p === 'addEventListener' || p === 'removeEventListener') return function () {};
        if (p === 'cookie') return '';
        return stub;
      },
      set: function () {
        return true;
      },
      has: function () {
        return true;
      }
    }
  );
  self.document = doc;
  self.window = self; // integrator-dsp / oxydex use window.* unguarded in spots
  if (typeof self.navigator === 'undefined') self.navigator = { userAgent: 'cohort-worker' };
  self.localStorage = {
    getItem: function () {
      return null;
    },
    setItem: function () {},
    removeItem: function () {}
  };
  self.matchMedia = function () {
    return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {} };
  };
})();

var KIND = null,
  READY = false;

function kern() {
  return self.DexKernel ? { hash: DexKernel.HASH, version: DexKernel.VERSION } : null;
}
function firstFinite(o) {
  if (o == null) return null;
  if (typeof o === 'number' && isFinite(o)) return o;
  if (typeof o === 'object') {
    for (var k in o) {
      var v = firstFinite(o[k]);
      if (v != null) return v;
    }
  }
  return null;
}

var SCRIPTS = {
  oxy: ['synth-gen.js', 'cohort-gen.js', 'kernel-constants.js', 'clock.js', 'oxydex-util.js', 'oxydex-profile.js', 'oxydex-dsp.js'],
  // lean RR→rMSSD only (no gluco/cpap/hrv) — for analyses that need PulseDex alone (near-linear scaling).
  pulse: ['synth-gen.js', 'cohort-gen.js', 'kernel-constants.js', 'clock.js', 'pulsedex-dsp.js'],
  // lean PulseDex + GlucoDex (coexist; no oxydex collision). cgmcouple = rMSSD/night + nocturnal-slice
  // glucose/night; iccpg = rMSSD/night + per-day CV. Windowing done in-worker for parallelism.
  cgmcouple: ['synth-gen.js', 'cohort-gen.js', 'kernel-constants.js', 'clock.js', 'pulsedex-dsp.js', 'glucodex-dsp.js'],
  iccpg: ['synth-gen.js', 'cohort-gen.js', 'kernel-constants.js', 'clock.js', 'pulsedex-dsp.js', 'glucodex-dsp.js'],
  rrgluco: ['synth-gen.js', 'cohort-gen.js', 'kernel-constants.js', 'clock.js', 'pulsedex-dsp.js', 'glucodex-dsp.js', 'cpapdex-dsp.js', 'cpapdex-cross.js', 'cpapdex-registry.js', 'cpapdex-fusion.js'],
  // FULL lane (≤500): real 176 Hz PPG + raw-int16 ECG morphology on one ~9-min window.
  full: ['synth-gen.js', 'cohort-gen.js', 'cohort-full.js', 'kernel-constants.js', 'clock.js', 'ecgdex-morph.js', 'ecgdex-dsp.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']
};

/* ── ESM-MIGRATION: co-load DSPs that ship a top-level `export` (dual-mode ESM). A classic worker's
   importScripts() SyntaxErrors on a module-syntax file, so those DSPs must be shed to classic first.
   We importScripts every file as before (unchanged scoping for the plain-global helpers), and only
   on the "Unexpected token 'export'/'import'" failure do we fall back to fetch → DexBuild.classicify
   (the single classicify source, worker-safe) → eval. build-core.js is dependency-free and attaches
   DexBuild to `self`, so importScripts'ing it in the worker is safe. (Before this, cohort-worker's
   gluco/cpap KINDs silently broke the moment glucodex-dsp.js became a dual-mode ESM module.) ── */
var _dexBuildLoaded = false;
function loadScript(url) {
  try {
    importScripts(url);
  } catch (e) {
    /* @blob-strip:start — served-only ESM co-load fallback (fetch → classicify → eval).
       DEAD in the build-analysis blob: deps are pre-inlined and importScripts is a no-op stub
       that never throws — build-analysis.mjs strips this region from __WSRC so the offline
       tools carry no transport primitive (no-network static lens). */
    var msg = String((e && e.message) || e);
    if (!/\bexport\b|\bimport\b/.test(msg)) throw e; // a real error, not module syntax
    if (!_dexBuildLoaded) {
      importScripts('tools/build-core.js'); // classic, worker-safe → self.DexBuild.classicify
      _dexBuildLoaded = true;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // sync: preserve importScripts' ordering/timing
    xhr.send();
    if (xhr.status && xhr.status >= 400) throw new Error('cohort-worker: fetch ' + url + ' → ' + xhr.status);
    (0, eval)(self.DexBuild.classicify(xhr.responseText)); // indirect eval: worker-global scope
    /* @blob-strip:end */
  }
}

/* ── OxyDex: array-of-nights summary + per-night score ── */
function runOxy(p) {
  var slim = [],
    score = { nights: [] };
  p.nights.forEach(function (nt) {
    if (!(nt.present.OxyDex && nt.files.oxyCSV)) return;
    var rows = OxyDex._bare.parseCSV(nt.files.oxyCSV, {}); // REAL OxyDex parser
    if (!rows.length) {
      score.nights.push({ empty: true });
      return;
    }
    var night = OxyDex._bare.processNight(rows, 'cohort.csv'); // REAL full pipeline
    var st = night.stats || {};
    var dt = st.durationMin && rows.length ? (st.durationMin * 60000) / rows.length : 1000;
    var desat = night.desat || null;
    var devs = desat && Array.isArray(desat.events) ? desat.events : [];
    var detTMs = devs
      .filter(function (d) {
        return !d.artifact;
      })
      .map(function (d) {
        var idx = d.nadirIdx != null ? d.nadirIdx : d.startIdx;
        return idx != null && night.t0Ms != null ? night.t0Ms + idx * dt : null;
      })
      .filter(function (v) {
        return v != null;
      });
    slim.push({
      date: night.date,
      t0Ms: night.t0Ms,
      stats: { n: rows.length, durationMin: st.durationMin, minSpo2: st.minSpo2, meanSpo2: st.meanSpo2 },
      odi4: night.odi4 ? { rate: night.odi4.rate, count: night.odi4.count } : null,
      hb: night.hb ? { rate: night.hb.rate } : null,
      desatProfile: desat ? { events: devs } : null,
      stageProxy: night.stageProxy || null,
      kernel: kern()
    });
    score.nights.push({
      t0Ms: night.t0Ms,
      odi: night.odi4 ? night.odi4.rate : null,
      estAHI: firstFinite(night.ahiEst),
      minSpo2: st.minSpo2,
      durationMin: st.durationMin,
      nDesat: detTMs.length,
      detectedDesatTMs: detTMs
    });
  });
  if (!slim.length) return null;
  return { envelope: { schema: { name: 'ganglior.node-export', node: 'OxyDex' }, bus: 'ganglior', nights: slim }, score: score };
}

/* ── PulseDex per night ── */
function runPulse(nt) {
  var parsed = PulseDex._bare.parseRRInput(nt.files.rrText || '');
  var vals = parsed.vals || [];
  if (vals.length < 20) return null;
  var cl = PulseDex._bare.artifactClean(vals);
  var clean = cl.clean;
  var meanRR =
    clean.reduce(function (s, v) {
      return s + v;
    }, 0) / clean.length;
  var rm = PulseDex._bare.rmssd(clean),
    sd = PulseDex._bare.std(clean);
  var durMin =
    parsed.tsMs && parsed.tsMs.length
      ? (parsed.tsMs[parsed.tsMs.length - 1] - parsed.tsMs[0]) / 60000
      : clean.reduce(function (s, v) {
          return s + v;
        }, 0) / 60000;
  return {
    envelope: {
      schema: { name: 'ganglior.node-export', node: 'PulseDex' },
      bus: 'ganglior',
      recording: { startEpochMs: parsed.t0Ms, durationMin: +durMin.toFixed(1), offsetMin: parsed.offsetMin },
      hrv: { time: { rmssd: +rm.toFixed(1), sdnn: +sd.toFixed(1), meanRR: +meanRR.toFixed(1) } },
      quality: { analyzablePct: +(100 * (1 - cl.pct / 100)).toFixed(1) },
      kernel: kern(),
      ganglior_events: []
    },
    score: { n: nt.n, target: nt.cfg.rmssd, rmssd: +rm.toFixed(1), sdnn: +sd.toFixed(1), nBeats: vals.length, artifactPct: cl.pct, durationMin: +durMin.toFixed(1), t0Ms: parsed.t0Ms }
  };
}

/* ── GlucoDex (continuous) ── */
// Window-LOCAL nocturnal-hypo count, scored on the RAW slice values — ≥15-min run
// < 70 mg/dL. Deliberately independent of GlucoDex's cleaned series: the synthetic
// (and real) sharp nocturnal hypo + Somogyi rebound trips GlucoDex's compression-
// artifact rejection (bracketing drop→recovery looks like sensor-pressure), which
// flags those cells (f===3) and excludes them from the hypo flag — so reading the
// cleaned series recovers 0 even though glucose genuinely sat < 70. We measure the
// ground-truth dip directly (mirrors the Integrator timeBelow70 idea, minus the flag
// gate). Tradeoff on REAL data: higher hypo recall, but susceptible to true
// compression artifacts — acceptable for a recall-vs-planted-truth measurement.
function winHypoFromCSV(csv, cadenceMin) {
  if (!csv) return 0;
  var minCells = Math.max(2, Math.ceil(15 / (cadenceMin || 5)));
  var lines = csv.split(/\r?\n/),
    run = 0,
    episodes = 0;
  for (var i = 1; i < lines.length; i++) {
    // row 0 is the header
    var ln = lines[i];
    if (!ln.trim()) continue;
    var c = ln.indexOf(',');
    if (c < 0) continue;
    var v = parseFloat(ln.slice(c + 1)); // Measurement(mg/dL) is the 2nd column
    if (isFinite(v) && v < 70) {
      run++;
      if (run === minCells) episodes++;
    } else run = 0;
  }
  return episodes;
}
function runGluco(cgmCSV) {
  var parsed = GLUDSP.parseCSV(cgmCSV);
  var r = GLUDSP.analyze(parsed, null, {});
  var s = r.series || {},
    cells = [];
  if (s.gT && s.gV) for (var i = 0; i < s.N; i++) cells.push({ tMs: s.gT[i], v: s.gV[i], f: s.gF ? s.gF[i] : 0 });
  var winHypo = winHypoFromCSV(cgmCSV, r.cadence);
  var dawnSurge = (r.dawn && (r.dawn.medianRiseMgdl != null ? r.dawn.medianRiseMgdl : firstFinite(r.dawn))) || null;
  return {
    envelope: {
      schema: { name: 'ganglior.node-export', node: 'GlucoDex' },
      bus: 'ganglior',
      recording: { startEpochMs: r.t0Ms, durationMin: r.durMin },
      glycemic: { cv: r.cv, mean: r.mean, tir: r.tir ? r.tir.tir : null, gmi: r.gmi },
      dawn: { surge: dawnSurge },
      nocturnalHypo: (r.nocturnalHypo || []).map(function (e) {
        return { startMs: e.startMs, min: e.min, durMin: e.durMin };
      }),
      timeseries: { t0Ms: r.t0Ms, cadenceMin: r.cadence, cells: cells },
      kernel: kern(),
      ganglior_events: r.events || []
    },
    score: { cv: r.cv, mean: r.mean, gmi: r.gmi, nHypo: (r.nocturnalHypo || []).length, winHypo: winHypo, dawnSurge: dawnSurge, nReadings: r.nReadings, durDays: r.durDays }
  };
}

/* ── HRVDex (read the rendered Welltory rows → minimal envelope; real parse is DOM-bound) ── */
function parseHRVrows(csv) {
  var lines = csv.trim().split('\n'),
    hdr = lines[0].split(',');
  var iR = hdr.indexOf('rMSSD'),
    iS = hdr.indexOf('SDNN'),
    out = [];
  for (var i = 1; i < lines.length; i++) {
    var c = lines[i].split(',');
    if (c.length < 5) continue;
    out.push({ rmssd: parseFloat(c[iR]), sdnn: parseFloat(c[iS]) });
  }
  return out;
}

/* ── CPAPDex (headless): AHI-parameterized EDF set → session → night → cpapBuildExport ── */
function runCpap(night) {
  var set = CohortGen.buildCpapEdfSet(night, night._profile, (night._seed + night.n * 13) >>> 0);
  var sess = CpapDsp.buildSessionFromEdf(set, { fname: 'cohort-cpap' });
  if (!sess) return null;
  var nightObj = CpapDsp.buildNight([sess]);
  var env = CpapFusion.cpapBuildExport(nightObj); // REAL headless node-export
  var m = nightObj.metrics || {};
  return {
    envelope: env,
    score: {
      n: night.n,
      residualAHI: m.residualAHI,
      ahiTruth: night.cfg.ahi,
      therapyHours: nightObj.therapyHours,
      medianLeak: m.medianLeak,
      largeLeakPct: m.largeLeakPct,
      centralIndex: m.centralIndex,
      medianPressure: m.medianPressure,
      t0Ms: nightObj.t0Ms,
      nEvents: (env.ganglior_events || []).length
    }
  };
}

/* ── split a continuous CGM CSV into per-calendar-day CSVs (floating wall-clock prefix) ── */
function splitCgmByDay(csv) {
  var lines = (csv || '').split(/\r?\n/);
  if (lines.length < 3) return [];
  var header = lines[0],
    byDay = {};
  for (var i = 1; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln.trim()) continue;
    var comma = ln.indexOf(',');
    if (comma < 10) continue;
    var day = ln.slice(0, comma).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    (byDay[day] || (byDay[day] = [])).push(ln);
  }
  var out = [];
  Object.keys(byDay)
    .sort()
    .forEach(function (day) {
      var rows = byDay[day];
      if (rows.length < 200) return; // need ~16h of 5-min readings for a stable daily CV
      out.push({ day: day, n: rows.length, csv: header + '\n' + rows.join('\n') + '\n' });
    });
  return out;
}

/* ── slice the continuous CGM CSV to one night's sleep window [t0Ms, t0Ms+durSec] ──
   Clock Contract: regex the zoned-ISO stamp into FLOATING wall-clock ms (same frame as the
   night's t0Ms); never new Date(str). Glucose is 5-min cadence, seconds always 0. */
function glucoTsMs(s) {
  var m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
function sliceNocturnalCsv(csv, t0Ms, durSec) {
  var lines = (csv || '').split(/\r?\n/);
  if (lines.length < 3) return null;
  var header = lines[0],
    end = t0Ms + durSec * 1000,
    out = [header];
  for (var i = 1; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln.trim()) continue;
    var comma = ln.indexOf(',');
    if (comma < 10) continue;
    var ms = glucoTsMs(ln.slice(0, comma).trim());
    if (ms == null) continue;
    if (ms >= t0Ms && ms <= end) out.push(ln);
  }
  return out.length >= 13 ? out.join('\n') + '\n' : null; // need ≥~1 h of 5-min readings
}

function meta(p) {
  return { profile: p.profile, groundTruth: p.groundTruth };
}

/* ── FULL lane: real PPG (176 Hz) + ECG (raw int16) on one apnea-cluster window ── */
function runPPGfull(tl) {
  var win = SYNTH.pickWindow(tl);
  var text = SYNTH.renderPPG(tl, win); // REAL 176 Hz Polar Sense text
  var rec = PPGDSP.parsePPG(text); // REAL parser
  var r = PPGDSP.analyze(rec); // REAL morphology pipeline
  return {
    envelope: {
      schema: { name: 'ganglior.node-export', node: 'PpgDex' },
      bus: 'ganglior',
      recording: { startEpochMs: r.t0Ms, durationMin: r.durMin, offsetMin: r.offsetMin },
      hrv: { time: { rmssd: r.rmssd, sdnn: r.sdnn, meanRR: r.meanRR } },
      quality: { analyzablePct: r.analyzablePct, meanSQI: r.meanSQI },
      kernel: kern(),
      ganglior_events: r.events || []
    },
    score: { rmssd: r.rmssd, sdnn: r.sdnn, nPulses: r.nPulses, analyzablePct: r.analyzablePct, meanSQI: r.meanSQI, motionRejectedPct: r.motionRejectedPct, t0Ms: r.t0Ms, winStartRel: win.startRel }
  };
}
function runECGfull(tl) {
  var win = SYNTH.pickWindow(tl);
  var rec = CohortFull.renderECGInt16(tl, win, SYNTH); // RR→PQRST µV int16 @130 Hz
  if (!rec) return null;
  var r = ECGDSP.analyze(rec); // REAL Pan-Tompkins + HRV + CVHR
  // self-RR vs device-RR agreement (the built-in cross-check) if available
  var rrVal = null;
  try {
    rrVal = ECGDSP.validateRR(r.nn, rec.deviceRR);
  } catch (e) {}
  return {
    envelope: {
      schema: { name: 'ganglior.node-export', node: 'ECGDex' },
      bus: 'ganglior',
      recording: { startEpochMs: r.t0Ms, durationMin: r.durMin },
      hrv: { time: { rmssd: r.rmssd, sdnn: r.sdnn, lfhf: r.lfhf, wholeRecordSDNN: r.sdnn, wholeRecordRMSSD: r.rmssd } },
      apnea: r.cvhr ? { cvhrIndex: r.cvhr.index, nEvents: (r.cvhr.events || []).length } : null,
      sleep: { stageMinutes: r.stageMin || null },
      kernel: kern(),
      ganglior_events: r.events || []
    },
    score: {
      rmssd: r.rmssd,
      sdnn: r.sdnn,
      lfhf: r.lfhf,
      nBeats: r.nBeats,
      meanSQI: r.meanSQI,
      analyzablePct: r.analyzablePct,
      cvhrIndex: r.cvhr ? r.cvhr.index : null,
      nBeatsTrue: rec.deviceRR.length,
      rrMismatchPct: rrVal ? rrVal.dRMSSD : null,
      detVsTrue: rec.deviceRR.length ? +(r.nBeats / rec.deviceRR.length).toFixed(3) : null,
      t0Ms: r.t0Ms,
      winStartRel: win.startRel
    }
  };
}

function doJob(seed) {
  var t = { oxy: 0, pulse: 0, gluco: 0, gen: 0, ecg: 0, ppg: 0, cpap: 0 };
  var g0 = performance.now();
  if (KIND === 'full') {
    // FULL: one apnea-cluster window per patient, on the FIRST night present for that node.
    var pf = CohortGen.patient(seed, { only: [], attachTimelines: true });
    t.gen = +(performance.now() - g0).toFixed(2);
    var ecg = null,
      ppg = null,
      errs = {};
    var ecgNight = pf.nights.find(function (nt) {
      return nt.present.ECGDex && nt.tl;
    });
    var ppgNight = pf.nights.find(function (nt) {
      return (nt.present.ECGDex || nt.present.PulseDex) && nt.tl;
    });
    if (ecgNight) {
      var te = performance.now();
      try {
        ecg = runECGfull(ecgNight.tl);
      } catch (e) {
        errs.ECGDex = String((e && e.message) || e);
      }
      t.ecg = +(performance.now() - te).toFixed(2);
    }
    if (ppgNight) {
      var tpp = performance.now();
      try {
        ppg = runPPGfull(ppgNight.tl);
      } catch (e) {
        errs.PpgDex = String((e && e.message) || e);
      }
      t.ppg = +(performance.now() - tpp).toFixed(2);
    }
    return { meta: meta(pf), ecg: ecg, ppg: ppg, errors: errs, timing: t };
  }
  if (KIND === 'pulse') {
    // lean: render RR only, score rMSSD per night, nothing else → ~linear worker scaling.
    var pp = CohortGen.patient(seed, { only: ['rr'] });
    t.gen = +(performance.now() - g0).toFixed(2);
    var pulseOnly = [],
      tpz = performance.now();
    pp.nights.forEach(function (nt) {
      if (!(nt.present.PulseDex && nt.files.rrText)) return;
      var r = runPulse(nt);
      if (r) pulseOnly.push(r);
    });
    t.pulse = +(performance.now() - tpz).toFixed(2);
    return { meta: meta(pp), pulse: pulseOnly, timing: t };
  }
  if (KIND === 'iccpg') {
    // lean: per-night rMSSD (PulseDex) + per-day CGM-CV (GlucoDex day-split), for nights-icc.
    var pi = CohortGen.patient(seed, { only: ['rr', 'gluco'] });
    t.gen = +(performance.now() - g0).toFixed(2);
    var pulseI = [],
      tpi = performance.now();
    pi.nights.forEach(function (nt) {
      if (!(nt.present.PulseDex && nt.files.rrText)) return;
      var r = runPulse(nt);
      if (r) pulseI.push(r);
    });
    t.pulse = +(performance.now() - tpi).toFixed(2);
    var perDay = [],
      tgi = performance.now();
    if (pi.files.glucoCSV) {
      splitCgmByDay(pi.files.glucoCSV).forEach(function (d) {
        try {
          var rg = runGluco(d.csv);
          if (rg && rg.score && rg.score.cv != null && isFinite(rg.score.cv)) perDay.push({ day: d.day, cv: rg.score.cv, mean: rg.score.mean });
        } catch (e) {}
      });
    }
    t.gluco = +(performance.now() - tgi).toFixed(2);
    return { meta: meta(pi), pulse: pulseI, perDay: perDay, timing: t };
  }
  if (KIND === 'cgmcouple') {
    // lean: per-night rMSSD (PulseDex) + per-night NOCTURNAL glucose (GlucoDex on the
    // [t0,t0+dur] sleep-window slice of the continuous CGM stream), for cgm-hrv-coupling.
    var pc = CohortGen.patient(seed, { only: ['rr', 'gluco'] });
    t.gen = +(performance.now() - g0).toFixed(2);
    var gtByN = {};
    ((pc.groundTruth && pc.groundTruth.nights) || []).forEach(function (gn) {
      gtByN[gn.n] = gn;
    });
    var pulseC = [],
      nocturnal = [],
      tcz = performance.now();
    pc.nights.forEach(function (nt) {
      if (!(nt.present.PulseDex && nt.files.rrText)) return;
      var rp = runPulse(nt);
      if (!rp) return;
      var gn = gtByN[nt.n];
      if (!gn || gn.t0Ms == null) {
        pulseC.push(rp);
        return;
      }
      var sub = pc.files.glucoCSV ? sliceNocturnalCsv(pc.files.glucoCSV, gn.t0Ms, nt.cfg.durSec) : null;
      if (!sub) return; // require BOTH rMSSD and a nocturnal glucose slice for a coupling row
      try {
        var rg = runGluco(sub);
        if (rg && rg.score && rg.score.mean != null && isFinite(rg.score.mean)) {
          pulseC.push(rp);
          nocturnal.push({ n: nt.n, score: { mean: rg.score.mean, cv: rg.score.cv, nHypo: rg.score.nHypo || 0, winHypo: rg.score.winHypo || 0, dawnSurge: rg.score.dawnSurge } });
        }
      } catch (e) {}
    });
    t.gluco = +(performance.now() - tcz).toFixed(2);
    return { meta: meta(pc), pulse: pulseC, nocturnal: nocturnal, timing: t };
  }
  if (KIND === 'oxy') {
    var p = CohortGen.patient(seed, { only: ['oxy'] });
    t.gen = +(performance.now() - g0).toFixed(2);
    var t0 = performance.now();
    var oxy = runOxy(p);
    t.oxy = +(performance.now() - t0).toFixed(2);
    return { meta: meta(p), oxy: oxy, timing: t };
  } else {
    var p2 = CohortGen.patient(seed, { only: ['rr', 'gluco', 'hrv'] });
    t.gen = +(performance.now() - g0).toFixed(2);
    var pulse = [],
      tp = performance.now();
    p2.nights.forEach(function (nt) {
      if (!(nt.present.PulseDex && nt.files.rrText)) return;
      var r = runPulse(nt);
      if (r) pulse.push(r);
    });
    t.pulse = +(performance.now() - tp).toFixed(2);
    var gluco = null;
    if (p2.files.glucoCSV) {
      var tg = performance.now();
      try {
        gluco = runGluco(p2.files.glucoCSV);
      } catch (e) {
        gluco = { error: String((e && e.message) || e) };
      }
      t.gluco = +(performance.now() - tg).toFixed(2);
    }
    var hrv = [];
    if (p2.files.hrvCSV) {
      var rows = parseHRVrows(p2.files.hrvCSV);
      p2.nights.forEach(function (nt, i) {
        var row = rows[i];
        if (!row) return;
        hrv.push({
          n: nt.n,
          rmssd: row.rmssd,
          sdnn: row.sdnn,
          target: nt.cfg.rmssd,
          t0Ms: nt.groundTruth.t0Ms,
          durMin: +(nt.cfg.durSec / 60).toFixed(1)
        });
      });
    }
    // CPAPDex: only nights the patient is actually on therapy (cfg.cpap)
    var cpap = [],
      tc = performance.now();
    p2.nights.forEach(function (nt) {
      if (!nt.cfg.cpap) return;
      nt._profile = p2.profile;
      nt._seed = seed;
      try {
        var rc = runCpap(nt);
        if (rc) cpap.push(rc);
      } catch (e) {
        cpap.push({ error: String((e && e.message) || e), n: nt.n });
      }
    });
    t.cpap = +(performance.now() - tc).toFixed(2);
    return { meta: meta(p2), pulse: pulse, gluco: gluco, hrv: hrv, cpap: cpap, timing: t };
  }
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'init') {
    KIND = m.kind;
    try {
      // ESM-MIGRATION-FOLLOWUPS-II items 1-2: run this worker realm NAMESPACED so the co-loaded DSPs
      // expose only their <Node>/<Node>._bare surfaces (no bare-global spray). The few helpers this
      // worker uses are pulled explicitly from the right namespace at their call sites below — which
      // also removes the old last-load-wins collision on parseCSV/mean/std across the stacked DSPs.
      self.__DEX_NAMESPACED__ = true;
      SCRIPTS[KIND].forEach(loadScript);
      READY = true;
      self.postMessage({ type: 'ready', kind: KIND });
    } catch (err) {
      self.postMessage({ type: 'ready', kind: KIND, err: String((err && err.message) || err) });
    }
    return;
  }
  if (m.type === 'job') {
    if (!READY) {
      self.postMessage({ type: 'done', reqId: m.reqId, kind: KIND, error: 'not ready' });
      return;
    }
    var t0 = performance.now();
    try {
      var res = doJob(m.seed >>> 0);
      self.postMessage({ type: 'done', reqId: m.reqId, kind: KIND, result: res, wallMs: +(performance.now() - t0).toFixed(2) });
    } catch (err) {
      self.postMessage({ type: 'done', reqId: m.reqId, kind: KIND, error: String((err && err.message) || err), wallMs: +(performance.now() - t0).toFixed(2) });
    }
  }
};
