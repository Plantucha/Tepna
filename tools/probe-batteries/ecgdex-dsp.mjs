/*
 * tools/probe-batteries/ecgdex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE ecgdex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * `ecgdex-dsp.js` is the second-largest file in the fleet (1755 mutants) and had NO battery at all,
 * so every one of its survivors was INVISIBLE to the prober — `probe-coverage` would report 0 %
 * claimable. This is the first one.
 *
 * ── WRITTEN AGAINST WHAT THE PROGRAMME HAS LEARNED, not from scratch ─────────────────────────
 *   · DIRECT families for exported leaves. #1148 measured the alternative: routing a leaf's probe
 *     through analyze() diluted `beatRegularity` to 0 of 6 controls separated, because the leaf's
 *     result is aggregated and rounded into the export before the fingerprint sees it.
 *   · ONE pipeline probe registered across the INTERNAL functions analyze() reaches, since those
 *     have no other door — and registered per-`fn`, because a family only ever reports on mutants
 *     inside the line range of the name it declares (#1139).
 *   · Contracts READ FROM SOURCE. The cpapdex battery cost two rounds by inventing three of them.
 *
 * ── THE FIXTURE IS THE MODULE'S OWN GENERATOR, AND IT IS DETERMINISTIC ───────────────────────
 * `genSynthetic(opts)` is seeded xorshift32 and returns a COMPLETE record —
 * `{int16, fs, gaps, t0Ms, source, durSec, deviceRR, deviceHR, deviceACC}` — so one call feeds the
 * waveform path AND the three device-stream validators. Verified: same seed ⇒ byte-identical, a
 * different seed ⇒ different signal, and 180 s analyzes in 118 ms.
 *
 * ⚠️ ITS ARTIFACT SPANS SIT AT t = 88 MINUTES. `genSynthetic` injects strap-shift / electrode-pop
 * noise at 88 min to exercise SQI, so ANY probe shorter than 5 280 s never reaches that code —
 * the same "the shape never gets there" failure that made parseCSV's fourteen inputs collapse to
 * four answers. One long case is included for exactly that, and it is why the long case exists.
 *
 * WHERE THE MUTANTS ARE (all 1755, attributed to their innermost enclosing function):
 *   269 genSynthetic · 117 analyze · 79 parseECGText · 67 accExtras · 58 _gait
 *    55 cardiorespCoupling · 55 validateHR · 53 detectCVHR · 52 computeSQI · 45 accAnalyze
 *    44 buildNN · 41 ecgCoverage · 40 ecgBuildNodeExport · 39 classifyMode · 33 stageSleep
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
    Int8Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    Uint16Array,
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
  const D = ctx.ECGDSP,
    A = ctx.ECGDex;
  if (!D && !A) return null;
  return { ECGDSP: D || {}, ECGDex: A || {} };
}

/* Stable stringify. A long series is SUMMARISED rather than dropped, but the summary carries length,
   head, tail AND a checksum — a head/tail digest collapses two different middles into one answer and
   would report a real difference as equivalence. */
function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 'N:' + String(x);
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[cyc]';
    seen.add(x);
    if (ArrayBuffer.isView(x)) {
      let sum = 0;
      for (let i = 0; i < x.length; i++) sum = (sum * 31 + (Number.isFinite(x[i]) ? Math.round(x[i] * 1000) : 0)) % 2147483647;
      return ['TA', x.length, Array.from(x.slice(0, 10)).map(norm), sum];
    }
    if (Array.isArray(x)) {
      if (x.length <= 40) return x.map(norm);
      let sum = 0;
      for (const e of x) sum = (sum * 31 + (typeof e === 'number' && Number.isFinite(e) ? Math.round(e * 1000) : 0)) % 2147483647;
      return ['A', x.length, x.slice(0, 10).map(norm), x.slice(-5).map(norm), sum];
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

/* ── FIXTURES ────────────────────────────────────────────────────────────────────────────────
   Built ONCE per probe process and reused: genSynthetic at 180 s costs ~33 ms and analyze ~118 ms,
   so rebuilding per family would dominate the run without adding a single distinction. */
let FX = null;
function fx(D) {
  if (FX) return FX;
  const gen = (o) => {
    try {
      return D.genSynthetic(o);
    } catch (e) {
      return { __err: String(e && e.message).slice(0, 60) };
    }
  };
  const rec = gen({ durSec: 180 });
  const ana = (r) => {
    try {
      return r && !r.__err ? D.analyze(r, null) : null;
    } catch (e) {
      return { __err: String(e && e.message).slice(0, 60) };
    }
  };
  const a = ana(rec);
  FX = {
    rec,
    ana: a,
    /* the beat-level primitives every leaf family needs, taken from ONE real analyze pass so they
       are internally consistent rather than invented */
    nn: (a && a.nn) || (a && a.nnAll) || [],
    peaks: (a && a.peaks) || [],
    devHR: rec.deviceHR || [],
    devRR: rec.deviceRR || [],
    devACC: rec.deviceACC || [],
    epochs: (a && a.epochs) || []
  };
  return FX;
}

/* NN series shaped for the HRV leaves — sinusoidal, jittered, flat, ectopic, degenerate. A plausible
   resting series exercises no guard in this file, which is the point of each shape. */
function nnSeries(n, { base = 900, amp = 0, hz = 0, jitter = 0, ectopicAt = -1 } = {}) {
  const a = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    let v = base + (amp ? amp * Math.sin(2 * Math.PI * hz * (t / 1000)) : 0) + (jitter ? (((i * 7919) % 100) / 100 - 0.5) * 2 * jitter : 0);
    if (ectopicAt >= 0 && i === ectopicAt) v = base * 0.4;
    a.push(v);
    t += v;
  }
  return a;
}
function timesOf(nn) {
  const t = [];
  let acc = 0;
  for (const v of nn) {
    acc += v / 1000;
    t.push(acc);
  }
  return t;
}
const NN_CASES = [
  nnSeries(0),
  nnSeries(1),
  nnSeries(11),
  nnSeries(15),
  nnSeries(16), // the dfaAlpha1 N<16 floor, both sides
  nnSeries(64),
  nnSeries(300),
  nnSeries(300, { amp: 60, hz: 0.25 }), // respiratory band
  nnSeries(300, { amp: 60, hz: 0.02 }), // periodic-breathing band
  nnSeries(300, { jitter: 120 }),
  nnSeries(300, { jitter: 0 }), // perfectly flat — zero variability
  nnSeries(300, { ectopicAt: 150 }),
  nnSeries(300, { base: 400 }), // tachycardic
  nnSeries(300, { base: 2000 }), // bradycardic
  new Array(300).fill(Number.NaN),
  new Array(300).fill(0),
  [900, 900, Number.NaN, 900, 900, 900],
  null,
  undefined
];

export const families = [
  {
    name: 'genSynthetic · the generator (269 mutants — the largest cluster in the file)',
    fn: 'genSynthetic',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      /* THE SIX OPTIONS IT ACTUALLY READS, from source: fs · durSec · scenario · ambulatory · seed ·
         respHz. `ambulatory` is set by EITHER `scenario === 'ambulatory'` OR `ambulatory === true`,
         so both spellings are separate inputs and a battery on one leaves the other's arm dark. */
      for (const durSec of [1, 60, 180, 600]) out.push(call(D.genSynthetic, [{ durSec }]));
      for (const fs of [130, 65, 250, 1, 0]) out.push(call(D.genSynthetic, [{ durSec: 60, fs }]));
      for (const seed of [20260601, 1, 2, 0, 4294967295]) out.push(call(D.genSynthetic, [{ durSec: 60, seed }]));
      for (const respHz of [undefined, 0.2, 0.05, 0.5, 0]) out.push(call(D.genSynthetic, [{ durSec: 60, respHz }]));
      /* the ambulatory arm, reached BOTH ways — it switches the apnea windows and the t0 wall-clock */
      out.push(call(D.genSynthetic, [{ durSec: 60, scenario: 'ambulatory' }]));
      out.push(call(D.genSynthetic, [{ durSec: 60, ambulatory: true }]));
      out.push(call(D.genSynthetic, [{ durSec: 60, ambulatory: false }]));
      out.push(call(D.genSynthetic, [{ durSec: 60, scenario: 'nocturnal' }]));
      out.push(call(D.genSynthetic, [{ durSec: 60, ambulatory: 1 }])); // truthy but not === true
      /* ⚠️ THE ARTIFACT SPANS ARE AT t = 88 MINUTES. Everything above stops long before them, so the
         strap-shift / electrode-pop injection — and every SQI branch that exists to survive it — is
         unreachable by any of it. These two are the only inputs in this battery that get there. */
      out.push(call(D.genSynthetic, [{ durSec: 5400 }]));
      out.push(call(D.genSynthetic, [{ durSec: 5400, scenario: 'ambulatory' }]));
      for (const o of [undefined, {}, { durSec: 0 }, { durSec: -1 }, { fs: -1 }, { seed: -1 }]) out.push(call(D.genSynthetic, [o]));
      return out;
    }
  },
  {
    name: 'detectPeaks · Pan–Tompkins R-peak detection (direct)',
    fn: 'detectPeaks',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      const F = fx(D);
      const rec = F.rec;
      if (rec.__err) return ['REC:' + rec.__err];
      const bp = call(D.bandpass, [rec.int16, rec.fs]) === 'ABSENT' ? null : D.bandpass(rec.int16, rec.fs);
      out.push(call(D.detectPeaks, [rec.int16, bp, rec.fs]));
      for (const fs of [rec.fs, 65, 250, 1, 0, -1]) out.push(call(D.detectPeaks, [rec.int16, bp, fs]));
      /* Degenerate waveforms: a flat line has no peaks at all, a constant-amplitude square wave has
         nothing but peaks, and both are what separate a threshold from a peak-picker. */
      const flat = new Int16Array(rec.fs * 20);
      const square = new Int16Array(rec.fs * 20);
      for (let i = 0; i < square.length; i++) square[i] = i % 40 < 20 ? 3000 : -3000;
      const spike = new Int16Array(rec.fs * 20);
      for (let i = 0; i < spike.length; i += Math.round(rec.fs * 0.8)) spike[i] = 8000;
      for (const w of [flat, square, spike]) {
        const b = D.bandpass ? D.bandpass(w, rec.fs) : null;
        out.push(call(D.detectPeaks, [w, b, rec.fs]));
      }
      out.push(call(D.detectPeaks, [new Int16Array(0), new Float32Array(0), rec.fs]));
      for (const bad of [null, undefined]) out.push(call(D.detectPeaks, [bad, bp, rec.fs]));
      return out;
    }
  },
  {
    name: 'buildNN · beats to NN intervals with SQI + ectopy gates (direct)',
    fn: 'buildNN',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      /* buildNN(times, rr, sqi, sqiThr, ectopyThr) — the two THRESHOLDS are the whole function, so
         each needs a series sitting exactly on it as well as either side. */
      const n = 200;
      const times = Array.from({ length: n }, (_, i) => i * 0.9);
      const rr = Array.from({ length: n }, () => 900);
      const sqiAll = (v) => Array.from({ length: n }, () => v);
      for (const thr of [0, 0.25, 0.5, 0.75, 1]) out.push(call(D.buildNN, [times, rr, sqiAll(0.5), thr, 0.2]));
      for (const v of [0, 0.49, 0.5, 0.51, 1]) out.push(call(D.buildNN, [times, rr, sqiAll(v), 0.5, 0.2]));
      /* an ectopic beat exactly AT the ectopy threshold, and either side of it */
      for (const frac of [0.15, 0.2, 0.25, 0.5]) {
        const r2 = rr.slice();
        r2[100] = 900 * (1 - frac);
        out.push(call(D.buildNN, [times, r2, sqiAll(1), 0.5, 0.2]));
      }
      const alt = sqiAll(1).map((_, i) => (i % 2 ? 0.1 : 1)); // alternating SQI ⇒ no adjacent clean pair
      out.push(call(D.buildNN, [times, rr, alt, 0.5, 0.2]));
      out.push(call(D.buildNN, [times, rr, sqiAll(1), undefined, undefined])); // defaults
      out.push(call(D.buildNN, [[], [], [], 0.5, 0.2]));
      for (const bad of [null, undefined]) out.push(call(D.buildNN, [bad, rr, sqiAll(1), 0.5, 0.2]));
      return out;
    }
  },
  {
    name: 'validateHR · our ECG rate against the device HR file (direct)',
    fn: 'validateHR',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      const F = fx(D);
      const t0 = F.rec.t0Ms || Date.UTC(2026, 5, 1, 23, 30, 0);
      /* ⚠️ CONTRACT READ FROM SOURCE, AFTER GETTING IT WRONG. The first version of this family passed
         `[{tMs, hr}, …]` for `ecgHrSeries` and 12 inputs collapsed to ONE distinct answer. The real
         shape is a PLAIN NUMERIC ARRAY INDEXED BY SECOND — `Array.from(ecgHrSeries).filter(h => h >= 30
         && h <= 220)` — so every object failed the physiological filter, `hrMed` fell back to 60, the
         clip window emptied the series to NaN and every input produced the same nothing.

         The device side is `{tsMs, hr}` (tsMs, NOT tMs). Two shapes, both read from the source rather
         than inferred, which is the whole lesson of the cpapdex battery. */
      const ours = (n, hr) => Array.from({ length: n }, (_, i) => (typeof hr === 'function' ? hr(i) : hr));
      const dev = (n, hr, t) => Array.from({ length: n }, (_, i) => ({ tsMs: (t === undefined ? t0 : t) + i * 1000, hr: typeof hr === 'function' ? hr(i) : hr }));

      out.push(call(D.validateHR, [ours(300, 60), F.devHR, t0]));
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 60), t0])); // perfect agreement
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 90), t0])); // 30 bpm apart
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 61), t0])); // 1 bpm apart
      /* Both sides of the 30–220 physiological filter, and both sides of the median ± 45 clip — the
         clip is computed FROM the record's own median, so a series that never leaves it exercises
         neither bound. */
      for (const hr of [29, 30, 31, 219, 220, 221]) out.push(call(D.validateHR, [ours(300, hr), dev(300, hr), t0]));
      out.push(call(D.validateHR, [ours(300, (i) => (i < 150 ? 60 : 110)), dev(300, 60), t0])); // +50, past the clip
      out.push(call(D.validateHR, [ours(300, (i) => (i < 150 ? 60 : 100)), dev(300, 60), t0])); // +40, inside it
      /* A correlated pair vs an ANTI-correlated one — a correlation that cannot go negative is not
         being measured. */
      out.push(call(D.validateHR, [ours(300, (i) => 60 + 20 * Math.sin(i / 20)), dev(300, (i) => 60 + 20 * Math.sin(i / 20)), t0]));
      out.push(call(D.validateHR, [ours(300, (i) => 60 + 20 * Math.sin(i / 20)), dev(300, (i) => 60 - 20 * Math.sin(i / 20)), t0]));
      /* THE ALIGNMENT BRANCH: `_alignDevSeconds` trusts ecgT0Ms only when MORE THAN HALF the device
         rows land inside the window, and otherwise re-bases on the device's own first row. So the
         separating inputs are a device file mostly inside the window and one mostly outside it. */
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 60, t0 + 3600000), t0])); // wholly outside ⇒ re-base
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 60, t0 - 200000), t0])); // ~2/3 outside
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 60, t0 - 100000), t0])); // ~1/3 outside
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 60), 0])); // no ECG t0 at all
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 60), null]));
      /* the ALL-ZERO device HR file, which is the real Verity behaviour */
      out.push(call(D.validateHR, [ours(300, 60), dev(300, 0), t0]));
      out.push(call(D.validateHR, [ours(300, 60), dev(5, 60), t0])); // a handful of device rows
      out.push(call(D.validateHR, [ours(300, 60), [], t0])); // present but empty
      out.push(call(D.validateHR, [ours(300, 60), null, t0])); // absent
      out.push(call(D.validateHR, [[], dev(300, 60), t0])); // nothing of our own
      out.push(call(D.validateHR, [ours(2, 60), dev(2, 60), t0])); // too few to compare
      out.push(call(D.validateHR, [ours(300, Number.NaN), dev(300, 60), t0]));
      for (const bad of [null, undefined]) out.push(call(D.validateHR, [bad, dev(300, 60), t0]));
      return out;
    }
  },
  {
    name: 'validateRR · our NN against the device RR file (direct)',
    fn: 'validateRR',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      const F = fx(D);
      const rr = (vals) => vals.map((v) => ({ rr: v }));
      const self = nnSeries(200, { jitter: 20 });
      out.push(call(D.validateRR, [self, F.devRR]));
      out.push(call(D.validateRR, [self, rr(self.slice())])); // identical
      out.push(call(D.validateRR, [self, rr(self.map((v) => v * 2))])); // doubled
      out.push(call(D.validateRR, [self, rr(self.map((v) => v + 5))])); // slight offset
      out.push(call(D.validateRR, [self, []])); // present but empty
      out.push(call(D.validateRR, [self, null])); // absent
      out.push(call(D.validateRR, [self, rr([900])])); // one row
      out.push(call(D.validateRR, [self, rr([900, 905])])); // two rows
      out.push(call(D.validateRR, [[], rr(self.slice())]));
      out.push(call(D.validateRR, [self, rr([0, 0, 0, 0])]));
      out.push(call(D.validateRR, [self, rr([Number.NaN, 900, 905, 910])]));
      return out;
    }
  },
  {
    name: 'lombScargle · the NN spectrum (direct)',
    fn: 'lombScargle',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      /* lombScargle(nn, times, nf) — band edges are where a `<` lives, and an input that merely
         REACHES a comparison does not separate it; it has to magnify it. */
      for (const c of NN_CASES) {
        const nn = c || [];
        out.push(call(D.lombScargle, [c, c ? timesOf(nn) : c, undefined]));
      }
      const base = nnSeries(256, { amp: 40, hz: 0.25 });
      for (const nf of [undefined, 1, 0, 64, 512]) out.push(call(D.lombScargle, [base, timesOf(base), nf]));
      for (const hz of [0.0029, 0.003, 0.0031, 0.0399, 0.04, 0.0401, 0.1499, 0.15, 0.1501, 0.399, 0.4, 0.401]) {
        const a = nnSeries(256, { amp: 40, hz });
        out.push(call(D.lombScargle, [a, timesOf(a), 128]));
      }
      return out;
    }
  },
  {
    name: 'baevskyGeom · the geometric HRV indices (direct)',
    fn: 'baevskyGeom',
    probe: (s0) => NN_CASES.map((c) => call(s0.ECGDSP.baevskyGeom, [c]))
  },
  {
    name: 'dfaAlpha1 · detrended fluctuation (direct)',
    fn: 'dfaAlpha1',
    probe: (s0) => NN_CASES.map((c) => call(s0.ECGDSP.dfaAlpha1, [c]))
  },
  {
    name: 'sampEn · sample entropy (direct)',
    fn: 'sampEn',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      for (const c of NN_CASES) out.push(call(D.sampEn, [c, 2, 0.2]));
      const base = nnSeries(300, { jitter: 40 });
      for (const m of [undefined, 1, 2, 3]) out.push(call(D.sampEn, [base, m, 0.2]));
      for (const r of [undefined, 0.05, 0.2, 0.5, 1]) out.push(call(D.sampEn, [base, 2, r]));
      return out;
    }
  },
  {
    name: 'rmssd + mean/median/std · the scalar summaries (direct)',
    fn: 'rmssd',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      for (const c of NN_CASES) {
        out.push(call(D.rmssd, [c]));
        out.push(call(D.mean, [c]));
        out.push(call(D.median, [c]));
        out.push(call(D.std, [c]));
      }
      return out;
    }
  },
  {
    name: 'parseDeviceHR · the device HR file (direct)',
    fn: 'parseDeviceHR',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      const p2 = (x) => String(x).padStart(2, '0');
      const rows = (n, { hdr = 'Phone timestamp;HR [bpm]', hr = (i) => 60 + (i % 10), sep = ';' } = {}) => {
        const L = [hdr];
        for (let i = 0; i < n; i++) {
          const t = new Date(Date.UTC(2026, 5, 1, 23, 30, 0) + i * 1000);
          const ts = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}.000`;
          L.push(ts + sep + hr(i));
        }
        return L.join('\n');
      };
      for (const n of [0, 1, 2, 50]) out.push(call(D.parseDeviceHR, [rows(n)]));
      out.push(call(D.parseDeviceHR, [rows(50, { hr: () => 0 })])); // the ALL-ZERO device HR file, which is real
      out.push(call(D.parseDeviceHR, [rows(50, { sep: ',' })]));
      out.push(call(D.parseDeviceHR, [rows(50).replace(/\n/g, '\r\n')]));
      out.push(call(D.parseDeviceHR, [rows(50, { hdr: 'time;hr' })]));
      out.push(call(D.parseDeviceHR, [rows(50, { hdr: '' })])); // no header at all
      for (const raw of ['', ' ', '\n', 'junk', null, undefined, 42]) out.push(call(D.parseDeviceHR, [raw]));
      return out;
    }
  },
  {
    name: 'parseDeviceRR · the device RR file (direct)',
    fn: 'parseDeviceRR',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      const rows = (n, sep, val) => {
        const L = ['Phone timestamp' + sep + 'RR-interval [ms]'];
        for (let i = 0; i < n; i++) L.push('2026-06-01 23:30:0' + (i % 10) + '.000' + sep + (val ? val(i) : 900 + (i % 40)));
        return L.join('\n');
      };
      for (const n of [0, 1, 2, 50]) out.push(call(D.parseDeviceRR, [rows(n, ';')]));
      out.push(call(D.parseDeviceRR, [rows(50, ',')]));
      out.push(call(D.parseDeviceRR, [rows(50, '\t')]));
      out.push(call(D.parseDeviceRR, [rows(50, ';', () => 0)]));
      out.push(call(D.parseDeviceRR, [rows(50, ';', (i) => (i % 7 ? 900 : 'x'))]));
      for (const raw of ['', '\n', 'junk', null, undefined]) out.push(call(D.parseDeviceRR, [raw]));
      return out;
    }
  },
  {
    name: 'parseDeviceACC · the device accelerometer file (direct)',
    fn: 'parseDeviceACC',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const out = [];
      const rows = (n, { hdr = 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]', v = () => [0, 0, 1000] } = {}) => {
        const L = [hdr];
        for (let i = 0; i < n; i++) {
          const xyz = v(i);
          L.push('2026-06-01 23:30:0' + (i % 10) + '.000;' + i * 20000000 + ';' + xyz[0] + ';' + xyz[1] + ';' + xyz[2]);
        }
        return L.join('\n');
      };
      for (const n of [0, 1, 2, 100]) out.push(call(D.parseDeviceACC, [rows(n)]));
      out.push(call(D.parseDeviceACC, [rows(100, { v: () => [0, 0, 1] })])); // g rather than mg
      out.push(call(D.parseDeviceACC, [rows(100, { v: (i) => [500 * Math.sin(i / 5), 0, 1000] })])); // motion
      out.push(call(D.parseDeviceACC, [rows(100, { v: () => [0, 0, 0] })])); // free fall / all zero
      out.push(call(D.parseDeviceACC, [rows(100, { hdr: 'a;b;c;d;e' })]));
      for (const raw of ['', '\n', 'junk', null, undefined]) out.push(call(D.parseDeviceACC, [raw]));
      return out;
    }
  },
  {
    name: 'parseECG · the ECG text ingest (holds parseECGText, 79 mutants)',
    fn: 'parseECGText',
    probe: (s0) => {
      const D = s0.ECGDSP;
      const P = s0.ECGDex;
      const fn = D.parseECG || P.parseECG;
      const out = [];
      const p2 = (x) => String(x).padStart(2, '0');
      const rows = (
        n,
        { hdr = 'Phone timestamp;sensor timestamp [ns];ecg [uV]', fs = 130, sep = ';', gapAt = -1, gapSec = 0, val = (i) => Math.round(500 * Math.sin((2 * Math.PI * i) / 130)) } = {}
      ) => {
        const L = [hdr];
        let ms = 0;
        for (let i = 0; i < n; i++) {
          ms += 1000 / fs + (i === gapAt ? gapSec * 1000 : 0);
          const t = new Date(Date.UTC(2026, 5, 1, 23, 30, 0) + Math.round(ms));
          const ts = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}.${String(t.getUTCMilliseconds()).padStart(3, '0')}`;
          L.push(ts + sep + Math.round(ms * 1e6) + sep + val(i));
        }
        return L.join('\n');
      };
      for (const n of [0, 1, 2, 10, 400]) out.push(call(fn, [rows(n)]));
      out.push(call(fn, [rows(400, { sep: ',' })]));
      out.push(call(fn, [rows(400).replace(/\n/g, '\r\n')]));
      out.push(call(fn, [rows(400, { fs: 65 })]));
      /* A GAP is the branch `rec.gaps` exists for, and a contiguous file never reaches it. */
      out.push(call(fn, [rows(400, { gapAt: 200, gapSec: 5 })]));
      out.push(call(fn, [rows(400, { gapAt: 200, gapSec: 0.02 })])); // too small to be a gap
      out.push(call(fn, [rows(400, { val: () => 0 })])); // flat
      out.push(call(fn, [rows(400, { val: (i) => (i % 7 ? 100 : Number.NaN) })]));
      out.push(call(fn, [rows(400, { hdr: 'a;b;c' })]));
      out.push(call(fn, [rows(400, { hdr: '' })]));
      for (const raw of ['', ' ', '\n', 'junk', null, undefined, 42]) out.push(call(fn, [raw]));
      return out;
    }
  }
];

/* ── THE PIPELINE PROBE — for the INTERNAL functions analyze() is the only door to ────────────
   These have no export to call directly, so the dilution #1148 measured is unavoidable here; the
   control check is what will say whether it is survivable per function, and a family that comes back
   BLIND is telling the truth about itself. Registered per-`fn` because a family only reports on
   mutants inside the line range of the name it declares. */
function pipelineProbe(s0) {
  const D = s0.ECGDSP;
  const out = [];
  const F = fx(D);
  const gen = (o) => {
    try {
      return D.genSynthetic(o);
    } catch (e) {
      return { __err: String(e && e.message).slice(0, 50) };
    }
  };
  const run = (r) => {
    if (!r || r.__err) return 'GEN:' + ((r && r.__err) || 'null');
    return call(D.analyze, [r, null]);
  };
  out.push(run(F.rec));
  for (const durSec of [60, 120, 600]) out.push(run(gen({ durSec })));
  for (const seed of [1, 2, 3]) out.push(run(gen({ durSec: 120, seed })));
  out.push(run(gen({ durSec: 120, scenario: 'ambulatory' })));
  out.push(run(gen({ durSec: 120, respHz: 0.05 })));
  out.push(run(gen({ durSec: 120, respHz: 0.5 })));
  out.push(run(gen({ durSec: 120, fs: 65 })));
  /* the long case, which is the only one that reaches the 88-minute artifact spans */
  out.push(run(gen({ durSec: 5400 })));
  /* progress callbacks are invoked with distinct stage strings — capturing them proves the calls
     happen and in what order, which no null-progress case can show */
  {
    const seen = [];
    if (F.rec && !F.rec.__err) {
      try {
        D.analyze(F.rec, (pct, msg) => {
          seen.push(pct + ':' + msg);
        });
      } catch (_) {
        /* the stages seen before it threw are still the answer */
      }
    }
    out.push(JSON.stringify(seen));
  }
  for (const bad of [null, undefined, {}, { int16: new Int16Array(0), fs: 130 }]) out.push(call(D.analyze, [bad, null]));
  return out;
}

const ECG_PIPELINE_FNS = [
  'analyze',
  'detectCVHR',
  'cardiorespCoupling',
  '_cpc',
  'ecgCoverage',
  'ecgBuildNodeExport',
  'gangliorEvents',
  '_rraccEpochs',
  '_autocorrPeriod',
  'refinePeaks',
  'detectPeaksB',
  'computeSQI',
  'epochEngine',
  'stageSleep',
  'classifyMode',
  'hrConfidence',
  'beatConfidence',
  'hrvStability',
  'accAnalyze',
  'accExtras',
  'epochMotion',
  '_gait',
  'movementOnsets',
  'stampEpochPositions',
  'planCompanionGraft',
  'buildNodeExport'
];

export const families2 = ECG_PIPELINE_FNS.map((fn) => ({
  name: `${fn} · via analyze() — the ECG pipeline`,
  fn,
  probe: pipelineProbe
}));

families.push(...families2);
