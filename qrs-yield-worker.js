/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   qrs-yield-worker.js — FULL-lane beat-yield realm for the QRS-yield analysis tool
   (papers/qrs-yield.html). Loaded ONLY by qrs-yield-analysis.js. Mirrors the FULL
   lane of cohort-worker.js: same DOM shim, same script set (synth-gen + cohort-gen
   + cohort-full + the REAL ECGDex/PpgDex morphology pipelines), same one-window-per
   -patient round-trip — but instead of returning the aggregate node envelope it
   matches DETECTED beats against the SYNTHETIC GROUND-TRUTH beats per window and
   stratifies recall (yield) by apnea state, plus the SQI that the detector reports
   for those same beats and the downstream rMSSD bias. Read-only: it never edits a
   shipped DSP (so the regression + provenance gates are untouched).

   For each patient (seed):
     · ECG arm — CohortFull.renderECGInt16(tl,win) → ECGDSP.analyze → refined R-peak
       times + per-beat SQI; truth = rec.deviceRR (the SAME master-timeline RR beats).
     · PPG arm — SYNTH.renderPPG(tl,win) → PPGDSP.parsePPG → PPGDSP.analyze → pulse
       foot times + per-beat SQI; truth = SYNTH.buildRR(tl) inside the window.
   Matching is PAT-corrected (median detected−true lag) so the PPG pulse-arrival
   delay doesn't read as a miss; tolerance ±120 ms. Apnea label per beat is the
   master timeline's own apnea/hypopnea event windows (the perfusion driver).

   Clock Contract: every time is the floating wall-clock from the timeline. 100% local.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── permissive DOM / window shim (load-time only; the math is DOM-free) — mirrors cohort-worker ── */
(function installDomShim() {
  var stub = new Proxy(function () {}, {
    get: function (t, p) { if (p === 'outerHTML' || p === 'innerHTML') return ''; if (p === Symbol.toPrimitive || p === 'toString') return function () { return ''; }; return stub; },
    set: function () { return true; },
    apply: function () { return stub; },
    construct: function () { return stub; },
    has: function () { return true; },
  });
  var doc = new Proxy({}, {
    get: function (t, p) {
      if (p === 'getElementById' || p === 'querySelector' || p === 'querySelectorAll' || p === 'createElement' || p === 'getElementsByClassName' || p === 'getElementsByTagName') return function () { return stub; };
      if (p === 'documentElement' || p === 'head' || p === 'body') return stub;
      if (p === 'addEventListener' || p === 'removeEventListener') return function () {};
      if (p === 'cookie') return '';
      return stub;
    },
    set: function () { return true; },
    has: function () { return true; },
  });
  self.document = doc;
  self.window = self;
  if (typeof self.navigator === 'undefined') self.navigator = { userAgent: 'qrs-yield-worker' };
  self.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  self.matchMedia = function () { return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {} }; };
})();

var SCRIPTS = ['synth-gen.js', 'cohort-gen.js', 'cohort-full.js', 'kernel-constants.js',
               'ecgdex-morph.js', 'ecgdex-dsp.js', 'ppgdex-morph.js', 'ppgdex-dsp.js'];
var READY = false;
var TOL = 0.120;   // beat-match tolerance (s) after PAT lag correction

// ── helpers ──
function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function rmssdOf(rr) { if (!rr || rr.length < 3) return null; var s = 0, c = 0; for (var i = 1; i < rr.length; i++) { var d = rr[i] - rr[i - 1]; s += d * d; c++; } return c ? Math.sqrt(s / c) : null; }
// clean a true RR series the way the detectors do (clip + local-median outlier replace) so the
// "true rMSSD" is a fair reference, not inflated by the planted ectopics the detector also corrects.
function cleanRR(raw) {
  var rr = raw.slice();
  for (var i = 0; i < raw.length; i++) {
    var lo = Math.max(0, i - 5), hi = Math.min(raw.length, i + 6), seg = [];
    for (var j = lo; j < hi; j++) if (j !== i) seg.push(raw[j]);
    seg.sort(function (a, b) { return a - b; });
    var med = seg[seg.length >> 1] || raw[i];
    if (raw[i] < 300 || raw[i] > 2200 || (med && Math.abs(raw[i] - med) / med > 0.20)) rr[i] = med;
  }
  return rr;
}
function apneaAt(tl, relSec) {
  for (var i = 0; i < tl.events.length; i++) {
    var e = tl.events[i];
    if (relSec >= e.relSec && relSec < e.relSec + e.durSec) return true;
  }
  return false;
}
// rMSSD reconstructed from a beat-time series (sec), the SAME way for true and detected, so the
// detected−true difference isolates the YIELD effect (missed / extra beats) — NOT the detector's
// internal gating/interpolation policy (which deflates rMSSD independently of yield). Times → RR
// (ms) → local-median outlier clean → rMSSD.
function rmssdFromTimes(timesSec) {
  if (!timesSec || timesSec.length < 4) return null;
  var t = timesSec.slice().sort(function (a, b) { return a - b; });
  var rr = [];
  for (var i = 1; i < t.length; i++) { var d = (t[i] - t[i - 1]) * 1000; if (d > 200 && d < 3000) rr.push(d); }
  return rmssdOf(cleanRR(rr));
}

// Core matcher: truth beats (window-relative sec + apnea flag) vs detected beats
// (window-relative sec + per-beat SQI + night-relative sec for apnea labelling).
function matchWindow(truth, det, winStartRel, tl) {
  // 1) PAT/lag = median(detected − nearest true)
  var deltas = [];
  for (var k = 0; k < det.t.length; k++) {
    var best = Infinity;
    for (var i = 0; i < truth.t.length; i++) { var d = det.t[k] - truth.t[i]; if (Math.abs(d) < Math.abs(best)) best = d; }
    if (isFinite(best)) deltas.push(best);
  }
  var lag = deltas.length ? median(deltas) : 0;

  // 2) recall — for each true beat, is there a detected beat within TOL of (true + lag)?
  var rec = { apnea: { tot: 0, hit: 0 }, clean: { tot: 0, hit: 0 } };
  for (var i = 0; i < truth.t.length; i++) {
    var ti = truth.t[i], hit = false;
    for (var k = 0; k < det.t.length; k++) { if (Math.abs(det.t[k] - ti - lag) <= TOL) { hit = true; break; } }
    var b = truth.apnea[i] ? rec.apnea : rec.clean; b.tot++; if (hit) b.hit++;
  }

  // 3) precision + SQI stratified by apnea (apnea label of the detected beat's instant)
  var prec = { tot: 0, hit: 0 };
  var sqiApnea = { sum: 0, n: 0 }, sqiClean = { sum: 0, n: 0 };
  for (var k = 0; k < det.t.length; k++) {
    var dk = det.t[k], m = false;
    for (var i = 0; i < truth.t.length; i++) { if (Math.abs(dk - truth.t[i] - lag) <= TOL) { m = true; break; } }
    prec.tot++; if (m) prec.hit++;
    var inAp = apneaAt(tl, winStartRel + dk);
    var sv = det.sqi[k];
    if (sv != null && isFinite(sv)) { if (inAp) { sqiApnea.sum += sv; sqiApnea.n++; } else { sqiClean.sum += sv; sqiClean.n++; } }
  }
  return { recall: rec, prec: prec, sqiApnea: sqiApnea, sqiClean: sqiClean, lagMs: Math.round(lag * 1000) };
}

// ── ECG arm ──
function ecgWindow(tl) {
  var win = SYNTH.pickWindow(tl);
  var rec = CohortFull.renderECGInt16(tl, win, SYNTH);
  if (!rec) return null;
  var r = ECGDSP.analyze(rec);
  // truth: deviceRR beats inside the window (deviceRR carries +/-2 s guard → clamp)
  var lenSec = win.lenSec, tT = [], tA = [], rrTrue = [];
  for (var i = 0; i < rec.deviceRR.length; i++) {
    var b = rec.deviceRR[i];
    var relWin = (b.tsMs - rec.t0Ms) / 1000;
    if (relWin < 0 || relWin > lenSec) continue;
    tT.push(relWin); tA.push(apneaAt(tl, win.startRel + relWin)); rrTrue.push(b.rr);
  }
  var truth = { t: tT, apnea: tA };
  var det = { t: (r.times || []).slice(), sqi: (r.sqi || []).slice() };
  var mw = matchWindow(truth, det, win.startRel, tl);
  return {
    arm: 'ECG', ahi: tl.cfg.ahi, cpap: !!tl.cfg.cpap,
    recall: mw.recall, prec: mw.prec, sqiApnea: mw.sqiApnea, sqiClean: mw.sqiClean,
    nTrue: tT.length, nDet: det.t.length, lagMs: mw.lagMs,
    rmssdTrue: rmssdFromTimes(tT), rmssdDet: rmssdFromTimes(det.t),
    rmssdNode: (r.rmssd != null ? r.rmssd : null),
    meanSQI: (r.meanSQI != null ? r.meanSQI : null),
  };
}

// ── PPG arm ──
function ppgWindow(tl) {
  var win = SYNTH.pickWindow(tl);
  var text = SYNTH.renderPPG(tl, win);
  var rec = PPGDSP.parsePPG(text);
  var r = PPGDSP.analyze(rec);
  var t0Win = tl.t0Ms + win.startRel * 1000, lenSec = win.lenSec;
  var all = SYNTH.buildRR(tl), tT = [], tA = [], rrTrue = [], prevMs = null;
  for (var i = 0; i < all.length; i++) {
    var b = all[i];
    var relWin = (b.tMs - t0Win) / 1000;
    if (relWin < 0 || relWin > lenSec) continue;
    tT.push(relWin); tA.push(apneaAt(tl, win.startRel + relWin));
    if (prevMs != null) rrTrue.push(b.tMs - prevMs); prevMs = b.tMs;
  }
  var truth = { t: tT, apnea: tA };
  var det = { t: (r.beatTimes || []).filter(function (v) { return v != null; }), sqi: (r.sqi || []).slice() };
  // beatTimes/sqi are index-aligned to det.peaks; keep only the aligned, finite-time pairs
  var dt = [], ds = [];
  for (var k = 0; k < (r.beatTimes || []).length; k++) { if (r.beatTimes[k] != null && isFinite(r.beatTimes[k])) { dt.push(r.beatTimes[k]); ds.push(r.sqi ? r.sqi[k] : null); } }
  det = { t: dt, sqi: ds };
  var mw = matchWindow(truth, det, win.startRel, tl);
  return {
    arm: 'PPG', ahi: tl.cfg.ahi, cpap: !!tl.cfg.cpap,
    recall: mw.recall, prec: mw.prec, sqiApnea: mw.sqiApnea, sqiClean: mw.sqiClean,
    nTrue: tT.length, nDet: det.t.length, lagMs: mw.lagMs,
    rmssdTrue: rmssdFromTimes(tT), rmssdDet: rmssdFromTimes(det.t),
    rmssdNode: (r.rmssd != null ? r.rmssd : null),
    meanSQI: (r.meanSQI != null ? r.meanSQI : null),
  };
}

function doJob(seed) {
  var pf = CohortGen.patient(seed, { only: [], attachTimelines: true });
  var ecgNight = pf.nights.find(function (nt) { return nt.present.ECGDex && nt.tl; });
  var ppgNight = pf.nights.find(function (nt) { return (nt.present.ECGDex || nt.present.PulseDex) && nt.tl; });
  var ecg = null, ppg = null, errs = {};
  if (ecgNight) { try { ecg = ecgWindow(ecgNight.tl); } catch (e) { errs.ECG = String(e && e.message || e); } }
  if (ppgNight) { try { ppg = ppgWindow(ppgNight.tl); } catch (e) { errs.PPG = String(e && e.message || e); } }
  return {
    seed: seed, age: pf.profile.age, sev: pf.profile.osaSeverity, baseAHI: pf.profile.baseAHI,
    ecg: ecg, ppg: ppg, errors: errs,
  };
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'init') {
    try { importScripts.apply(self, SCRIPTS); READY = true; self.postMessage({ type: 'ready' }); }
    catch (err) { self.postMessage({ type: 'ready', err: String(err && err.message || err) }); }
    return;
  }
  if (m.type === 'job') {
    if (!READY) { self.postMessage({ type: 'done', reqId: m.reqId, error: 'not ready' }); return; }
    var t0 = performance.now();
    try { var res = doJob(m.seed >>> 0); self.postMessage({ type: 'done', reqId: m.reqId, result: res, wallMs: +(performance.now() - t0).toFixed(2) }); }
    catch (err) { self.postMessage({ type: 'done', reqId: m.reqId, error: String(err && err.message || err) }); }
  }
};
