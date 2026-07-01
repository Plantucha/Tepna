/*
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 *   dex-patient-gen.js — shared "Generate synthetic" helper.
 *   ----------------------------------------------------------------------------
 *   ONE coherence contract for every node's in-app generator. The button in each
 *   app renders ITS OWN modality from the SAME seeded patient, so the multi-day
 *   record is consistent across OxyDex / PulseDex / PpgDex / HRVDex (same nightly
 *   t0Ms, same physiology) and fuses in the Integrator. Pure delegation to
 *   window.SYNTH (synth-gen.js); no DOM, no per-node synthesizer. Clock-Contract
 *   clean by construction (SYNTH stores floating wall-clock tMs).
 *
 *   The generator axis is DAYS, not patients: one fixed patient, N consecutive
 *   nights. Profile sets the nightly physiology; each night is a deterministic
 *   seeded draw around that profile (so day 1..N vary realistically but the
 *   patient is the same person). Nights use gluc:'flat' and n>=100 to steer clear
 *   of the corpus's date-locked CSR / hypo / dawn scripting (those belong to the
 *   frozen 5-night arc, not a generic multi-day record).
 */
(function (global) {
  'use strict';

  // profile id → nightly physiology targets (jittered per night)
  var PROFILES = {
    baseline: { ahi: 22, cpap: false, rmssd: 24, rsaGain: 1.21, label: 'untreated OSA' },
    severe:   { ahi: 38, cpap: false, rmssd: 18, rsaGain: 0.81, label: 'severe OSA'    },
    cpap:     { ahi: 6,  cpap: true,  rmssd: 34, rsaGain: 1.59, label: 'on CPAP'       },
    healthy:  { ahi: 3,  cpap: false, rmssd: 46, rsaGain: 2.30, label: 'healthy'       }
  };

  // one canonical patient (deterministic; day i uses seed BASE + i*1000)
  var BASE_SEED = 424242;
  // multi-day record starts here and walks forward one civil day per night
  var START = { y: 2026, mo: 5, d: 11 };

  var P2 = function (n) { return (n < 10 ? '0' : '') + n; };

  // Build N consecutive nights for ONE patient under `profile`.
  // A slow shared severity drift (random walk) ties the night's signals together:
  // a worse night has MORE apnea (higher AHI/ODI) AND lower HRV — so multi-day
  // records show realistic cross-signal coupling, not independent noise.
  // opts (optional, LAST arg — back-compat): { gluc, glucBaseMmol } let a node
  // override the glucose story. Default gluc:'flat' (dodges date-locked windows);
  // GlucoDex passes glucBaseMmol to express pre-diabetes off the SAME patient.
  function buildNights(profile, nDays, opts) {
    var S = global.SYNTH;
    if (!S || typeof S.masterTimeline !== 'function') return null;
    opts = opts || {};
    var glucKind = opts.gluc || 'flat';
    var P = PROFILES[profile] || PROFILES.baseline;
    var N = Math.max(1, nDays | 0);
    var walk = S.mulberry32((BASE_SEED ^ 0x5bd1e995) >>> 0);  // persistent drift RNG
    var sev = 1;                                              // shared severity factor ~1
    var tls = [];
    for (var i = 0; i < N; i++) {
      var seed = BASE_SEED + i * 1000;
      var rng = S.mulberry32((seed ^ 0x9e3779b9) >>> 0);
      var jit = function (base, spread) { return base + (rng() * 2 - 1) * spread; };
      sev = Math.max(0.65, Math.min(1.5, sev + (walk() * 2 - 1) * 0.14));   // random walk
      var dms = Date.UTC(START.y, START.mo - 1, START.d + i);
      var dt = new Date(dms);
      var y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, day = dt.getUTCDate();
      var bedM = Math.round(rng() * 40);                 // 23:00–23:40 lights-out
      var cfg = {
        n: 100 + i,                                       // >=100 → skips arc CSR/residual specials
        date: y + '-' + P2(mo) + '-' + P2(day),
        bed: [y, mo, day, 23, bedM],
        durSec: Math.round(jit(7.5 * 3600, 1200)),        // ~7–8 h
        ahi: Math.max(0.5, jit(P.ahi * sev, P.ahi * 0.10)),        // worse night → higher AHI
        cpap: P.cpap,
        gluc: glucKind,                                   // 'flat' avoids date-locked hypo/dawn windows
        glucBaseMmol: opts.glucBaseMmol,                  // optional fasting-baseline override (pre-DM)
        rmssd: Math.max(8, jit(P.rmssd / sev, 3)),                 // …and lower HRV (inverse)
        rsaGain: Math.max(0.4, jit(P.rsaGain / sev, 0.15)),
        story: P.label + ' · day ' + (i + 1) + '/' + N
      };
      tls.push(S.masterTimeline(cfg, seed));
    }
    return tls;
  }

  // Resolve a request → { tls, profile, days, label }.
  function resolve(profile, nDays, opts) {
    var prof = PROFILES.hasOwnProperty(profile) ? profile : 'baseline';
    var days = Math.max(1, (nDays | 0) || 1);
    var tls = buildNights(prof, days, opts);
    if (!tls) return null;
    return { tls: tls, profile: prof, days: days, label: PROFILES[prof].label };
  }

  // Read profile + days from two DOM controls (by id), then resolve.
  function fromControls(profileId, daysId) {
    var pf = document.getElementById(profileId);
    var dy = document.getElementById(daysId);
    return resolve(pf ? pf.value : 'baseline', dy ? +dy.value : 1);
  }

  // Short chip caption, e.g. "synthetic · 7-day · untreated OSA".
  function chip(r) {
    return 'synthetic · ' + r.days + '-day · ' + r.label;
  }

  // ── injected stylesheet (single source — mirrors the metric-registry pattern) ──
  var CSS =
    '.synth-line{display:flex;gap:9px;align-items:center;justify-content:center;flex-wrap:wrap;' +
    'margin:12px 0 2px;font-size:11.5px;color:var(--text3)}' +
    '.synth-line select{font-size:11px;padding:3px 7px;border-radius:6px;background:var(--surface);' +
    'border:1px solid var(--border);color:var(--text2)}' +
    '.synth-line .synth-days{display:inline-flex;align-items:center;gap:4px}' +
    '.synth-link{background:none;border:none;color:var(--blue);font:inherit;font-size:11.5px;' +
    'font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;padding:0}' +
    '.synth-link:hover{color:var(--teal)}';
  function injectCSS() {
    try {
      if (document.getElementById('dex-synth-css')) return;
      var s = document.createElement('style');
      s.id = 'dex-synth-css';
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* no-DOM (worker) — ignore */ }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectCSS);
    } else { injectCSS(); }
  }

  global.DexPatientGen = {
    PROFILES: PROFILES, BASE_SEED: BASE_SEED,
    buildNights: buildNights, resolve: resolve, fromControls: fromControls,
    chip: chip, injectCSS: injectCSS, BADGE_CSS: CSS
  };

})(window);
