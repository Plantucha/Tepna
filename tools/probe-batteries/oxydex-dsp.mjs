/*
 * tools/probe-batteries/oxydex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE oxydex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * Residue `2026-10-12-no-probe-battery-for-oxydex-dsp`: seven nodes had a battery and the DSP the
 * fleet mutates most often had none, so no survivor in it could be adjudicated at all.
 *
 * ⚠️ THIS BATTERY COVERS FOUR FUNCTIONS, NOT THE FILE. `oxydex-dsp.js` carries 3296 mutants over 57
 * suite groups (measured 2026-10-19, `node tools/mutate.mjs --file oxydex-dsp.js --dry-run --json`),
 * and a whole-file sweep costs hours. The four families below are the `rows`-taking cluster that the
 * residue row's own survivor sits in — one input shape serves all four:
 *
 *   computeDataGaps(rows)      16 mutants   reads rows[i].t
 *   computeHRFlatlines(rows)   12 mutants   reads rows[i].hr
 *   computeSpO2Ceiling(rows)   13 mutants   reads rows[i].spo2
 *   computeHRCV(rows)          14 mutants   reads rows[i].hr
 *
 * Every other function in the file stays unadjudicated, and a survivor there still has no verdict.
 * Adding one is adding a family here: the realm and the row builder are already paid for.
 *
 * ── CONTRACTS, READ FROM SOURCE ──────────────────────────────────────────────────────────────
 *   a row is `{ t, hr, spo2 }` — `t` floating wall-clock ms, `hr` bpm, `spo2` percent
 *   GAP_STEP_SEC = 2, so only a step OVER 2 s is a gap; `_has(v) = v != null && isFinite(v)`
 *   computeDataGaps   refuses under 2 rows; `maxGap` labels at > 120 s and > 10 s
 *   computeHRFlatlines / computeSpO2Ceiling / computeHRCV  all refuse under 60 rows
 *   computeHRCV       refuses again under 60 MEASURED rows, and on a mean of 0
 *
 * ── WHY THE CASES SIT ON BOUNDARIES RATHER THAN BEING REALISTIC ───────────────────────────────
 * README failure 3: an input that merely reaches the mutated line does not separate it. A night of
 * plausible SpO2 never puts a run at exactly 5 samples or a gap at exactly 2 s, and those are the
 * only inputs that tell `>=` from `>`. So each case below names the boundary it sits on.
 *
 * README failure 7 is the one that cannot be read off the source: a family proven against 8 controls
 * has not been proven against 40. The control ceiling here is the function's OWN killed-mutant count,
 * and the PR records the curve.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

export const deps = ['kernel-constants.js', 'clock.js'];

export function realmGlobals() {
  const ctx = {
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Symbol,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    Float64Array,
    Float32Array,
    Int32Array,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    DataView,
    TextDecoder,
    setTimeout,
    clearTimeout,
    Promise,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }
  };
  /* THE REALM IS THE SUITE'S SANDBOX, FIELD FOR FIELD — `tests/run-tests.mjs makeSandbox`. The module
     head reads `document.getElementById('fileInput')` and, five lines on,
     `document.documentElement.outerHTML`, so a realm with a thinner stub does not BUILD: the first
     draft here returned null from `getElementById` and nothing for `documentElement`, and the load
     threw `Cannot read properties of undefined (reading 'outerHTML')`. README's standing rule — give
     the realm what the suite gives it, or a mutant differs from the original by the stub. */
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    outerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  ctx.document = {
    getElementById: () => null,
    createElement: el,
    createTextNode: () => ({}),
    querySelector: () => null,
    querySelectorAll: () => [],
    head: el(),
    body: el(),
    documentElement: el(),
    addEventListener: noop,
    readyState: 'complete'
  };
  const store = new Map();
  ctx.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  ctx.addEventListener = noop;
  ctx.removeEventListener = noop;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  return ctx;
}

export function subject(ctx) {
  const O = ctx.OxyDex;
  return O && O._bare && typeof O._bare.computeHRCV === 'function' ? O._bare : null;
}

/* ── FINGERPRINTING ──────────────────────────────────────────────────────────────────────────
   Same normaliser the other batteries use: numbers rounded to 1e-6 so a last-bit difference is not
   read as a behaviour change, non-finite numbers kept as themselves (an Infinity IS the difference
   several of these mutants produce), and a throw kept as its message. */
function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 'N:' + String(x);
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[cyc]';
    seen.add(x);
    if (Array.isArray(x)) return x.length <= 40 ? x.map(norm) : ['A', x.length, x.slice(0, 12).map(norm), x.slice(-6).map(norm)];
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = norm(x[k]);
    return o;
  };
  try {
    const out = JSON.stringify(norm(v));
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

/* ── ROW BUILDER ─────────────────────────────────────────────────────────────────────────────
   README failure 6: a fixture that derives a dependent field before the overrides land makes whole
   branches unreachable. Here `t` is built from the per-index step AFTER the step list is applied, so
   a gap moves every later stamp with it — which is what a real dropout does and what `_spanSec`
   reads. README failure 4: `hr` and `spo2` are set per index, never held at one value across the
   whole battery, because a constant column hides every guard that reads a spread. */
const T0 = Date.UTC(2026, 6, 1, 23, 0, 0);

function mk(n, opt) {
  const o = opt || {};
  const out = [];
  let t = T0;
  for (let i = 0; i < n; i++) {
    const stepSec = o.stepAt && o.stepAt[i] != null ? o.stepAt[i] : 1;
    if (i > 0) t += stepSec * 1000;
    const r = {
      t: o.noT ? null : o.tNullAt && o.tNullAt.indexOf(i) >= 0 ? null : o.sameT ? T0 : t,
      hr: o.hrAt ? o.hrAt(i) : 60 + (i % 7),
      spo2: o.spo2At ? o.spo2At(i) : 96 - (i % 3)
    };
    out.push(r);
  }
  return out;
}
/* A series of `k` equal values then `rest` strictly varying ones, so a flat RUN ends before the array
   does — the in-loop `run >= 30` is the only check that can credit it. `tailFlat` is the mirror: the
   run reaches the last row, so only the after-loop copy of the same line fires. Both shapes are
   needed, and the pulsedex battery records the measurement that proves it: the same source line
   appears twice and one shape reaches each. */
const headFlat = (k) => (i) => (i < k ? 60 : 60 + ((i % 2) + 1) * 3);
const tailFlat = (lead) => (i) => (i < lead ? 60 + ((i % 2) + 1) * 3 : 72);
/* Five runs of exactly `k`, each closed by one differing row, so flatlineCount lands on a chosen
   integer — the only way to sit ON `flatCount > 5` rather than far past it. */
const nRuns = (runs, k) => (i) => {
  const block = Math.floor(i / (k + 1));
  const within = i % (k + 1);
  return block < runs ? (within < k ? 60 + block : 90 + block) : 40 + (i % 2) * 11;
};
/* `spo2` at the ceiling for exactly `k` samples starting at `from`, measured and below it elsewhere.
   `99` is the boundary itself: `>= 99` and `> 99` part only on a sample of exactly 99. */
const ceilRun =
  (from, k, at = 99) =>
  (i) =>
    i >= from && i < from + k ? at : 95;
const ceilRuns =
  (runs, k, gap = 3) =>
  (i) => {
    const period = k + gap;
    const block = Math.floor(i / period);
    return block < runs && i % period < k ? 99 : 95;
  };
/* cv = sd / mean, both over the measured rows only, so a two-value series puts cv on an exact
   figure: mean = (a+b)/2 and sd = |a-b|/2 for equal halves. cvPair(12) gives cv 12.00 — the
   `cv > 12` boundary — rather than a plausible 11.7 that fires under both arms. */
const cvPair = (cvPct, n, mean = 100) => {
  const half = (cvPct / 100) * mean;
  return (i) => (i < n / 2 ? mean + half : mean - half);
};

/* ══ CASES ══════════════════════════════════════════════════════════════════════════════════ */

const GAP_CASES = [
  [[]], //                                               0 rows — under the 2-row floor
  [mk(1)], //                                            1 row  — still under it
  [mk(2)], //                                            exactly 2 — the `n < 2` boundary itself
  [mk(3)], //                                            3 rows, 1 s apart, no gap at all
  [mk(10, { stepAt: { 4: 2 } })], //                     a step of EXACTLY GAP_STEP_SEC (2 s)
  [mk(10, { stepAt: { 4: 2.001 } })], //                 just over it
  [mk(10, { stepAt: { 4: 7 } })], //                     over 2, under 10 — labels 'Clean'
  [mk(10, { stepAt: { 4: 10 } })], //                    maxGap EXACTLY 10 — the 'Minor gaps' edge
  [mk(10, { stepAt: { 4: 50 } })], //                    between the two label edges
  [mk(10, { stepAt: { 4: 120 } })], //                   maxGap EXACTLY 120 — the 'Significant' edge
  [mk(10, { stepAt: { 4: 121 } })], //                   just over it
  [mk(12, { stepAt: { 3: 30, 8: 30 } })], //             two gaps of EQUAL size — `dt > maxGap` ties
  [mk(12, { stepAt: { 3: 30, 8: 40 } })], //             second gap larger — the tie broken
  [mk(5, { sameT: true })], //                           span EXACTLY 0 — the `_spanSec > 0` boundary
  [mk(5, { noT: true })], //                             no stamp at all — the assumed-1Hz arm
  [mk(5, { tNullAt: [2] })], //                          one absent stamp mid-series
  [mk(5, { tNullAt: [0] })], //                          absent FIRST stamp — `_spanSec`'s own guard
  [mk(5, { tNullAt: [4] })], //                          absent LAST stamp
  [mk(61, { stepAt: { 30: 300 } })], //                  a night-shaped case with one 5-minute gap
  [mk(4, { stepAt: { 2: -10 } })], //                    time running BACKWARDS — dt negative
  [null],
  [undefined]
];

const FLAT_CASES = [
  [mk(59, { hrAt: () => 60 })], //                       under the 60-row floor, perfectly flat
  [mk(60, { hrAt: () => 60 })], //                       EXACTLY 60 — the `n < 60` boundary
  [mk(61, { hrAt: () => 60 })], //                       one over, and one run to the very end
  [mk(70, { hrAt: (i) => 60 + (i % 2) })], //            alternating — no run ever reaches 30
  [mk(70, { hrAt: headFlat(29) })], //                   a run of EXACTLY 29, closed mid-series
  [mk(70, { hrAt: headFlat(30) })], //                   EXACTLY 30 — the in-loop `run >= 30` edge
  [mk(70, { hrAt: headFlat(31) })], //                   31 — over the edge
  [mk(70, { hrAt: tailFlat(40) })], //                   a run of 30 that REACHES the last row
  [mk(69, { hrAt: tailFlat(40) })], //                   the same tail one row shorter — 29
  [mk(124, { hrAt: nRuns(4, 30) })], //                  flatlineCount 4
  [mk(155, { hrAt: nRuns(5, 30) })], //                  EXACTLY 5 — the `flatCount > 5` edge
  [mk(186, { hrAt: nRuns(6, 30) })], //                  6 — over it
  [mk(130, { hrAt: nRuns(2, 30) })], //                  two runs of EQUAL length — `run > maxFlat` ties
  [mk(70, { hrAt: (i) => (i < 35 ? null : 60) })], //    null === null holds a run together
  [mk(70, { hrAt: (i) => (i < 35 ? NaN : 60) })], //     NaN === NaN never does
  [mk(70, { hrAt: (i) => (i % 31 === 0 ? 99 : 60) })], // runs of 30 broken by one row each
  [null]
];

const CEIL_CASES = [
  [mk(59, { spo2At: () => 99 })], //                     under the 60-row floor
  [mk(60, { spo2At: () => 99 })], //                     EXACTLY 60 rows, all at the ceiling
  [mk(61, { spo2At: () => 100 })], //                    above the ceiling value
  [mk(70, { spo2At: () => 95 })], //                     measured, never at the ceiling
  [mk(70, { spo2At: () => 98 })], //                     one BELOW the ceiling — the `>= 99` edge
  [mk(70, { spo2At: ceilRun(10, 4) })], //               a run of EXACTLY 4 — under `run >= 5`
  [mk(70, { spo2At: ceilRun(10, 5) })], //               EXACTLY 5 — on it
  [mk(70, { spo2At: ceilRun(10, 6) })], //               6 — over it
  [mk(70, { spo2At: ceilRun(65, 5) })], //               a run of 5 that REACHES the last row
  [mk(70, { spo2At: ceilRun(66, 4) })], //               the same tail one sample shorter
  [mk(70, { spo2At: ceilRuns(2, 6) })], //               two runs of EQUAL length — `run > maxCeil` ties
  [mk(70, { spo2At: ceilRuns(3, 6) })], //               EXACTLY 3 runs — the label edge
  [mk(70, { spo2At: ceilRuns(4, 6) })], //               4 runs — over it
  [mk(70, { spo2At: (i) => (i % 2 ? null : 99) })], //   absent samples break every run
  [mk(70, { spo2At: (i) => (i % 2 ? NaN : 99) })], //    non-finite samples do too
  [mk(70, { spo2At: () => null })], //                   nothing measured at all
  [null]
];

const CV_CASES = [
  [mk(59, { hrAt: cvPair(12, 59) })], //                 under the 60-row floor
  [mk(60, { hrAt: cvPair(12, 60) })], //                 cv EXACTLY 12.00 — the label edge
  [mk(60, { hrAt: cvPair(6, 60) })], //                  cv EXACTLY 6.00 — the second label edge
  [mk(60, { hrAt: cvPair(3, 60) })], //                  cv 3.00 — 'Low', and > 0
  [mk(60, { hrAt: cvPair(30, 60) })], //                 cv 30.00 — well over the top edge
  [mk(60, { hrAt: () => 100 })], //                      sd 0 — cv EXACTLY 0
  [mk(70, { hrAt: (i) => (i < 10 ? null : 100 + (i % 2) * 6) })], // EXACTLY 60 measured — the `m < 60` edge
  [mk(70, { hrAt: (i) => (i < 11 ? null : 100 + (i % 2) * 6) })], // 59 measured — under it
  [mk(70, { hrAt: (i) => (i < 10 ? NaN : 100 + (i % 2) * 6) })], //  non-finite, not absent
  [mk(70, { hrAt: (i) => (i < 10 ? Infinity : 100) })], //           Infinity is not finite either
  [mk(60, { hrAt: cvPair(12, 60, -100) })], //           a NEGATIVE mean — the `||` → `&&` arm
  [mk(60, { hrAt: (i) => (i < 30 ? 100 : -100) })], //   a mean of EXACTLY 0 — `!mean` fires
  [mk(60, { hrAt: (i) => (i < 30 ? 0 : 0) })], //        every sample 0 — mean 0 by another route
  [mk(120, { hrAt: (i) => 60 + 8 * Math.sin(i / 9) })], // a night-shaped series
  [null]
];

export const families = [
  {
    name: 'computeDataGaps · dropout accounting (16 mutants)',
    fn: 'computeDataGaps',
    probe: (B) => GAP_CASES.map((c) => call(B.computeDataGaps, c)),
    minDistinct: 6
  },
  {
    name: 'computeHRFlatlines · stuck-HR runs (12 mutants)',
    fn: 'computeHRFlatlines',
    probe: (B) => FLAT_CASES.map((c) => call(B.computeHRFlatlines, c)),
    minDistinct: 6
  },
  {
    name: 'computeSpO2Ceiling · sensor-lift runs (13 mutants)',
    fn: 'computeSpO2Ceiling',
    probe: (B) => CEIL_CASES.map((c) => call(B.computeSpO2Ceiling, c)),
    minDistinct: 6
  },
  {
    name: 'computeHRCV · coefficient of variation (14 mutants)',
    fn: 'computeHRCV',
    probe: (B) => CV_CASES.map((c) => call(B.computeHRCV, c)),
    minDistinct: 6
  }
];
