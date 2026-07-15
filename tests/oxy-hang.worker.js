/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   tests/oxy-hang.worker.js — bounded re-creation of the "OxyDex processNight hang
   on heavy-dropout nights" scenario, in its own realm so a hang cannot freeze the
   test suite's main thread (the whole point — a same-thread infinite loop would
   wedge the page; a Worker can be watchdog-timed out).

   Loads the REAL OxyDex DSP stack + the cohort generator, bootstraps a small pool
   of HEAVY-DROPOUT patients (the exact situation that surfaced the original hang —
   `--,--,0` finger-off/contact-loss spans injected by cohort-gen's injectDropout),
   and runs each night through the real parseCSV → processNight pipeline. Posts
   {done, nNights, maxMs, totalMs}. If processNight ever fails to terminate, this
   worker simply never posts `done` and the harness's watchdog flags the hang.
   100% local. No DOM (permissive shim installed before importScripts).
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

/* permissive DOM/window shim — oxydex-dsp binds #uploadArea / reads documentElement at load */
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
  if (typeof self.navigator === 'undefined') self.navigator = { userAgent: 'oxy-hang-worker' };
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

var READY = false,
  ERR = null;
try {
  importScripts('../kernel-constants.js', '../clock.js', '../oxydex-util.js', '../oxydex-profile.js', '../oxydex-dsp.js', '../synth-gen.js', '../cohort-gen.js');
  READY = !!(self.processNight && self.parseCSV && self.CohortGen);
  if (!READY) ERR = 'modules missing after load (processNight/parseCSV/CohortGen)';
} catch (e) {
  ERR = String((e && e.message) || e);
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type !== 'run') return;
  if (!READY) {
    self.postMessage({ type: 'error', error: ERR || 'not ready' });
    return;
  }
  var nPatients = m.nPatients || 24;
  var targetNights = m.targetNights || 15;
  var nNights = 0,
    maxMs = 0,
    total0 = performance.now(),
    worstSeed = -1;
  try {
    for (var seed = 0; seed < nPatients * 8 && nNights < targetNights; seed++) {
      var pf;
      try {
        pf = CohortGen.patient(seed, { only: ['oxy'] });
      } catch (_) {
        continue;
      }
      // prefer patients with real injected dropout (artifactLevel high) — the hang trigger
      if (!(pf.profile.artifactLevel > 0.08)) continue;
      for (var k = 0; k < pf.nights.length; k++) {
        var csv = pf.nights[k].files && pf.nights[k].files.oxyCSV;
        if (!csv) continue;
        var t0 = performance.now();
        var rows = parseCSV(csv, {}); // REAL parser (strips --,--,0 rows)
        if (rows.length) processNight(rows, 'hang-probe.csv'); // REAL full pipeline
        var dt = performance.now() - t0;
        if (dt > maxMs) {
          maxMs = dt;
          worstSeed = seed;
        }
        nNights++;
        if (nNights >= targetNights) break;
      }
    }
    self.postMessage({ type: 'done', nNights: nNights, maxMs: +maxMs.toFixed(1), totalMs: +(performance.now() - total0).toFixed(1), worstSeed: worstSeed });
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err && err.message) || err), nNights: nNights });
  }
};
