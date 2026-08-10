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
 * RE-SWEEP after the genSynthetic + locateColumns bootstraps: 835 tested, 314 killed, 5 invalid,
 * 516 survivors, `canary: PASSED`. With 48 recorded equivalents the DISTINGUISHABLE rate is
 * 314/782 = 40.2 %, up from 34.7 %.
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

  /* ⚠️ EVERY CASE ABOVE DATES ITS ROWS `2026-07-01` — ISO, and therefore UNAMBIGUOUS. So none of them
     reaches the file-level DMY/MDY resolution at all, and the control that mutates it
     (`if (c.length < 2 || !c[ci.date]) continue`, the loop that BUILDS `nutStamps`) read as
     equivalent: with the `!` dropped the array comes out empty, `_ckResolveDMY([], false)` falls back
     to the same MDY default an all-ISO file was already getting, and the output does not move.

     A parser can only be caught mis-resolving an order when the input HAS an order to resolve. */
  const R2 = (d) => [d, '08:12', 'Breakfast', '420', '31', '38'];
  const H2 = ['Date', 'Time', 'Group', 'Energy', 'Net carbs', 'Carbs'];
  // Ambiguous days only ⇒ nothing proves DMY ⇒ the MDY tiebreaker stands.
  NUT_CASES.push(nut(H2, [R2('05/07/2026'), R2('06/07/2026'), R2('07/07/2026')]));
  // One day > 12 PROVES DMY and locks it for the file — so 05/07 becomes 5 July, not 7 May.
  NUT_CASES.push(nut(H2, [R2('05/07/2026'), R2('13/07/2026'), R2('06/07/2026')]));
  // Same proof arriving LAST: the lock must be resolved from the whole file, not the first row.
  NUT_CASES.push(nut(H2, [R2('05/07/2026'), R2('06/07/2026'), R2('25/07/2026')]));
  // A row with an EMPTY date cell among dated ones — the other half of that `continue`.
  NUT_CASES.push(nut(H2, [R2('05/07/2026'), ['', '09:00', 'Snack', '120', '9', '11'], R2('13/07/2026')]));
  // Date-only cells (no time column populated) still have to resolve an order.
  NUT_CASES.push(
    nut(
      ['Date', 'Energy', 'Carbs'],
      [
        ['05/07/2026', '420', '38'],
        ['13/07/2026', '650', '61']
      ]
    )
  );
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
      /* ⚠️ THE FIRST VERSION OF THIS FAMILY MEASURED NOTHING, and it looked thorough while doing it.
         It stamped rows `M-D-YYYY HH:MM` — DASH-separated. That is not one of the Clock Contract §2.4
         vendor formats (which are slash-separated) and not ISO, so `_ckParse` returned null for EVERY
         row, every row hit the `if (!isFinite(ms)) continue`, and `parseCSV` threw the SAME
         "Parsed only 0 valid readings" for all nine of its supposedly-different CSVs. Fourteen inputs
         collapsed to FOUR distinct answers and five controls read as equivalent.

         The tell was in the probe output — `battery 14 inputs, 4 distinct answers` — and the cause was
         not a narrow battery. It was that NOT ONE INPUT REACHED THE CODE BEING MUTATED. Verified by
         executing the real `parseCSV` against four candidate formats before writing a line of this:
         dash M-D-YYYY → 0 rows; MM/DD/YYYY, ISO and DD/MM/YYYY → 300 rows each.

         Every mutant below sits AFTER a successful parse, so each needs a CSV that survives the
         `T.length < 10` throw. That floor is why "add more malformed inputs" was the wrong instinct:
         malformed inputs all land on the same exception. */
      const p2 = (x) => String(x).padStart(2, '0');
      const ISO = (t) => `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
      const MDY = (t) => `${p2(t.getUTCMonth() + 1)}/${p2(t.getUTCDate())}/${t.getUTCFullYear()} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
      const DMY = (t) => `${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
      const rows = (n, { stamp = MDY, hdr = 'Device Timestamp,Historic Glucose mg/dL', val = (i) => String(100 + (i % 40)), sep = ',', day0 = 1 } = {}) => {
        const L = [hdr];
        for (let i = 0; i < n; i++) {
          const t = new Date(Date.UTC(2026, 6, day0, 0, 0, 0) + i * 300000);
          L.push(stamp(t) + sep + val(i));
        }
        return L.join(sep === ',' ? '\n' : '\n');
      };

      /* The `T.length < 10` throw boundary, from both sides — 9 rows throws, 10 parses. */
      for (const n of [0, 1, 2, 9, 10, 300]) out.push(call(G.parseCSV, [rows(n)]));

      /* All three accepted stamp shapes, each of which must now actually parse. */
      out.push(call(G.parseCSV, [rows(300, { stamp: ISO })]));
      out.push(call(G.parseCSV, [rows(300, { stamp: DMY })])); // ambiguous days ⇒ MDY tiebreaker
      /* ── THE FILE-LEVEL DMY LOCK, which needed two attempts to test ────────────────────────────
         First attempt: `rows(300, {stamp: DMY, day0: 13})`. It reads like a lock test and is not one.
         300 rows at 5-minute cadence span ~25 h, so with day0=13 EVERY row is dated the 13th or 14th
         — every row is self-unambiguous, `_ckParse` resolves each one correctly on its own, and the
         file-level lock changes nothing. The control that empties `tsStamps` stayed blind.

         The lock only has an observable effect on rows that CANNOT resolve themselves. So the shape
         that catches it is a file of AMBIGUOUS days (≤ 12) containing ONE proving row (> 12): the
         proof has to travel from that row to all the others. Without the lock the ambiguous rows fall
         to the MDY tiebreaker and land in a different month entirely. */
      out.push(call(G.parseCSV, [rows(300, { stamp: DMY, day0: 13 })])); // all rows self-unambiguous
      {
        const amb = rows(300, { stamp: DMY, day0: 5 }).split('\n'); // 05–06 July: ambiguous either way
        amb.splice(150, 0, '13/07/2026 04:00,118'); // the single row that PROVES DMY for the file
        out.push(call(G.parseCSV, [amb.join('\n')]));
      }

      /* The unit branch: median < 30 ⇒ mmol/L ⇒ every value multiplied. Needs a REAL parse. */
      out.push(call(G.parseCSV, [rows(300, { hdr: 'Device Timestamp,Historic Glucose mmol/L', val: (i) => ((100 + (i % 40)) / 18).toFixed(1) })]));
      /* …and both sides of that threshold, since `med < 30` is a mutation target. */
      out.push(call(G.parseCSV, [rows(300, { val: () => '29' })]));
      out.push(call(G.parseCSV, [rows(300, { val: () => '31' })]));

      /* European decimal comma with a `;` delimiter — the `.replace(',', '.')` on gRaw. */
      out.push(call(G.parseCSV, [rows(300, { sep: ';', hdr: 'Device Timestamp;Historic Glucose mmol/L', val: (i) => String(((100 + (i % 40)) / 18).toFixed(1)).replace('.', ',') })]));
      /* Quoted values — the `^["']|["']$` strip. */
      out.push(call(G.parseCSV, [rows(300, { val: (i) => `"${100 + (i % 40)}"` })]));
      /* TAB-delimited. */
      out.push(call(G.parseCSV, [rows(300, { sep: '\t', hdr: 'Device Timestamp\tHistoric Glucose mg/dL' })]));
      out.push(call(G.parseCSV, [rows(300, { hdr: 'Timestamp,Glucose' })]));
      out.push(call(G.parseCSV, [rows(300).replace(/\n/g, '\r\n')]));

      /* NON-NUMERIC rows interleaved among good ones — the `if (!isFinite(g)) continue` whose dropped
         `!` inverts which rows survive. With the good rows present, the two answers differ; with only
         bad rows both throw and the mutant is invisible. That asymmetry is why this case exists. */
      {
        const good = rows(300).split('\n');
        const mixed = [good[0]];
        for (let i = 1; i < good.length; i++) {
          mixed.push(good[i]);
          if (i % 10 === 0) mixed.push(good[i].replace(/,[\d."]+$/, ',Low'));
        }
        out.push(call(G.parseCSV, [mixed.join('\n')]));
      }
      /* Rows whose GLUCOSE parses but whose STAMP does not — isolates the second `continue`. */
      out.push(
        call(G.parseCSV, [
          rows(300)
            .split('\n')
            .map((l, i) => (i > 0 && i % 7 === 0 ? l.replace(/^[^,]+/, 'not-a-date') : l))
            .join('\n')
        ])
      );
      /* RAGGED rows — `gCol >= cells.length`. */
      out.push(
        call(G.parseCSV, [
          rows(300)
            .split('\n')
            .map((l, i) => (i > 0 && i % 5 === 0 ? l.split(',')[0] : l))
            .join('\n')
        ])
      );
      /* NEWEST-FIRST — vendors export descending; exercises the index sort. */
      out.push(call(G.parseCSV, [[rows(300).split('\n')[0]].concat(rows(300).split('\n').slice(1).reverse()).join('\n')]));
      /* Blank lines scattered through — the `trim().length` filter. */
      out.push(call(G.parseCSV, [rows(300).split('\n').join('\n\n')]));

      for (const raw of ['', 'one line', 'a,b\n1,2', null, undefined]) out.push(call(G.parseCSV, [raw]));
      return out;
    }
  }
];
