/*
 * tools/probe-batteries/cpapdex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE cpapdex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * Full sweep 2026-08-09: 819 tested, 331 killed, 0 invalid, 488 survivors → 40.4 %. ⚠️ `canary: NONE`
 * (unguarded). The fleet map's 60-mutant SAMPLE predicted 40 % and the population came back 40.4 % —
 * the third file where sampling held (ppgdex 33→34.0, motiondex 37→37.3).
 *
 * `JS-DSP-MUTATION-FLEET` called this "the least trustworthy number in the table" because cpapdex has
 * the fleet's narrowest tag — 8 groups, of which 3 kill anything — against the third-largest file, so
 * "the killers are outside the tag" was a live hypothesis. IT IS NOT THE EXPLANATION. The tag is
 * narrow because the TESTS are narrow, not because the surface is:
 *
 *   `CPAPDex` publishes only compute / buildNightFromSets / _synthEdfSet — which LOOKS surface-bound
 *   like ppgdex. But `CpapDsp` publishes 26 functions including prepare, computeMetrics, leakSqi,
 *   chan, leakToLpm, classifyMode, selfGateDesat, detectDesats, oximetryLane, detectBreaths,
 *   eveEvents, periodicBreathingSec/Spans, buildSession/Night/Longitudinal.
 *
 * So this is the HRVDEX shape, not the ppgdex one: the handle already exists and nothing was using
 * it. No source change is needed to probe any of it.
 *
 * ── WHERE THE SURVIVORS ARE, and one of them is a programme decision ─────────────────────────
 *   132 (27 %)  selfTest            the module's OWN self-test. NOT probed here — see below.
 *    57         _synthEdfSet        the synthetic EDF generator (public)
 *    46         nightMetrics        not exported
 *    44         buildSessionFromEdf not exported
 *    28         selfGateDesat       public — the artifact veto on a desaturation
 *    20         _nightFromInput     public as buildNightFromSets
 *    18         oximetryLane        public
 *    14         detectBreaths       public
 *     9         detectDesats        public
 *
 * ⚠️ `selfTest` IS DELIBERATELY NOT A FAMILY, and this is a judgement worth stating rather than a
 * gap. It is diagnostic scaffolding that checks the module; killing its mutants means asserting on
 * the internals of a self-check, which pins the CHECKER rather than the analysis. That is the same
 * trade `RUN-POLAR-MUTATION-STOP-HERE` §4 refuses for tuning constants and the suite refuses for
 * message wording. 27 % of this file's survivors are in it, so any future "cpapdex is only 40 %"
 * claim should carry that denominator note.
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
    Int16Array,
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
  const D = ctx.CpapDsp;
  return D && typeof D.detectDesats === 'function' ? D : null;
}

function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 'N:' + String(x);
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[cyc]';
    seen.add(x);
    if (ArrayBuffer.isView(x)) return ['TA', x.length, Array.from(x.slice(0, 12)).map(norm)];
    if (Array.isArray(x)) return x.length > 40 ? [x.length, x.slice(0, 20).map(norm), x.slice(-8).map(norm)] : x.map(norm);
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = norm(x[k]);
    return o;
  };
  try {
    const out = JSON.stringify(norm(v));
    /* JSON.stringify(undefined) returns UNDEFINED, and several of these mutate-and-return-nothing. */
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

/* ── SpO₂ series built to cross the detector's OWN thresholds ────────────────────────────────
   `detectDesats` gates on a drop from a rolling baseline, a minimum duration, and a validity test.
   A series of plausible saturations exercises none of those edges, so each shape here is aimed at
   one: exactly-at-threshold, one-below, one-sample-short, and the invalid sentinel. */
function spo2Series({ n = 600, base = 96, drop = 0, at = 200, dur = 30, invalidFrom = -1 } = {}) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = base;
    if (drop && i >= at && i < at + dur) v = base - drop;
    if (invalidFrom >= 0 && i >= invalidFrom) v = 0; // 0 is the absent/invalid sentinel
    a[i] = v;
  }
  return a;
}
const pulseSeries = ({ n = 600, bpm = 58, spikeAt = -1, spike = 0 } = {}) => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = spikeAt >= 0 && i >= spikeAt && i < spikeAt + 20 ? bpm + spike : bpm;
  return a;
};

const DESAT_CASES = [];
{
  for (const drop of [0, 2, 3, 4, 5, 10, 20]) for (const dur of [1, 9, 10, 11, 30, 120]) DESAT_CASES.push([spo2Series({ drop, at: 200, dur }), undefined]);
  /* The `drop` ARGUMENT defaults to OXI.DROP — passing it explicitly, including 0 and a negative,
     separates the `drop || DEFAULT` fallback from its mutants. */
  for (const d of [undefined, null, 0, 1, 3, 4, 100, -1, NaN]) DESAT_CASES.push([spo2Series({ drop: 5, dur: 40 }), d]);
  DESAT_CASES.push([spo2Series({ n: 0 }), undefined]);
  DESAT_CASES.push([spo2Series({ n: 1 }), undefined]);
  DESAT_CASES.push([spo2Series({ invalidFrom: 0 }), undefined]); // wholly invalid
  DESAT_CASES.push([spo2Series({ drop: 6, dur: 40, invalidFrom: 300 }), undefined]); // invalid mid-event
  DESAT_CASES.push([spo2Series({ base: 100 }), undefined]);
  DESAT_CASES.push([spo2Series({ base: 70 }), undefined]); // permanently low
  DESAT_CASES.push([new Float32Array([96, 96, 90, 90, 96]), undefined]);
  DESAT_CASES.push([[], undefined]);
}

export const families = [
  {
    name: 'detectDesats · the desaturation detector',
    fn: 'detectDesats',
    probe: (D) => DESAT_CASES.map(([a, d]) => call(D.detectDesats, [a, d]))
  },
  {
    name: 'selfGateDesat · the artifact veto (28 survivors)',
    fn: 'selfGateDesat',
    probe: (D) => {
      const out = [];
      const sp = spo2Series({ drop: 6, at: 200, dur: 40 });
      /* The veto reads onset/nadirIdx/endIdx with `!= null` fallbacks, so each must appear PRESENT,
         ABSENT and null — a fixture carrying all three fields exercises none of the fallbacks. */
      const shapes = [
        { onset: 200, nadirIdx: 220, endIdx: 240 },
        { startIdx: 200, nadirIdx: 220, endIdx: 240 },
        { startIdx: 200 },
        { onset: 200, nadirIdx: null, endIdx: null },
        { onset: null, nadirIdx: 220, endIdx: 240 },
        { onset: 0, nadirIdx: 0, endIdx: 0 },
        { onset: 599, nadirIdx: 599, endIdx: 599 },
        {}
      ];
      for (const sh of shapes)
        for (const pulse of [pulseSeries(), pulseSeries({ spikeAt: 200, spike: 25 }), pulseSeries({ spikeAt: 200, spike: -25 }), new Float32Array(0), null, undefined])
          out.push(call(D.selfGateDesat, [Object.assign({}, sh), pulse, sp]));
      for (const bad of [null, undefined, false, 0]) out.push(call(D.selfGateDesat, [bad, pulseSeries(), sp]));
      return out;
    }
  },
  {
    name: 'oximetryLane · coverage + the lane verdict',
    fn: 'oximetryLane',
    probe: (D) => {
      const out = [];
      const set = (spo2, pulse) => ({
        channels: [
          { label: 'SpO2', data: spo2, fs: 1 },
          { label: 'Pulse', data: pulse || new Float32Array(spo2.length), fs: 1 }
        ]
      });
      for (const c of [
        set(spo2Series({})),
        set(spo2Series({ drop: 6, dur: 40 })),
        set(spo2Series({ invalidFrom: 0 })), // zero coverage
        set(spo2Series({ invalidFrom: 300 })), // half coverage — the threshold's own edge
        set(spo2Series({ invalidFrom: 599 })),
        set(new Float32Array(0)),
        { channels: [{ label: 'Pulse', data: pulseSeries(), fs: 1 }] }, // no SpO2 channel at all
        { channels: [] },
        { channels: [{ label: 'SpO2', data: null, fs: 1 }] },
        {},
        null
      ])
        for (const dur of [600, 60, 1, 0, undefined]) out.push(call(D.oximetryLane, [c, dur]));
      return out;
    }
  },
  {
    name: 'detectBreaths · flow → breath count',
    fn: 'detectBreaths',
    probe: (D) => {
      const out = [];
      /* `noise` is 15 % of mean |flow|, so amplitude relative to that floor is the branch — a
         sinusoid at, just above and just below it separates the threshold from its mutants. */
      const flow = (n, fs, amp, hz) => {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / fs);
        return { data: a, fs };
      };
      for (const amp of [0, 0.01, 0.5, 5, 50]) for (const hz of [0.05, 0.2, 0.25, 0.5, 1]) out.push(call(D.detectBreaths, [flow(1500, 25, amp, hz), 60]));
      for (const fs of [1, 25, 50, undefined]) out.push(call(D.detectBreaths, [{ data: flow(500, 25, 5, 0.25).data, fs }, 20]));
      for (const bad of [null, undefined, {}, { data: null }, { data: new Float32Array(0) }, { data: [1, -1, 1, -1] }]) out.push(call(D.detectBreaths, [bad, 60]));
      for (const dur of [0, 1, 600, undefined, null]) out.push(call(D.detectBreaths, [flow(1500, 25, 5, 0.25), dur]));
      return out;
    }
  },
  {
    name: 'computeMetrics + leakSqi · the metric block',
    fn: 'computeMetrics',
    probe: (D) => {
      const out = [];
      for (const uh of [0, 3.99, 4, 4.01, 8, null, undefined, NaN, -1]) for (const fs of [1, 25, 0, null]) out.push(call(D.computeMetrics, [{ usageHours: uh, fs }]));
      for (const d of [{}, null, undefined, { usageHours: 7 }, { fs: 25 }]) out.push(call(D.computeMetrics, [d]));
      /* leakSqi clamps `1 − largeLeakPct/100` into [0,1]; only 0, exactly 100 and beyond show the clamp. */
      for (const ll of [null, undefined, NaN, 0, 1, 50, 99, 100, 101, 250, -5]) out.push(call(D.leakSqi, [{ largeLeakPct: ll }]));
      out.push(call(D.leakSqi, [{}]));
      return out;
    }
  },
  {
    name: '_synthEdfSet · the synthetic generator (57 survivors)',
    fn: '_synthEdfSet',
    probe: (D) => {
      const out = [];
      for (const o of [
        undefined,
        {},
        { seed: 1 },
        { seed: 2 },
        { ahi: 0 },
        { ahi: 5 },
        { ahi: 30 },
        { ahi: 60 },
        { leak: 0 },
        { leak: 24 },
        { leak: 60 },
        { records: 1 },
        { records: 10 },
        { records: 0 },
        { mode: 'CPAP' },
        { mode: 'APAP' },
        { mode: 'ASV' },
        { csr: true },
        { csr: false }
      ])
        out.push(call(D._synthEdfSet, [o]));
      return out;
    }
  }
];
