/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   qrs-equiv-worker.js — FULL-lane realm for the three-way rMSSD equivalence tool
   (papers/rmssd-equivalence.html). Loaded ONLY by qrs-equiv-analysis.js. Same DOM
   shim + script set as cohort-worker.js's full lane (synth-gen + cohort-gen +
   cohort-full + the REAL ECGDex/PpgDex pipelines). Read-only — never edits a shipped
   DSP, so the regression + provenance gates are untouched.

   For each patient (seed) it takes ONE ~9-min apnea-cluster window of one cardiac
   night and measures rMSSD three ways on the SAME underlying beats:
     · ECGDex — CohortFull.renderECGInt16 → ECGDSP.analyze.rmssd  (raw int16 @130 Hz,
       R-peaks now rendered at their true beat times, so timing is faithful)
     · PpgDex — SYNTH.renderPPG → PPGDSP.analyze.rmssd            (optical pulse @176 Hz)
   and emits the window's ground-truth RR as a bare-number list (rrText) so the main
   thread can score it through the REAL PulseDex in its own realm:
     · PulseDex — parseRRInput → artifactClean → rmssd            (RR text; the reference)
   PulseDex reads the true RR, so it is the reference; ECG carries 130 Hz sampling +
   Pan-Tompkins detection; PPG additionally carries pulse-arrival-time jitter + 176 Hz
   + optical detection. Differences therefore isolate sampling/detector vs PAT jitter.

   Clock Contract: every time is floating wall-clock ms from the timeline. 100% local.
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

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
  self.window = self;
  if (typeof self.navigator === 'undefined') self.navigator = { userAgent: 'qrs-equiv-worker' };
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

var SCRIPTS = ['synth-gen.js', 'cohort-gen.js', 'cohort-full.js', 'kernel-constants.js', 'clock.js', 'ecgdex-morph.js', 'ecgdex-dsp.js', 'ppgdex-morph.js', 'ppgdex-dsp.js'];
// ESM-MIGRATION: importScripts SyntaxErrors on a dual-mode DSP's top-level `export`; fall back to
// fetch → DexBuild.classicify → eval (build-core.js is worker-safe). No-op on classic files.
var _dexBuildLoaded = false;
function loadScript(url) {
  try {
    importScripts(url);
  } catch (e) {
    if (!/\bexport\b|\bimport\b/.test(String((e && e.message) || e))) throw e;
    if (!_dexBuildLoaded) {
      importScripts('tools/build-core.js');
      _dexBuildLoaded = true;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status && xhr.status >= 400) throw new Error('qrs-equiv-worker: fetch ' + url + ' → ' + xhr.status);
    (0, eval)(self.DexBuild.classicify(xhr.responseText));
  }
}
var READY = false;

function doJob(seed) {
  var pf = CohortGen.patient(seed, { only: [], attachTimelines: true });
  var night = null;
  for (var i = 0; i < pf.nights.length; i++) {
    var nt = pf.nights[i];
    if ((nt.present.ECGDex || nt.present.PulseDex) && nt.tl) {
      night = nt;
      break;
    }
  }
  if (!night) return { seed: seed, skip: true };
  var tl = night.tl,
    win = SYNTH.pickWindow(tl);
  var t0Win = tl.t0Ms + win.startRel * 1000,
    t1Win = t0Win + win.lenSec * 1000;
  var errs = {};

  // ground-truth RR in the window → bare-number list for the real PulseDex (reference)
  var beats = SYNTH.buildRR(tl).filter(function (b) {
    return b.tMs >= t0Win && b.tMs <= t1Win;
  });
  var rrText =
    beats
      .map(function (b) {
        return b.rr;
      })
      .join('\n') + '\n';

  // ECGDex (faithful R timing now) — node-reported rMSSD
  var ecgRmssd = null;
  try {
    var rec = CohortFull.renderECGInt16(tl, win, SYNTH);
    if (rec) {
      var er = ECGDSP.analyze(rec);
      ecgRmssd = er.rmssd != null ? er.rmssd : null;
    }
  } catch (e) {
    errs.ECG = String((e && e.message) || e);
  }

  // PpgDex — node-reported rMSSD
  var ppgRmssd = null;
  try {
    var pr = PPGDSP.analyze(PPGDSP.parsePPG(SYNTH.renderPPG(tl, win)));
    ppgRmssd = pr.rmssd != null ? pr.rmssd : null;
  } catch (e) {
    errs.PPG = String((e && e.message) || e);
  }

  return { seed: seed, ahi: tl.cfg.ahi, cpap: !!tl.cfg.cpap, nBeats: beats.length, ecgRmssd: ecgRmssd, ppgRmssd: ppgRmssd, rrText: rrText, errors: errs };
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'init') {
    try {
      SCRIPTS.forEach(loadScript);
      READY = true;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'ready', err: String((err && err.message) || err) });
    }
    return;
  }
  if (m.type === 'job') {
    if (!READY) {
      self.postMessage({ type: 'done', reqId: m.reqId, error: 'not ready' });
      return;
    }
    try {
      self.postMessage({ type: 'done', reqId: m.reqId, result: doJob(m.seed >>> 0) });
    } catch (err) {
      self.postMessage({ type: 'done', reqId: m.reqId, error: String((err && err.message) || err) });
    }
  }
};
