/*
 * tools/probe-batteries/motiondex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE motiondex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * Its sweep is on disk (`.mutation-crawl/motiondex-dsp.js.sweep.json`): 466 tested, 171 killed,
 * 8 invalid, 287 survivors. ⚠️ `canary: NONE` — that sweep was UNGUARDED, so the 37.3 % rate it
 * implies is a hypothesis and not a result (MUTATION-PROGRAM §3). The SURVIVOR LIST is still usable
 * for probing: a mutant either survives or it does not, and the canary question is about whether the
 * harness could see kills at all.
 *
 * SURVIVORS ARE A LONG TAIL — 287 across 35 functions, largest cluster 31 (11 %). That is ppgdex's
 * shape, not hrvdex's, so no single battery moves it far and the honest target is the reachable half.
 *
 * THE FOUR BIGGEST CLUSTERS ARE NOT EXPORTED and are probed THROUGH their callers:
 *   inferAccUnit (31) · respWindowSpectrum (17) · xyzPlausible (15) · respResample (14)
 * `inferAccUnit` and `xyzPlausible` sit inside `parseSensorXYZ`; `respResample` and
 * `respWindowSpectrum` inside the respiratory chain. A family is declared on the CALLER, so its
 * controls come from the caller's own line range — the engine's same-function rule still holds,
 * because the callee's lines are inside the caller only when the caller literally contains them.
 * Where it does not, those survivors stay UNCLASSIFIED rather than being cleared by a battery that
 * reaches them only incidentally.
 *
 * `genSyntheticACC` is the node's OWN generator, so the realistic inputs are the ones it produces
 * rather than ones invented here — it is both a subject and the source of every other family's data.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

export const deps = ['kernel-constants.js', 'clock.js'];

export function realmGlobals() {
  const ctx = {
    Date, Math, JSON, Number, String, Array, Object, Boolean, Symbol, Map, Set, RegExp, Error, TypeError, RangeError,
    isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    Float64Array, Float32Array, Int32Array, Uint8Array, Uint32Array, ArrayBuffer, DataView,
    setTimeout, clearTimeout, Promise,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  return ctx;
}

export function subject(ctx) {
  const M = ctx.MOTIONDSP;
  return M && typeof M.parseSensorXYZ === 'function' ? M : null;
}

function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 'N:' + String(x);
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[cyc]';
    seen.add(x);
    if (Array.isArray(x)) return x.length > 40 ? [x.length, x.slice(0, 20).map(norm), x.slice(-8).map(norm)] : x.map(norm);
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = norm(x[k]);
    return o;
  };
  try {
    const out = JSON.stringify(norm(v));
    /* JSON.stringify(undefined) is UNDEFINED, not a string — left uncoerced, every void-returning
       call fingerprints identically and the battery reads as degenerate. */
    return out === undefined ? 'U:' + String(v) : out;
  } catch (e) {
    return 'UNSER:' + String(e && e.message).slice(0, 40);
  }
}
const call = (fn, args) => {
  if (typeof fn !== 'function') return 'ABSENT';
  try {
    return s(fn.apply(null, args));
  } catch (e) {
    return 'THREW:' + String(e && e.message).slice(0, 80);
  }
};

const T0 = Date.UTC(2026, 5, 10, 22, 0, 0);
/* Units are a real branch here (`mg` vs `g` is a 1000× error, the class DexUnits exists for), so both
   are supplied everywhere alongside the absent case. */
const UNITS = ['mg', 'g', null, undefined, 'MG', ''];

/* Built once from the node's own generator, so the rows are the shape it actually parses. */
function corpus(M) {
  const texts = [];
  for (const o of [
    { hz: 26, sec: 120, brpm: 15, seed: 1 },
    { hz: 26, sec: 120, brpm: 12, seed: 2 },
    { hz: 26, sec: 120, brpm: 30, seed: 3 }, // fast, near the plausible upper edge
    { hz: 26, sec: 120, brpm: 6, seed: 4 }, // slow, near the lower edge
    { hz: 52, sec: 120, brpm: 15, seed: 5 }, // double rate
    { hz: 13, sec: 120, brpm: 15, seed: 6 }, // half rate
    { hz: 26, sec: 20, brpm: 15, seed: 7 }, // shorter than one analysis window
    { hz: 26, sec: 600, brpm: 15, seed: 8 }, // many windows
    { hz: 26, sec: 2, brpm: 15, seed: 9 } // degenerate length
  ])
    texts.push(call(M.genSyntheticACC, [o]) === 'ABSENT' ? '' : M.genSyntheticACC(o));
  return texts;
}

export const families = [
  {
    name: 'parseSensorXYZ · text ingest (holds inferAccUnit + xyzPlausible)',
    fn: 'parseSensorXYZ',
    probe: (M) => {
      const out = [];
      for (const t of corpus(M)) out.push(call(M.parseSensorXYZ, [t]));
      /* `inferAccUnit` decides mg-vs-g from the VALUES, so both magnitudes must appear, and
         `xyzPlausible` gates on physical range — a 1 g row, a 0 g row and an absurd one. */
      const HDR = 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]';
      const rows = (vals) => [HDR].concat(vals.map((v, i) => `2026-06-10 22:00:0${i % 10}.000;${599628000000000000 + i * 38461538};${v[0]};${v[1]};${v[2]}`)).join('\n');
      const rep = (v, n) => Array.from({ length: n }, () => v);
      for (const v of [
        [0, 0, 1000], // 1 g on Z, mg units
        [0, 0, 1], // 1 g on Z, g units
        [0, 0, 0], // free fall / all zero
        [0, 0, 999],
        [0, 0, 1001],
        [0, 0, 16000], // beyond any plausible range
        [-1000, 0, 0],
        [577, 577, 577], // ~1 g split across three axes
        [Number.NaN, 0, 1000],
        ['x', 'y', 'z']
      ])
        for (const n of [1, 9, 10, 11, 60]) out.push(call(M.parseSensorXYZ, [rows(rep(v, n))]));
      for (const raw of ['', ' ', '\n', HDR, HDR + '\n', 'junk', '1;2;3;4;5', HDR + '\njunk;junk;junk;junk;junk', null, undefined, 42]) out.push(call(M.parseSensorXYZ, [raw]));
      return out;
    }
  },
  {
    name: 'respiratoryEffort · the effort series (holds respResample)',
    fn: 'respiratoryEffort',
    probe: (M) => {
      const out = [];
      for (const t of corpus(M)) {
        const p = M.parseSensorXYZ(t);
        const rows = (p && (p.rows || p)) || [];
        for (const u of UNITS) for (const dur of [120, 60, 10, 0]) out.push(call(M.respiratoryEffort, [rows, T0, dur, u]));
      }
      for (const bad of [[], null, undefined, [{}], [null]]) out.push(call(M.respiratoryEffort, [bad, T0, 120, 'mg']));
      return out;
    }
  },
  {
    name: 'respiratoryRate · the rate estimate (holds respWindowSpectrum)',
    fn: 'respiratoryRate',
    probe: (M) => {
      const out = [];
      for (const t of corpus(M)) {
        const p = M.parseSensorXYZ(t);
        const rows = (p && (p.rows || p)) || [];
        for (const u of ['mg', 'g']) for (const opts of [undefined, {}, { minBrpm: 6 }, { maxBrpm: 30 }, { minBrpm: 6, maxBrpm: 30 }]) out.push(call(M.respiratoryRate, [rows, T0, u, opts]));
      }
      for (const bad of [[], null, [{}]]) out.push(call(M.respiratoryRate, [bad, T0, 'mg', undefined]));
      return out;
    }
  },
  {
    name: 'actigraphy · per-epoch activity',
    fn: 'actigraphy',
    probe: (M) => {
      const out = [];
      for (const t of corpus(M)) {
        const p = M.parseSensorXYZ(t);
        const rows = (p && (p.rows || p)) || [];
        for (const u of ['mg', 'g']) for (const dur of [120, 60, 30, 1, 0]) out.push(call(M.actigraphy, [rows, T0, dur, u]));
      }
      for (const bad of [[], null, [{}]]) out.push(call(M.actigraphy, [bad, T0, 120, 'mg']));
      return out;
    }
  },
  {
    name: 'motionSQI · signal quality',
    fn: 'motionSQI',
    probe: (M) => {
      const out = [];
      for (const t of corpus(M)) {
        const p = M.parseSensorXYZ(t);
        const rows = (p && (p.rows || p)) || [];
        for (const u of UNITS) out.push(call(M.motionSQI, [rows, u]));
      }
      for (const bad of [[], null, undefined, [{}], [null]]) out.push(call(M.motionSQI, [bad, 'mg']));
      return out;
    }
  },
  {
    name: 'genSyntheticACC · the generator itself',
    fn: 'genSyntheticACC',
    probe: (M) => {
      const out = [];
      for (const o of [undefined, {}, { hz: 26 }, { sec: 120 }, { brpm: 15 }, { seed: 1 }, { seed: 2 }, { hz: 1, sec: 1, brpm: 1, seed: 1 }, { hz: 0, sec: 0, brpm: 0, seed: 0 }, { hz: 26, sec: 120, brpm: 15, seed: 1 }, { hz: 52, sec: 5, brpm: 60, seed: 99 }, { hz: -1, sec: -1, brpm: -1, seed: -1 }])
        out.push(call(M.genSyntheticACC, [o]));
      return out;
    }
  }
];
