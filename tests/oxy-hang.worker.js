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

/* ── ESM-MIGRATION deep-3: oxydex-dsp.js is a dual-mode ES module (top-level `export`), which a
   classic worker's importScripts() SyntaxErrors on. Same bridge as the five analysis workers:
   importScripts first, and only on the module-syntax failure fall back to fetch →
   DexBuild.classicify → eval (build-core.js is dependency-free and worker-safe). ── */
var _dexBuildLoaded = false;
function loadScript(url) {
  try {
    importScripts(url);
  } catch (e) {
    /* @blob-strip:start — served-only ESM co-load fallback (fetch → classicify → eval).
       DEAD in a build-analysis blob (deps pre-inlined, importScripts a no-op stub) — kept
       marker-wrapped for consistency with the five analysis workers, though this test-only
       worker is never inlined into an offline tool. */
    var msg = String((e && e.message) || e);
    if (!/\bexport\b|\bimport\b/.test(msg)) throw e; // a real error, not module syntax
    if (!_dexBuildLoaded) {
      importScripts('../tools/build-core.js'); // classic, worker-safe → self.DexBuild.classicify
      _dexBuildLoaded = true;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // sync: preserve importScripts' ordering/timing
    xhr.send();
    if (xhr.status && xhr.status >= 400) throw new Error('oxy-hang.worker: fetch ' + url + ' → ' + xhr.status);
    (0, eval)(self.DexBuild.classicify(xhr.responseText)); // indirect eval: worker-global scope
    /* @blob-strip:end */
  }
}

var READY = false,
  ERR = null;
try {
  // ESM-MIGRATION-FOLLOWUPS-II items 1-2: run NAMESPACED (the bare-global spray is gone). The OxyDex
  // helpers are pulled from OxyDex._bare below; CohortGen is cohort-gen.js's own global (not a DSP spray).
  self.__DEX_NAMESPACED__ = true;
  ['../kernel-constants.js', '../clock.js', '../oxydex-util.js', '../oxydex-profile.js', '../oxydex-dsp.js', '../synth-gen.js', '../cohort-gen.js'].forEach(loadScript);
  READY = !!(self.OxyDex && self.OxyDex._bare && self.OxyDex._bare.processNight && self.OxyDex._bare.parseCSV && self.CohortGen);
  if (!READY) ERR = 'modules missing after load (OxyDex._bare.processNight/parseCSV, CohortGen)';
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
        var rows = OxyDex._bare.parseCSV(csv, {}); // REAL parser (strips --,--,0 rows)
        if (rows.length) OxyDex._bare.processNight(rows, 'hang-probe.csv'); // REAL full pipeline
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
