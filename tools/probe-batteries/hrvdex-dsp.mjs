/*
 * tools/probe-batteries/hrvdex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE hrvdex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * WHY THIS FILE FIRST. `.mutation-crawl/hrvdex-dsp.js.sweep.json` is the fleet's first
 * canary-guarded full DSP sweep — 489 tested, 191 killed, 0 invalid, 298 survivors, canary PASSED
 * (MUTATION-PROGRAM §2a). Those 298 have been sitting classified-as-nothing, so the ratified
 * `killed / distinguishable` target is unmeasurable here. The sweep did the measurement; this is the
 * other half.
 *
 * SIX FAMILIES, chosen to span MUTATION-PROGRAM §5's axis — the equivalent-mutant share is a property
 * of what a function DOES — and to cover where the survivors actually are, which is not uniform:
 *
 *   computeDerived        149 survivors  numeric / derivation   — 52 derived columns, absorbing
 *   hrvLoadOwnExport       11            validation / dispatch  — branches on input SHAPE
 *   hrvBuildNodeExport     19            assembly / ordering
 *   hrvEventsFromRows      16            thresholding / emission
 *   _hrvParseSummaryRows   12            string / parsing
 *   computeCAMQ            10            scoring / clamping
 *                          ───
 *                          217 of 298
 *
 * TWO THINGS ABOUT THIS FILE THAT ARE NOT OBVIOUS FROM THE SOURCE, both found by running it:
 *
 * 1 · `computeDerived`'s SECOND HALF READS MODULE STATE, NOT ITS ARGUMENT. L550 iterates `_rows =
 *     rowsArg || allRows`, but L799/L810 iterate `allRows` directly — the rolling 7-day and 14-day
 *     windows, the day-over-day deltas and the acute:chronic ratio all come off the closure variable.
 *     A battery that only passes rows as an argument therefore never reaches roughly a third of the
 *     function, and every mutant down there reads as equivalent about the probe rather than the code.
 *     So each case sets `HRVDex.allRows` as well, and the multi-day cases exist for exactly this.
 *
 * 2 · THE REALM NEEDS FIVE DEPS, NOT ONE. `computeDerived` reads `DexUnits.guardBaevsky` /
 *     `asSecondsRR` (quantity.js) and takes a DIFFERENT, documented fallback arm when it is absent —
 *     the hard `/1000`. Probing without it would compare two runs of the fallback and call the guard
 *     equivalent. `DexExport` (dex-export.js) backs `scrubExport`, and `clock.js` is the co-loaded
 *     parser every stamp goes through. Give the realm what the suite gives it, or a difference
 *     belongs to the probe (#1052 discarded a verdict that differed only by "DexClock is not
 *     defined").
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

/* The suite's realm (tests/run-tests.mjs) loads all of these before hrvdex-dsp.js. `quantity.js` is
   the load-bearing one — see the header note 2. */
export const deps = ['kernel-constants.js', 'clock.js', 'quantity.js', 'dex-export.js', 'hrvdex-registry.js'];

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
    setTimeout,
    clearTimeout,
    Promise,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }
  };
  /* The DSP is an IIFE taking `window` as its `global`; everything it publishes lands there. */
  ctx.window = ctx;
  ctx.self = ctx;
  /* The suite co-loads namespaced (run-tests.mjs sets this before the DSP block), so the bare-global
     spray is off and `HRVDex._bare` is the surface. Probing un-namespaced would exercise a load path
     the suite never runs. */
  ctx.__DEX_NAMESPACED__ = true;
  return ctx;
}

export function subject(ctx) {
  const H = ctx.HRVDex;
  if (!H || !H._bare) return null;
  return { HRVDex: H, bare: H._bare };
}

/* Stable stringify — a probe compares BYTES, so key order must not depend on construction order,
   and NaN/Infinity must survive (JSON.stringify turns both into `null`, which would collapse the
   distinction between "absent" and "0/1e308" that half of this DSP's gates exist to preserve). */
function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? x : String(x);
    if (x === null || typeof x !== 'object') return x;
    if (x instanceof Date) return 'Date:' + x.getTime();
    if (seen.has(x)) return '[cyc]';
    seen.add(x);
    if (Array.isArray(x)) return x.map(norm);
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = norm(x[k]);
    return o;
  };
  try {
    return JSON.stringify(norm(v));
  } catch (e) {
    return 'UNSERIALISABLE:' + String(e && e.message).slice(0, 40);
  }
}
const call = (fn, args) => {
  if (typeof fn !== 'function') return 'ABSENT';
  try {
    return s(fn.apply(null, args));
  } catch (e) {
    return 'THREW:' + String(e && e.message).slice(0, 60);
  }
};

// ── row builders ────────────────────────────────────────────────────────────────────────────
const DAY = 86400000;
const T0 = Date.UTC(2026, 5, 1, 7, 30, 0); // floating wall-clock ms, CLOCK CONTRACT §1

/* A full Welltory row. Overrides are applied AFTER, so a case can delete a column by passing null —
   which is the distinction this DSP's presence gates are built on (absent ≠ 0). */
function row(over, dayOffset) {
  const r = {
    _tMs: T0 + (dayOffset || 0) * DAY,
    _offsetMin: null,
    _hr: 58,
    _meanRR: 1034,
    _sdnn: 62,
    _rmssd: 44,
    _mxdmn: 0.31,
    _pnn50: 21,
    _amo50: 33,
    _mode: 1.02,
    _totalPow: 2400,
    _hf: 780,
    _lf: 900,
    _vlf: 720,
    _stress: 34,
    _energy: 71,
    _focus: 55,
    _sns: 42,
    _psns: 61,
    _coherence: 48,
    _hrv: 66,
    _cv: 6.0
  };
  Object.assign(r, over || {});
  /* ⚠ `_date` MUST be derived AFTER the overrides, not before. The first draft built it from the
     default `_tMs` and then let an override move `_tMs` underneath it, so every case that set a
     clock time still carried the 07:30 Date — and `circAdj`'s hour bands (`mHour < 10` / `> 16`)
     were unreachable, which is one of the two controls that stayed blind at 24 samples. Read back
     with getUTC* per CLOCK CONTRACT §5; `_tMs` is floating wall-clock, so `new Date(tMs)` is only a
     compat carrier. */
  if (!Object.prototype.hasOwnProperty.call(over || {}, '_date')) r._date = isFinite(r._tMs) ? new Date(r._tMs) : null;
  return r;
}

/* Every column the derivation reads, at a value chosen to sit ON a gate rather than near it. Each
   entry is one battery input. */
const DERIVE_ROWS = [
  ['nominal', {}],
  ['rmssd exactly 0 — the `> 0` log gate', { _rmssd: 0 }],
  ['rmssd 1 — log is negative but finite', { _rmssd: 1 }],
  ['sdnn 0 — d_cv_calc divides by it', { _sdnn: 0 }],
  ['meanRR 0', { _meanRR: 0 }],
  ['meanRR in SECONDS (1.034) — asSecondsRR must detect', { _meanRR: 1.034 }],
  ['mode/mxdmn in MILLISECONDS — guardBaevsky must rescale', { _mode: 1020, _mxdmn: 310 }],
  ['amo50 0 — the SI numerator gate', { _amo50: 0 }],
  ['mode 0 — the unguarded fallback divides by it', { _mode: 0 }],
  ['mxdmn 0', { _mxdmn: 0 }],
  ['no spectral bands at all', { _hf: null, _lf: null, _vlf: null, _totalPow: null }],
  ['lf+hf only — the ECGDex/PpgDex ingest shape', { _vlf: null, _totalPow: null }],
  ['vlf only', { _hf: null, _lf: null, _totalPow: null }],
  ['totalPower only', { _hf: null, _lf: null, _vlf: null }],
  ['hf 0 with lf present — LF/HF divides', { _hf: 0 }],
  ['lf 0', { _lf: 0 }],
  ['totalPower 0 — the n.u. denominator', { _totalPow: 0 }],
  ['bands sum ABOVE totalPower (inconsistent vendor row)', { _totalPow: 100 }],
  ['subjective all absent — the _hasSubj gate, raw-recording shape', { _stress: null, _energy: null, _focus: null, _sns: null, _psns: null, _coherence: null }],
  ['subjective all exactly 0 — the seed-0 group', { _stress: 0, _energy: 0, _focus: 0, _sns: 0, _psns: 0, _coherence: 0 }],
  ['subjective PARTIALLY present — _hasSubj must refuse', { _focus: null }],
  ['stress at the 70 boundary', { _stress: 70 }],
  ['stress 69 / 71 — either side', { _stress: 71 }],
  ['stress 100, energy 0 — d_se_div at full span', { _stress: 100, _energy: 0.0001 }],
  ['sns/psns equal', { _sns: 50, _psns: 50 }],
  ['psns 0.0001 — a ratio denominator just above the gate', { _psns: 0.0001 }],
  ['pnn50 0', { _pnn50: 0 }],
  ['pnn50 100 — saturated', { _pnn50: 100 }],
  ['hr absent', { _hr: null }],
  ['hr 200 — tachy end', { _hr: 200 }],
  ['hrv score absent', { _hrv: null }],
  ['cv absent', { _cv: null }],
  [
    'every transparent column absent — the honest-NaN floor',
    { _hr: null, _meanRR: null, _sdnn: null, _rmssd: null, _mxdmn: null, _pnn50: null, _amo50: null, _mode: null, _totalPow: null, _hf: null, _lf: null, _vlf: null }
  ],
  ['negative rmssd (corrupt vendor cell)', { _rmssd: -44 }],
  ['string-typed numeric — _all must reject a non-number', { _rmssd: '44', _sdnn: '62' }],
  ['huge values — 1e9 power', { _hf: 1e9, _lf: 1e9, _vlf: 1e9, _totalPow: 3e9 }],
  ['tMs absent — the row must not poison the window', { _tMs: NaN, _date: null }]
];

/* ⚠ ALL-OR-NONE IS HOW THE COLUMNS BEHAVE, NOT HOW THE GATES ARE WRITTEN, and the gap between those
   two is where two controls hid. The six subjective scores move as a group in every real file, so
   the first draft only ever varied them as a group — and `r._sns > 0 && r._stress > 0 && …` then
   compares "all present" against "all absent", which its `>=` mutant reproduces exactly. Each gate
   has to be moved on its OWN. `null >= 0` is true and `null + 61` is 61, so an absent column is what
   separates both the comparison mutants and `_all(...) && r._sns + r._psns > 0`'s `||` mutant, which
   is precisely the arithmetic-its-way-to-a-value case `_all` exists to stop. */
for (const k of ['_stress', '_energy', '_focus', '_sns', '_psns', '_coherence', '_hrv']) {
  const absent = {};
  absent[k] = null;
  DERIVE_ROWS.push([k + ' ABSENT, the other five present', absent]);
  const zero = {};
  zero[k] = 0;
  DERIVE_ROWS.push([k + ' exactly 0, the other five present', zero]);
  const str = {};
  str[k] = '42';
  DERIVE_ROWS.push([k + ' a STRING — _all must reject a non-number', str]);
}
DERIVE_ROWS.push(['sns absent, psns positive — `_all` false but the sum is > 0', { _sns: null }]);
DERIVE_ROWS.push(['sns and psns both absent — the sum is 0, both arms refuse', { _sns: null, _psns: null }]);
DERIVE_ROWS.push(['sns positive, psns absent', { _psns: null }]);
DERIVE_ROWS.push(['sns and psns sum to exactly 0', { _sns: 0, _psns: 0 }]);
DERIVE_ROWS.push(['sns negative, psns positive, sum 0', { _sns: -30, _psns: 30 }]);
DERIVE_ROWS.push(['stress 60 exactly — the d_hile band edge', { _stress: 60 }]);
DERIVE_ROWS.push(['stress 61, energy 39 — either side of the d_hile band', { _stress: 61, _energy: 39 }]);
DERIVE_ROWS.push(['coherence 0 with the rest present', { _coherence: 0 }]);
DERIVE_ROWS.push(['coherence absent with the rest present', { _coherence: null }]);

/* The circadian factor and the all-night pass-through — `circAdj = _hrvIsAllNight(r) ? 1.0 : mHour
   < 10 ? 1.08 : mHour > 16 ? 0.95 : 1.0`. Three constants and two boundaries, and NONE of them was
   reachable: every row sat at 07:30 (so only the 1.08 arm ran) and no row carried `_spanMin` at all,
   so `_hrvIsAllNight` was false by construction and its `1.0` arm never executed. `ALL_NIGHT_MIN_MIN`
   is 180 (hrvdex-dsp.js:260). */
const at = (h, mi) => Date.UTC(2026, 5, 1, h, mi || 0, 0);
for (const [h, why] of [
  [0, 'midnight'],
  [7, 'morning — the < 10 arm'],
  [9, 'the hour before the < 10 boundary'],
  [10, 'exactly 10 — NOT < 10, falls to the middle arm'],
  [13, 'midday — the unadjusted middle arm'],
  [16, 'exactly 16 — NOT > 16, still the middle arm'],
  [17, 'evening — the > 16 arm'],
  [23, 'late evening']
]) {
  DERIVE_ROWS.push(['point sample at ' + h + ':00 (' + why + ')', { _tMs: at(h) }]);
  DERIVE_ROWS.push(['ALL-NIGHT row starting ' + h + ':00 — passed through unadjusted', { _tMs: at(h), _spanMin: 420 }]);
}
DERIVE_ROWS.push(['_spanMin exactly 180 — the all-night boundary', { _tMs: at(1, 6), _spanMin: 180 }]);
DERIVE_ROWS.push(['_spanMin 179 — one minute short, graded as a point sample', { _tMs: at(1, 6), _spanMin: 179 }]);
DERIVE_ROWS.push(['_spanMin absent — the typeof guard', { _tMs: at(1, 6) }]);
DERIVE_ROWS.push(['_spanMin a STRING "420" — typeof rejects it', { _tMs: at(1, 6), _spanMin: '420' }]);
DERIVE_ROWS.push(['_spanMin Infinity — isFinite rejects it', { _tMs: at(1, 6), _spanMin: Infinity }]);
DERIVE_ROWS.push(['_date not a Date — mHour falls back to 8', { _tMs: at(17), _date: null }]);

/* Multi-day sets — the ONLY way into computeDerived's second half (rolling 7/14-day windows, the
   day-over-day delta, the acute:chronic ratio). See header note 1. Each is one input. */
function series(n, mut) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(row(mut ? mut(i) : {}, i));
  return out;
}

/* ⚠ A CONSTANT COLUMN HIDES EVERY GUARD THAT READS ITS SPREAD, and it hid three of them here. The
   first draft held `_sdnn` at 62 across every series, so `stdSDNN7` was NaN or 0 in all of them —
   which made `r._sdnn > 0 && stdSDNN7 > 0` and its `||` mutant BOTH produce NaN, one by refusing and
   one by dividing by zero. The mutant read as equivalent, and it was a CONTROL: the sweep's tests
   kill it. That is rule 1 catching the battery rather than the code, and the fix is a varying column
   plus a row sitting exactly ON the `v > 0` filter. */
const jitterSdnn = (i) => 50 + ((i * 7) % 23);

const DERIVE_SERIES = [
  ['1 day', series(1)],
  ['2 days — the first day-over-day delta exists', series(2)],
  ['6 days — one short of the 7-day window', series(6)],
  ['7 days — the window exactly fills', series(7)],
  ['8 days — the window slides once', series(8)],
  ['13 days — one short of the 14-day chronic window', series(13)],
  ['14 days — chronic fills, acute:chronic becomes computable', series(14)],
  ['21 days — both windows sliding', series(21)],
  ['30 days, rmssd trending DOWN — a real slope', series(30, (i) => ({ _rmssd: 60 - i * 1.2 }))],
  ['30 days, rmssd trending UP', series(30, (i) => ({ _rmssd: 20 + i * 1.2 }))],
  ['30 days, rmssd FLAT — zero variance, the correlation denominator', series(30, () => ({ _rmssd: 44 }))],
  ['14 days with a mid-series GAP in rmssd', series(14, (i) => (i === 6 ? { _rmssd: null } : {}))],
  ['14 days, TWO measurements on the same calendar day', series(14, (i) => (i === 5 ? { _tMs: T0 + 4 * DAY + 3600000 } : {}))],
  ['14 days in REVERSE chronological order (Welltory file order)', series(14).reverse()],
  ['14 days spanning a month boundary', series(14, (i) => ({ _tMs: Date.UTC(2026, 5, 25, 7, 30) + i * DAY }))],
  ['14 days, every subjective column absent', series(14, () => ({ _stress: null, _energy: null, _focus: null, _sns: null, _psns: null, _coherence: null }))],
  /* SDNN with a real spread — stdSDNN7 becomes a positive number, so `_sdnn > 0 && stdSDNN7 > 0`
     stops being NaN-vs-NaN. */
  ['14 days, SDNN VARYING — stdSDNN7 > 0 at last', series(14, (i) => ({ _sdnn: jitterSdnn(i) }))],
  ['14 days varying SDNN, one day at SDNN exactly 0 — the `v > 0` window filter', series(14, (i) => ({ _sdnn: i === 6 ? 0 : jitterSdnn(i) }))],
  ['14 days varying SDNN, one day SDNN absent — null vs 0 must not coincide', series(14, (i) => ({ _sdnn: i === 6 ? null : jitterSdnn(i) }))],
  ['14 days varying SDNN, one day NEGATIVE', series(14, (i) => ({ _sdnn: i === 6 ? -5 : jitterSdnn(i) }))],
  ['14 days varying pNN50 including a real 0 — kept, unlike an absent one', series(14, (i) => ({ _pnn50: i === 6 ? 0 : 10 + i }))],
  ['14 days varying pNN50 with one ABSENT', series(14, (i) => ({ _pnn50: i === 6 ? null : 10 + i }))],
  ['14 days varying stress — the AUC and the lag-1 autocorrelation', series(14, (i) => ({ _stress: 20 + ((i * 11) % 60) }))],
  [
    '14 days, everything varying at once',
    series(14, (i) => ({ _sdnn: jitterSdnn(i), _rmssd: 30 + ((i * 5) % 31), _pnn50: 5 + ((i * 3) % 40), _stress: 20 + ((i * 11) % 60), _hr: 50 + (i % 17), _hf: 400 + i * 30, _lf: 900 - i * 20 }))
  ],
  ['empty array', []]
];

/* A PROFILE IS A WHOLE ARM OF THIS FUNCTION, and headless it is empty by design. `_ui.getProfile()`
   defaults to `{}` so d_vo2_* / d_bap fall to NaN — the honest answer when age/sex/BP were never
   supplied, and the reason `compute()` is byte-identical to the equivalence golden. But the APP
   always has one, and with `{}` every VO₂ mutant compares NaN to NaN: `d_vo2_base` needs a finite
   `hrmax_tanaka`, which needs `age`. `L741`'s zeroed rMSSD coefficient was blind for exactly that
   reason. So both arms are probed — the headless default is not replaced by the profiled one. */
const PROFILE = { age: 44, sex: 'M', sbp: 118, dbp: 74, weight: 78, height: 181, elev: 210, vo2gt: 46, hrrest_manual: 0, hrmax_manual: 0 };
const PROFILES = [
  ['headless — getProfile() → {}, the compute() path', {}],
  ['a full profile — the app path', PROFILE],
  ['profile with a manual HRmax above the 140 / rest+45 gates', Object.assign({}, PROFILE, { hrmax_manual: 185 })],
  ['profile with a manual HRmax at exactly 140', Object.assign({}, PROFILE, { hrmax_manual: 140 })],
  ['profile with a manual resting HR', Object.assign({}, PROFILE, { hrrest_manual: 52 })],
  ['profile at exactly 1500 m — the altitude gate', Object.assign({}, PROFILE, { elev: 1500 })],
  ['profile at 3000 m — the altitude factor bites', Object.assign({}, PROFILE, { elev: 3000 })],
  ['profile with no VO₂ ground truth', Object.assign({}, PROFILE, { vo2gt: 0 })]
];

// ── the CSV surface ─────────────────────────────────────────────────────────────────────────
const HDR = 'Date,Time,Measurement HR,Mean RR,SDNN,rMSSD,MxDMn,pNN50,AMo50,Mode,Total power,HF,LF,VLF,Stress(HRV),Energy(HRV),Focus,ANS balance(SNS),ANS balance(PSNS),Coherence index,HRV Score,CV';
const BODY = '58,1034,62,44,0.31,21,33,1.02,2400,780,900,720,34,71,55,42,61,48,66,6.0';
const csv = (rows) => [HDR].concat(rows).join('\n');

const PARSE_CASES = [
  ['nominal DMY', csv(['01/06/2026,07:30,' + BODY])],
  ['unambiguous DMY — day 25 > 12 locks the order', csv(['25/06/2026,07:30,' + BODY])],
  ['unambiguous MDY — 06/25 locks the other way', csv(['06/25/2026,07:30,' + BODY])],
  ['AMBIGUOUS then unambiguous — the mid-file flip DEEP-AUDIT-II §1.10 fixed', csv(['06/12/2026,07:30,' + BODY, '25/06/2026,07:30,' + BODY])],
  ['CONTRADICTORY — 25/06 and 06/25 in one file', csv(['25/06/2026,07:30,' + BODY, '06/25/2026,07:30,' + BODY])],
  ['ISO date, no zone', csv(['2026-06-01,07:30,' + BODY])],
  ['ISO datetime with Z in the Date column', csv(['2026-06-01T07:30:00Z,,' + BODY])],
  ['ISO datetime with +02:00', csv(['2026-06-01T07:30:00+02:00,,' + BODY])],
  ['Date column ALREADY carries the time — the /\\d{1,2}:\\d{2}/ branch', csv(['01/06/2026 07:30,,' + BODY])],
  /* ⚠ THE ONE INPUT THAT SEPARATES `_rawT && !test(_rawD)` FROM ITS `||` MUTANT, and the first draft
     did not have it. With the Time column EMPTY both arms land on `_rawD`, so the mutant reads as
     equivalent — and it is a control. It needs BOTH columns populated AND the date already carrying a
     time: the original then takes `_rawD || _rawT` (07:30) while the mutant concatenates (08:45). */
  ['Date carries a time AND Time is populated — the two disagree', csv(['01/06/2026 07:30,08:45,' + BODY])],
  ['same, ISO date carrying a time plus a Time column', csv(['2026-06-01T07:30,08:45,' + BODY])],
  ['Date carries a time, Time column is whitespace only', csv(['01/06/2026 07:30,   ,' + BODY])],
  ['time-only, no date — must refuse, never fabricate', csv([',07:30,' + BODY])],
  ['empty Date and Time', csv([',,' + BODY])],
  ['unparseable date', csv(['not-a-date,07:30,' + BODY])],
  ['out-of-range month 13 — Date.UTC would silently roll', csv(['01/13/2026,07:30,' + BODY])],
  ['out-of-range day 32', csv(['32/06/2026,07:30,' + BODY])],
  ['Feb 30 — a real calendar day check, not a range check', csv(['30/02/2026,07:30,' + BODY])],
  ['24:00:00 — the one legitimate ISO overflow', csv(['2026-06-01T24:00:00,,' + BODY])],
  ['seconds present', csv(['01/06/2026,07:30:45,' + BODY])],
  ['CRLF line endings', csv(['01/06/2026,07:30,' + BODY]).replace(/\n/g, '\r\n')],
  ['trailing newline', csv(['01/06/2026,07:30,' + BODY]) + '\n'],
  ['a row with FEWER than 5 cells — the length guard', csv(['01/06/2026,07:30,58,1034'])],
  ['a row with exactly 5 cells', csv(['01/06/2026,07:30,58,1034,62'])],
  ['blank cells throughout — null, never 0', csv(['01/06/2026,07:30,,,,,,,,,,,,,,,,,,,,'])],
  ['header only, no rows', HDR],
  ['whitespace-padded cells', csv([' 01/06/2026 , 07:30 , 58 , 1034 , 62 ,44,0.31,21,33,1.02,2400,780,900,720,34,71,55,42,61,48,66,6.0'])],
  [
    'alias columns — HR / Mode RR / Total Power / Stress',
    'Date,Time,HR,Mean RR,SDNN,rMSSD,MxDMn,pNN50,AMo50,Mode RR,Total Power,HF,LF,VLF,Stress,Energy,Focus,SNS,PSNS,Coherence,HRV,CV\n01/06/2026,07:30,' + BODY
  ],
  ['HRV Score present but blank — falls through to HRV', 'Date,Time,HRV Score,HRV,Mean RR,SDNN,rMSSD\n01/06/2026,07:30,,66,1034,62,44'],
  ['three rows, descending dates', csv(['03/06/2026,07:30,' + BODY, '02/06/2026,07:30,' + BODY, '01/06/2026,07:30,' + BODY])],
  ['a row whose stamp is unparseable among valid ones', csv(['01/06/2026,07:30,' + BODY, 'xx,yy,' + BODY, '03/06/2026,07:30,' + BODY])]
];

// ── the node-export surface ─────────────────────────────────────────────────────────────────
function exportDoc(over) {
  const d = {
    schema: { name: 'ganglior.node-export', node: 'HRVDex', version: '1.0', generated: '2026-06-01T07:30:00Z', provenance: { app: 'HRVDex' }, derivedFrom: null, scrubbed: false },
    recording: { startEpochMs: T0, spanDays: 14 },
    kernel: { k: 1 },
    measurements: [{ tMs: T0, rmssd: 44 }],
    ganglior_events: [
      { tMs: T0 + 200, t: '07:30:00', impulse: 'hrv_low', node: 'HRVDex', conf: 0.6 },
      { tMs: T0, t: '07:30:00', impulse: 'stress_high', node: 'HRVDex', conf: 0.5 }
    ]
  };
  return Object.assign(d, over || {});
}
const LOAD_CASES = [
  ['nominal own export', exportDoc()],
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['a string', 'ganglior.node-export'],
  ['an array', []],
  ['{} — no schema', {}],
  ['schema present but null', { schema: null }],
  ['schema.name wrong', exportDoc({ schema: { name: 'ganglior.crossnight', node: 'HRVDex' } })],
  ['schema.name absent', exportDoc({ schema: { node: 'HRVDex' } })],
  ['FOREIGN node — OxyDex', exportDoc({ schema: { name: 'ganglior.node-export', node: 'OxyDex' } })],
  ['foreign node — PulseDex', exportDoc({ schema: { name: 'ganglior.node-export', node: 'PulseDex' } })],
  ['node empty string', exportDoc({ schema: { name: 'ganglior.node-export', node: '' } })],
  ['node absent entirely', exportDoc({ schema: { name: 'ganglior.node-export' } })],
  ['node with surrounding whitespace — the trim', exportDoc({ schema: { name: 'ganglior.node-export', node: '  HRVDex  ' } })],
  ['node lower-case — must NOT match', exportDoc({ schema: { name: 'ganglior.node-export', node: 'hrvdex' } })],
  ['node is a number', exportDoc({ schema: { name: 'ganglior.node-export', node: 7 } })],
  ['events absent', exportDoc({ ganglior_events: undefined })],
  ['events not an array', exportDoc({ ganglior_events: { a: 1 } })],
  ['events empty', exportDoc({ ganglior_events: [] })],
  ['events already ascending', exportDoc({ ganglior_events: [{ tMs: 1 }, { tMs: 2 }, { tMs: 3 }] })],
  ['events descending — the sort must reorder', exportDoc({ ganglior_events: [{ tMs: 3 }, { tMs: 2 }, { tMs: 1 }] })],
  [
    'events with EQUAL tMs — sort stability',
    exportDoc({
      ganglior_events: [
        { tMs: 5, impulse: 'a' },
        { tMs: 5, impulse: 'b' }
      ]
    })
  ],
  ['an event with no tMs — the `|| 0` arm', exportDoc({ ganglior_events: [{ impulse: 'a' }, { tMs: -5, impulse: 'b' }] })],
  ['a null event in the list', exportDoc({ ganglior_events: [null, { tMs: 1 }] })],
  ['measurements absent', exportDoc({ measurements: undefined })],
  ['measurements not an array', exportDoc({ measurements: 'x' })],
  ['kernel absent', exportDoc({ kernel: undefined })],
  ['recording absent', exportDoc({ recording: undefined })],
  ['scrubbed true', exportDoc({ schema: { name: 'ganglior.node-export', node: 'HRVDex', scrubbed: true } })],
  ['provenance / generated / derivedFrom all absent', exportDoc({ schema: { name: 'ganglior.node-export', node: 'HRVDex' } })]
];

// ── families ────────────────────────────────────────────────────────────────────────────────
const BASE_FAMILIES = [
  {
    /* Every case sets `allRows` as well as passing the argument — header note 1. `derive` returns the
       same array it mutated, so the fingerprint is the whole derived row set. */
    name: 'computeDerived · numeric/derivation',
    fn: 'computeDerived',
    minDistinct: 20,
    probe: (s0) => {
      const out = [];
      /* `setHooks` only replaces the functions it is handed, so handing it `() => ({})` restores the
         headless default exactly — the arms are independent, not cumulative. */
      const useProfile = (p) => s0.HRVDex.setHooks({ getProfile: () => p, calcVo2Cat: (v, a, x) => (isNaN(v) ? '—' : (v > 45 ? 'high' : 'mid') + ':' + a + ':' + x) });
      const derive = (rows0) =>
        call(function () {
          const rows = rows0.map((r) => Object.assign({}, r));
          s0.HRVDex.allRows = rows;
          s0.bare.computeDerived(rows);
          return rows;
        }, []);

      useProfile({});
      for (const [, over] of DERIVE_ROWS) out.push(derive([row(over, 0)]));
      for (const [, rows0] of DERIVE_SERIES) out.push(derive(rows0));
      /* The no-argument call — `rowsArg || allRows` is its own branch, and it is the one the app
         actually takes. */
      out.push(
        call(function () {
          const rows = series(9).map((r) => Object.assign({}, r));
          s0.HRVDex.allRows = rows;
          s0.bare.computeDerived();
          return rows;
        }, [])
      );

      /* The profiled arm — one representative single row and one 14-day series per profile, so the
         VO₂ / BAP columns are finite and their mutants have something to differ by. */
      const PSERIES = series(14, (i) => ({ _sdnn: jitterSdnn(i), _rmssd: 30 + ((i * 5) % 31), _hr: 50 + (i % 17) }));
      for (const [, p] of PROFILES) {
        useProfile(p);
        out.push(derive([row({}, 0)]));
        out.push(derive([row({ _hr: 0 }, 0)]));
        out.push(derive([row({ _hr: null }, 0)]));
        out.push(derive([row({ _rmssd: 0 }, 0)])); // rmssd_adj takes its `: 1` arm
        out.push(derive([row({ _rmssd: 40.447 }, 0)])); // ln(rmssd) ≈ 3.7 — the reference, adj ≈ 1
        out.push(derive(PSERIES));
      }
      useProfile({}); // leave the module in the headless state the suite runs in
      return out;
    }
  },
  {
    name: 'hrvLoadOwnExport · validation/dispatch',
    fn: 'hrvLoadOwnExport',
    minDistinct: 8,
    probe: (s0) => LOAD_CASES.map(([, doc]) => call(s0.bare.hrvLoadOwnExport, [doc]))
  },
  {
    name: 'hrvBuildNodeExport · assembly/ordering',
    fn: 'hrvBuildNodeExport',
    minDistinct: 8,
    probe: (s0) => {
      const out = [];
      /* ⚠ DELETING THE VOLATILE KEY DELETED THE MUTANT WITH IT. `generated: opts.generated || new
         Date().toISOString()` is a live gate, and its `&& ` mutant is one the sweep KILLS — but the
         stamp is the clock, so a raw fingerprint differs from ITSELF on every run. The first draft
         dropped the key, which made that control read as equivalent: a blind spot the battery cut
         into itself. Classify it instead — which arm ran is a function of the input; the instant is
         not. */
      const stamp = (e, opts) => {
        if (!e || !e.schema) return e;
        const g = e.schema.generated;
        e.schema.generated =
          g === undefined ? 'ABSENT' : opts && opts.generated != null && g === opts.generated ? 'FROM-OPTS' : /^\d{4}-\d{2}-\d{2}T/.test(String(g)) ? 'ISO-NOW' : 'OTHER:' + String(g);
        return e;
      };
      const mk = (rows, opts) =>
        call(function () {
          const rs = rows.map((r) => Object.assign({}, r));
          s0.HRVDex.allRows = rs;
          s0.bare.computeDerived(rs);
          return stamp(s0.bare.hrvBuildNodeExport(rs, opts), opts);
        }, []);
      const SUBJ_NULL = { _stress: null, _energy: null, _focus: null, _sns: null, _psns: null, _coherence: null, _hrv: null };
      const SUBJ_ZERO = { _stress: 0, _energy: 0, _focus: 0, _sns: 0, _psns: 0, _coherence: 0, _hrv: 0 };
      out.push(mk([], undefined));
      out.push(mk([row({}, 0)], undefined));
      out.push(mk(series(2), undefined));
      out.push(mk(series(14), undefined));
      out.push(mk(series(14).reverse(), undefined)); // file order — the span-sign defect
      out.push(mk(series(30), undefined));
      out.push(mk([row({ _tMs: NaN, _date: null }, 0)], undefined));
      out.push(mk([row({ _tMs: NaN, _date: null }, 0), row({}, 3)], undefined));
      out.push(mk(series(3), { kernel: { k: 1 } }));
      out.push(mk(series(3), { kernel: null }));
      out.push(mk(series(3), { ingest: { adapter: 'welltory-summary', confidence: 0.95 } }));
      out.push(mk(series(3), { generated: '2026-06-01T00:00:00Z' }));
      out.push(mk(series(3), { kernel: { k: 2 }, ingest: { adapter: 'x' }, generated: '2026-06-01T00:00:00Z' }));
      out.push(mk([row({ _rmssd: 5 }, 0), row({ _rmssd: 5 }, 1)], undefined)); // events fire
      out.push(mk([row({ _stress: 90 }, 0)], undefined));
      out.push(
        mk(
          series(14, (i) => (i === 6 ? { _rmssd: null } : {})),
          undefined
        )
      );
      out.push(
        mk(
          series(14, (i) => ({ _tMs: T0 + i * 3600000 })),
          undefined
        )
      ); // all one day
      out.push(mk([row({}, 0), row({}, 0)], undefined)); // duplicate stamps
      /* The per-measurement `composites` block — seven independent `> 0` gates whose `>= 0` mutants
         are ALL controls the sweep kills, and all seven were blind because every row above carries a
         positive subjective score. `null >= 0` is TRUE in JS, so an absent column is exactly the
         input that separates them; a 0 column separates them the other way. */
      out.push(mk([row(SUBJ_NULL, 0)], undefined));
      out.push(mk([row(SUBJ_ZERO, 0)], undefined));
      out.push(mk([row(SUBJ_NULL, 0), row({}, 1), row(SUBJ_ZERO, 2)], undefined));
      for (const k of ['_stress', '_energy', '_focus', '_sns', '_psns', '_coherence', '_hrv']) {
        const one = {};
        one[k] = null;
        out.push(mk([row(one, 0)], undefined)); // exactly one absent — separates that gate alone
        const z = {};
        z[k] = 0;
        out.push(mk([row(z, 0)], undefined));
      }
      out.push(mk([row({ _sdnn: null, _rmssd: null, _pnn50: null, _mxdmn: null }, 0)], undefined));
      return out;
    }
  },
  {
    name: 'hrvEventsFromRows · thresholding/emission',
    fn: 'hrvEventsFromRows',
    minDistinct: 10,
    probe: (s0) => {
      /* Boundaries ON the gate, both sides — rmssd's `> 0 && < 20`, stress's `>= 70`, and both conf
         clamps at 0.4 / 0.9. Reaching is not separating (#1052). */
      const cases = [
        [],
        null,
        undefined,
        [null],
        [row({ _tMs: NaN, _date: null }, 0)],
        [row({ _rmssd: 19.999 }, 0)],
        [row({ _rmssd: 20 }, 0)],
        [row({ _rmssd: 20.001 }, 0)],
        [row({ _rmssd: 0 }, 0)],
        [row({ _rmssd: 0.0001 }, 0)],
        [row({ _rmssd: -1 }, 0)],
        [row({ _rmssd: 2 }, 0)], // conf hits the 0.9 clamp
        [row({ _rmssd: 12 }, 0)], // conf mid-range
        [row({ _rmssd: 19 }, 0)], // conf hits the 0.4 clamp
        [row({ _rmssd: null }, 0)],
        [row({ _stress: 69.999 }, 0)],
        [row({ _stress: 70 }, 0)],
        [row({ _stress: 70.001 }, 0)],
        [row({ _stress: 95 }, 0)], // conf at the 0.9 clamp
        [row({ _stress: 100 }, 0)],
        [row({ _stress: null }, 0)],
        [row({ _rmssd: 10, _stress: 80 }, 0)], // both fire on one row
        [row({ _rmssd: 10 }, 2), row({ _stress: 80 }, 0)], // out of order → the sort
        [row({ _rmssd: 10 }, 0), row({ _rmssd: 10 }, 0)], // equal tMs
        series(14, (i) => ({ _rmssd: i < 7 ? 10 : 44 })),
        [row({ _tMs: Date.UTC(2026, 5, 1, 0, 0, 0), _rmssd: 10 }, 0)], // midnight — the HH:MM:SS pad
        [row({ _tMs: Date.UTC(2026, 5, 1, 23, 59, 59), _rmssd: 10 }, 0)],
        [row({ _tMs: Date.UTC(2026, 5, 1, 9, 5, 3), _rmssd: 10 }, 0)] // single digits, all three pads
      ];
      return cases.map((c) => call(s0.bare.hrvEventsFromRows, [c]));
    }
  },
  {
    name: '_hrvParseSummaryRows · string/parsing',
    fn: '_hrvParseSummaryRows',
    minDistinct: 10,
    probe: (s0) => PARSE_CASES.map(([, text]) => call(s0.bare._hrvParseSummaryRows, [text]))
  },
  {
    name: 'computeCAMQ · scoring/clamping',
    fn: 'computeCAMQ',
    minDistinct: 10,
    probe: (s0) => {
      const cases = [
        null,
        undefined,
        {},
        row({}, 0),
        row({ _rmssd: 0 }, 0),
        row({ _rmssd: 0.0001 }, 0),
        row({ _rmssd: 40 }, 0), // paraScore hits the 100 clamp exactly
        row({ _rmssd: 39.9 }, 0),
        row({ _rmssd: 40.1 }, 0),
        row({ _rmssd: null }, 0),
        row({ _pnn50: 0 }, 0), // _all + `>= 0` — 0 counts
        row({ _pnn50: -1 }, 0), // negative — must not count
        row({ _pnn50: 25 }, 0), // hits the 100 clamp exactly
        row({ _pnn50: null }, 0),
        row({ _pnn50: '21' }, 0), // a string — _all must reject
        row({ _hf: 0 }, 0),
        row({ _hf: 0.0001 }, 0),
        row({ _hf: 1e9 }, 0),
        row({ _hf: null, _lf: null }, 0),
        row({ _lf: 780, _hf: 780 }, 0), // LF/HF exactly 1.0 — the penalty threshold
        row({ _lf: 779, _hf: 780 }, 0), // just below — Math.max(0, …) arm
        row({ _lf: 781, _hf: 780 }, 0), // just above
        row({ _lf: 7800, _hf: 780 }, 0), // penalty large enough to drive camq to the 0 clamp
        row({ _lf: null }, 0),
        row({ _rmssd: null, _pnn50: null, _hf: null }, 0), // paraCount 0 → the 50 default
        row({ _rmssd: 1e9, _pnn50: 1e9, _hf: 1e9, _lf: 0 }, 0)
      ];
      return cases.map((c) => call(s0.bare.computeCAMQ, [c]));
    }
  }
];

/* ══ REGISTERING WHAT THE PROBES ALREADY RUN (tools/probe-reach.mjs) ═════════════════════════
   `probe-coverage` said this battery claimed a minority of the file's survivors. The tempting
   reading — "the batteries are too narrow" — is refuted by `probe-reach`, which counts which
   functions each probe actually EXECUTES and reports for this file:

       NAMED, NOT REACHED   0

   The inputs were never the problem. These functions were already being called; nothing claimed
   their survivors, because a family reports only on mutants inside the line range of the `fn` it
   NAMES. Each is registered under the probe that most exercises it — a survivor needs only ONE
   family to claim it, so naming more would re-run the same fingerprints for nothing.

   ⚠️ Registration is not classification. Each family must still separate its own controls, and one
   whose probe reaches a function without its OUTPUT depending on it will report BLIND and void —
   correctly. This removes the cheapest reason for a blind family, nothing more. */
const REACHED = {
  computeDerived: ['setHooks', 'utcDayKey', '_all', '_hrvIsAllNight', 'mean', 'std', 'pearsonCorr', 'linRegSlope'],
  _hrvParseSummaryRows: ['numOrNull', '_firstNum'],
  hrvEventsFromRows: ['_hrvClockS']
};

export const families = BASE_FAMILIES.concat(
  Object.entries(REACHED).flatMap(([host, fns]) => {
    const src = BASE_FAMILIES.find((f) => f.fn === host);
    if (!src) return [];
    return fns.map((fn) => ({ name: `${fn} · via the ${host} probe (registered, not re-run)`, fn, probe: src.probe }));
  })
);
