/*
 * tools/probe-batteries/pulsedex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE pulsedex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * Full sweep 2026-08-10: 568 tested, 144 killed, 3 invalid, 421 survivors → 25.5 %, `canary: NONE`.
 *
 * ⚠️ THAT IS THE LOWEST MEASURED RATE IN THE FLEET, and the fleet map had it at 42 % — the second of
 * two sampling failures, both overestimates (glucodex: 55 % sampled vs 33.7 % measured). See the
 * brief's §3 correction: the sampling error is bimodal, not noisy, and flatters the file both times.
 *
 * ── THE HANDLE ALREADY EXISTS ────────────────────────────────────────────────────────────────
 * `PulseDex._bare` exposes 70 names, and ALL NINE of the largest survivor clusters are among them.
 * Like hrvdex and cpapdex — and unlike ppgdex — nothing needs exporting to probe this file; the
 * tests simply never called any of it.
 *
 *   54  compareIntervalSeries     41  parseRRInput          26  pdEventsFromResult
 *   25  lineChartSVG              24  lombScargle           23  classifyRecording
 *   21  periodicBreathingIndex    19  fragmentation         17  pdComputeResult
 *
 * ── CONTRACTS, READ FROM SOURCE ──────────────────────────────────────────────────────────────
 *   compareIntervalSeries(primary, reference)  each is `{vals, tsMs?}`; needs ≥5 CLEAN intervals in
 *                                              each after artifactClean, else an `error` object
 *   parseRRInput(raw, opts)                    opts.preferDMY (default TRUE); the delimited branch
 *                                              needs ≥2 lines carrying `;`/TAB *and* a clock/ISO stamp
 *   periodicBreathingIndex(a) · fragmentation(a) · lombScargle(a, nf)   a = NN intervals in ms
 *   classifyRecording(a, t0Ms, durSec) · lineChartSVG(pts, color, medVal)
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
  const P = ctx.PulseDex;
  return P && P._bare && typeof P._bare.fragmentation === 'function' ? P._bare : null;
}

function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 'N:' + String(x);
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[cyc]';
    seen.add(x);
    if (ArrayBuffer.isView(x)) return ['TA', x.length, Array.from(x.slice(0, 12)).map(norm)];
    if (Array.isArray(x)) {
      if (x.length <= 40) return x.map(norm);
      /* head+tail alone collapses two different middles into one answer; the checksum keeps a
         mid-series difference visible. */
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

/* NN-interval series in ms. Each shape targets a named branch rather than being "realistic": a
   plausible resting series exercises no guard in this file. */
const T0 = Date.UTC(2026, 6, 1, 23, 0, 0);
function nn(n, { base = 1000, amp = 0, hz = 0, jitter = 0, ectopicAt = -1 } = {}) {
  const a = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    let v = base + (amp ? amp * Math.sin(2 * Math.PI * hz * (t / 1000)) : 0) + (jitter ? (((i * 7919) % 100) / 100 - 0.5) * 2 * jitter : 0);
    if (ectopicAt >= 0 && i === ectopicAt) v = base * 0.4; // a premature beat artifactClean should drop
    a.push(v);
    t += v;
  }
  return a;
}
const SERIES = [
  nn(0),
  nn(1),
  nn(4), // one under the ≥5 floor
  nn(5), // exactly on it
  nn(6),
  nn(300),
  nn(300, { amp: 60, hz: 0.25 }), // respiratory band
  nn(300, { amp: 60, hz: 0.02 }), // periodic-breathing band
  nn(300, { amp: 200, hz: 0.01 }), // strong slow oscillation
  nn(300, { jitter: 120 }), // high variability
  nn(300, { jitter: 0 }), // perfectly flat — zero variability
  nn(300, { ectopicAt: 150 }),
  nn(300, { base: 400 }), // tachycardic
  nn(300, { base: 2000 }), // bradycardic
  new Array(300).fill(NaN),
  new Array(300).fill(0),
  [1000, 1000, NaN, 1000, 1000, 1000],
  null,
  undefined
];

export const families = [
  {
    name: 'compareIntervalSeries · two-signal agreement (54 survivors)',
    fn: 'compareIntervalSeries',
    probe: (B) => {
      const out = [];
      const wrap = (vals, withTs) => {
        if (!vals) return vals;
        const o = { vals };
        if (withTs) {
          let acc = T0;
          o.tsMs = vals.map((v) => (acc += v));
        }
        return o;
      };
      /* The ≥5-CLEAN-intervals floor is checked from both sides, and `endTs` has two branches — an
         absolute tsMs of matching length, or a cumulative fallback — so each pairing appears with
         and without stamps, and once with a MISMATCHED tsMs length to force the fallback. */
      const A = nn(300, { amp: 60, hz: 0.25 });
      const B2 = nn(300, { amp: 60, hz: 0.25, jitter: 8 });
      for (const withTs of [false, true]) {
        out.push(call(B.compareIntervalSeries, [wrap(A, withTs), wrap(B2, withTs)]));
        out.push(call(B.compareIntervalSeries, [wrap(A, withTs), wrap(A, withTs)])); // identical
        out.push(call(B.compareIntervalSeries, [wrap(A, withTs), wrap(nn(300, { base: 700 }), withTs)])); // offset
        out.push(call(B.compareIntervalSeries, [wrap(nn(4), withTs), wrap(A, withTs)])); // under the floor
        out.push(call(B.compareIntervalSeries, [wrap(nn(5), withTs), wrap(nn(5), withTs)])); // exactly on it
        out.push(call(B.compareIntervalSeries, [wrap(A, withTs), wrap(nn(120), withTs)])); // different lengths
      }
      out.push(call(B.compareIntervalSeries, [{ vals: A, tsMs: [1, 2, 3] }, wrap(A, true)])); // tsMs length mismatch ⇒ cumulative
      out.push(call(B.compareIntervalSeries, [{ vals: A, tsMs: A.map(() => NaN) }, wrap(A, true)])); // non-finite tsMs[0]
      for (const bad of [null, undefined, {}, { vals: null }, { vals: [] }]) {
        out.push(call(B.compareIntervalSeries, [bad, wrap(A, false)]));
        out.push(call(B.compareIntervalSeries, [wrap(A, false), bad]));
      }
      return out;
    }
  },
  {
    name: 'parseRRInput · RR ingest (41 survivors)',
    fn: 'parseRRInput',
    probe: (B) => {
      const out = [];
      const bare = (n) => Array.from({ length: n }, (_, i) => String(1000 + (i % 40))).join('\n');
      const delim = (n, { sep = ';', stamp = 'iso' } = {}) =>
        Array.from({ length: n }, (_, i) => {
          const t = new Date(T0 + i * 1000);
          const ts =
            stamp === 'iso'
              ? t.toISOString().replace('T', ' ').replace('Z', '')
              : stamp === 'clock'
                ? `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`
                : `${t.getUTCDate()}/${t.getUTCMonth() + 1}/${t.getUTCFullYear()} 23:00:00`;
          return `${ts}${sep}${1000 + (i % 40)}`;
        }).join('\n');
      /* The delimited branch needs ≥2 lines with BOTH a `;`/TAB and a clock-or-ISO stamp — so 1 line
         and 2 lines are separate cases, and a delimited file with NO stamp must take the bare path. */
      for (const n of [0, 1, 2, 3, 50]) {
        out.push(call(B.parseRRInput, [bare(n), undefined]));
        out.push(call(B.parseRRInput, [delim(n), undefined]));
      }
      for (const sep of [';', '\t', ',']) out.push(call(B.parseRRInput, [delim(50, { sep }), undefined]));
      for (const stamp of ['iso', 'clock', 'dmy']) out.push(call(B.parseRRInput, [delim(50, { stamp }), undefined]));
      /* preferDMY defaults TRUE and only `=== false` turns it off — so `false`, `0` and `undefined`
         are three different things here and a truthiness mutant sees only one of them. */
      for (const o of [undefined, {}, { preferDMY: true }, { preferDMY: false }, { preferDMY: 0 }, { preferDMY: null }]) out.push(call(B.parseRRInput, [delim(50, { stamp: 'dmy' }), o]));
      out.push(call(B.parseRRInput, ['1000;2000\n1100;2100', undefined])); // delimited but NO timestamp
      for (const raw of ['', '\n', '   ', 'not a number', '1000', '1000\n1000', '1000\r\n1010\r\n1020']) out.push(call(B.parseRRInput, [raw, undefined]));
      return out;
    }
  },
  {
    name: 'fragmentation + periodicBreathingIndex · NN-series indices',
    fn: 'fragmentation',
    probe: (B) => {
      const out = [];
      for (const a of SERIES) out.push(call(B.fragmentation, [a]));
      for (const a of SERIES) out.push(call(B.periodicBreathingIndex, [a]));
      return out;
    }
  },
  {
    name: 'lombScargle · the spectrum',
    fn: 'lombScargle',
    probe: (B) => {
      const out = [];
      for (const a of SERIES) for (const nf of [undefined, 64, 128, 1, 0]) out.push(call(B.lombScargle, [a, nf]));
      return out;
    }
  },
  {
    name: 'classifyRecording · the recording verdict',
    fn: 'classifyRecording',
    probe: (B) => {
      const out = [];
      for (const a of SERIES) for (const dur of [30, 300, 3600, 28800, 0, undefined]) out.push(call(B.classifyRecording, [a, T0, dur]));
      for (const t0 of [T0, 0, null, NaN]) out.push(call(B.classifyRecording, [nn(300), t0, 300]));
      return out;
    }
  }
];
