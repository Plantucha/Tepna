/*
 * tools/probe-batteries/glucodex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE glucodex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * Full sweep 2026-08-10: 836 tested, 280 killed, 5 invalid, 551 survivors → 33.7 %, `canary: NONE`.
 *
 * ⚠️ THE FLEET MAP'S ROW FOR THIS FILE IS WRONG. It reported 55 % from a 60-mutant sample (33/60);
 * the population is 33.7 %. One standard error on a 60-draw at this rate is 6.1 points, so 55 % sits
 * 3.5 SE away — not sampling noise. Three earlier files had confirmed the sampling method
 * (ppgdex 33→34.0, motiondex 37→37.3, cpapdex 40→40.4) and glucodex is the first to refute it. Quote
 * 33.7 %, and treat the map's other unswept rows as estimates rather than measurements.
 *
 * ── EVERY CONTRACT HERE WAS READ FROM THE SOURCE, NOT INFERRED ───────────────────────────────
 * That sentence is in this header because the cpapdex battery cost two rounds by doing the opposite:
 * `oximetryLane` got `{channels:[…]}` when the code reads `rec.signals` keyed by name, and
 * `_synthEdfSet` got 19 invented option names when it reads exactly one. Both produced batteries that
 * measured nothing. So, read from the source:
 *
 *   genSynthetic(opts)           opts.days (14), opts.profile ('healthy' | 'predm'), opts.cadence (5)
 *   parseNutrition(text)         CSV/TSV; delimiter auto-detected; header matched by SUBSTRING
 *   detectClampSaturation(vals)  a flat numeric array; returns `empty` when n < 20
 *   parseCSV(text) · coreMetrics(vals) · analyze(parsed, progress, opts)
 *
 * ── WHERE THE SURVIVORS ARE ──────────────────────────────────────────────────────────────────
 *   90  genSynthetic           public
 *   62  clean                  not exported — reached through analyze()
 *   46  parseNutrition         public
 *   35  detectClampSaturation  public
 *   30  locateColumns          not exported — reached through parseCSV()
 *   24  postprandial · 20 detectSessions · 19 _ckMk · 18 excursions · 13 dawnPhenomenon
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
    setTimeout,
    clearTimeout,
    Promise,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  return ctx;
}

export function subject(ctx) {
  const G = ctx.GLUDSP;
  return G && typeof G.detectClampSaturation === 'function' ? G : null;
}

function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 'N:' + String(x);
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[cyc]';
    seen.add(x);
    if (ArrayBuffer.isView(x)) return ['TA', x.length, Array.from(x.slice(0, 12)).map(norm)];
    /* A long series is summarised rather than dropped — but the SUMMARY carries length, head, tail
       AND a checksum, because a head/tail-only digest collapses two different middles into one
       answer and would report a real difference as equivalence. */
    if (Array.isArray(x)) {
      if (x.length <= 40) return x.map(norm);
      let sum = 0;
      for (const e of x) sum = (sum * 31 + (typeof e === 'number' && Number.isFinite(e) ? Math.round(e * 1000) : 0)) % 2147483647;
      return ['A', x.length, x.slice(0, 12).map(norm), x.slice(-6).map(norm), sum];
    }
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

/* ── detectClampSaturation ────────────────────────────────────────────────────────────────────
   It contrasts the count AT the exact bound against the mean per-bin count just inside it, because a
   genuine tail THINS toward its extreme while a hardware clip PILES UP. The shipped bug it exists to
   catch is concrete: a real Abbott Lingo export railed at 54 mg/dL with 46 readings AT the floor
   against 15 and 14 beside it went undetected and shipped 37 unflagged nocturnal_hypo events at
   conf 0.97. So the cases below are that shape and its negation, plus the n<20 guard from both
   sides — nothing else in this function is reachable without them. */
function railed({ n = 300, floor = 54, atFloor = 46, inner = 15, base = 110 } = {}) {
  const v = [];
  for (let i = 0; i < atFloor; i++) v.push(floor);
  for (let i = 0; i < inner; i++) v.push(floor + 1);
  for (let i = 0; i < inner; i++) v.push(floor + 2);
  while (v.length < n) v.push(base + ((v.length * 7) % 40));
  return v;
}
function thinningTail({ n = 300, floor = 54, base = 110 } = {}) {
  const v = [];
  for (let k = 0; k < 12; k++) for (let i = 0; i < Math.max(1, 12 - k); i++) v.push(floor + k);
  while (v.length < n) v.push(base + ((v.length * 7) % 40));
  return v;
}
const CLAMP_CASES = [];
{
  for (const n of [0, 1, 19, 20, 21, 300]) CLAMP_CASES.push(railed({ n }));
  for (const atFloor of [0, 1, 14, 15, 16, 46, 200]) CLAMP_CASES.push(railed({ atFloor }));
  for (const inner of [0, 1, 15, 45, 46]) CLAMP_CASES.push(railed({ inner }));
  CLAMP_CASES.push(thinningTail({}));
  CLAMP_CASES.push(railed({ floor: 40 }));
  CLAMP_CASES.push(railed({ floor: 400, base: 60 })); // a CEILING rail rather than a floor
  CLAMP_CASES.push(new Array(300).fill(100)); // every value identical ⇒ hi <= lo
  CLAMP_CASES.push(new Array(300).fill(0).map((_, i) => (i % 2 ? NaN : 100))); // half non-finite
  CLAMP_CASES.push(new Array(300).fill(NaN)); // wholly non-finite ⇒ lo/hi never set
  CLAMP_CASES.push([54, 54, 54]);
  CLAMP_CASES.push([]);
  CLAMP_CASES.push(null);
  CLAMP_CASES.push(undefined);
}

/* ── parseNutrition ──────────────────────────────────────────────────────────────────────────
   Header columns are matched by SUBSTRING (`h.includes('date')`), `net carb` is matched before
   `carbs`, and the delimiter is auto-detected — so the branches are about header WORDING and
   separator, not about row values. Hence the header variants below. */
const nut = (header, rows, delim = ',') => [header.join(delim)].concat(rows.map((r) => r.join(delim))).join('\n');
const NUT_CASES = [];
{
  const R = [
    ['2026-07-01', '08:12', 'Breakfast', '420', '31', '38'],
    ['2026-07-01', '13:05', 'Lunch', '650', '54', '61'],
    ['2026-07-01', '19:40', 'Dinner', '780', '66', '72']
  ];
  NUT_CASES.push(nut(['Date', 'Time', 'Group', 'Energy', 'Net carbs', 'Carbs'], R));
  NUT_CASES.push(nut(['date', 'time', 'group', 'kcal', 'net carb', 'carbohydrate'], R));
  NUT_CASES.push(nut(['Day', 'Time', 'Group', 'Calories', 'Carbs', 'Net carbs'], R)); // order swapped
  NUT_CASES.push(
    nut(
      ['Date', 'Time', 'Group', 'Energy', 'Carbs'],
      R.map((r) => r.slice(0, 5))
    )
  ); // no net-carb column
  NUT_CASES.push(
    nut(
      ['Date', 'Time', 'Group', 'Energy', 'Net carbs'],
      R.map((r) => r.slice(0, 5))
    )
  ); // no plain carbs
  NUT_CASES.push(nut(['Date', 'Time', 'Group', 'Energy', 'Net carbs', 'Carbs'], R, '\t')); // TSV
  NUT_CASES.push(nut(['Date', 'Time', 'Group', 'Energy', 'Net carbs', 'Carbs'], R, ';'));
  NUT_CASES.push(nut(['Date'], [['2026-07-01']])); // one column, minimum rows
  NUT_CASES.push('Date,Time\n"2026-07-01","08:12"'); // quoted fields
  NUT_CASES.push('Date,Time\n"a,b",08:12'); // a delimiter INSIDE quotes
  NUT_CASES.push(nut(['Nope', 'Nada'], [['1', '2']])); // no recognised column at all
  NUT_CASES.push('Date,Time,Group,Energy\r\n2026-07-01,08:12,Breakfast,420'); // CRLF
  NUT_CASES.push('only one line');
  NUT_CASES.push('');
  NUT_CASES.push('\n\n');
}

export const families = [
  {
    name: 'genSynthetic · the generator (90 survivors)',
    fn: 'genSynthetic',
    probe: (G) => {
      const out = [];
      /* THE THREE OPTIONS IT ACTUALLY READS — days, profile, cadence. Both profiles matter: they
         switch base, dawn amplitude, three meal peaks and the decay constant, so a battery on one
         profile leaves every one of those constants unexercised. */
      for (const profile of ['healthy', 'predm', undefined, null, 'nonsense'])
        for (const days of [1, 2, 14]) for (const cadence of [1, 5, 15]) out.push(call(G.genSynthetic, [{ profile, days, cadence }]));
      for (const o of [undefined, {}, { days: 0 }, { cadence: 0 }, { days: -1 }, { cadence: -5 }, { days: 0.5 }, { cadence: 1440 }]) out.push(call(G.genSynthetic, [o]));
      return out;
    }
  },
  {
    name: 'detectClampSaturation · the rail detector (35 survivors)',
    fn: 'detectClampSaturation',
    probe: (G) => CLAMP_CASES.map((v) => call(G.detectClampSaturation, [v]))
  },
  {
    name: 'parseNutrition · header + delimiter (46 survivors)',
    fn: 'parseNutrition',
    probe: (G) => NUT_CASES.map((t) => call(G.parseNutrition, [t]))
  },
  {
    name: 'coreMetrics · the metric block',
    fn: 'coreMetrics',
    probe: (G) => {
      const out = [];
      const flat = (n, v) => new Array(n).fill(v);
      /* TIR_CUT is the published band; only values ON each cut separate a `<` from a `<=`. */
      for (const v of [54, 69, 70, 71, 100, 179, 180, 181, 250, 251]) out.push(call(G.coreMetrics, [flat(300, v)]));
      out.push(call(G.coreMetrics, [flat(300, 0).map((_, i) => 40 + i)])); // a full sweep across every band
      out.push(call(G.coreMetrics, [[]]));
      out.push(call(G.coreMetrics, [flat(19, 100)]));
      out.push(call(G.coreMetrics, [flat(300, NaN)]));
      out.push(call(G.coreMetrics, [flat(300, 100).map((v, i) => (i % 7 ? v : NaN))]));
      out.push(call(G.coreMetrics, [null]));
      return out;
    }
  },
  {
    name: 'parseCSV · CGM ingest (reaches locateColumns)',
    fn: 'parseCSV',
    probe: (G) => {
      const out = [];
      const rows = (n, { hdr = 'Device Timestamp,Historic Glucose mg/dL', mgdl = true, start = 0 } = {}) => {
        const L = [hdr];
        for (let i = 0; i < n; i++) {
          const t = new Date(Date.UTC(2026, 6, 1, 0, 0, 0) + (start + i) * 300000);
          const stamp = `${t.getUTCMonth() + 1}-${t.getUTCDate()}-${t.getUTCFullYear()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
          L.push(`${stamp},${mgdl ? 100 + (i % 40) : (100 + (i % 40)) / 18}`);
        }
        return L.join('\n');
      };
      for (const n of [0, 1, 2, 20, 300]) out.push(call(G.parseCSV, [rows(n)]));
      out.push(call(G.parseCSV, [rows(300, { mgdl: false, hdr: 'Device Timestamp,Historic Glucose mmol/L' })])); // the UNIT branch
      out.push(call(G.parseCSV, [rows(300, { hdr: 'Timestamp,Glucose' })]));
      out.push(call(G.parseCSV, [rows(300).replace(/,/g, ';')]));
      out.push(call(G.parseCSV, [rows(300).replace(/\n/g, '\r\n')]));
      for (const raw of ['', 'one line', 'a,b\n1,2', null, undefined]) out.push(call(G.parseCSV, [raw]));
      return out;
    }
  }
];
