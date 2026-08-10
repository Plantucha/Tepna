/*
 * tools/probe-batteries/ppgdex-dsp.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE ppgdex-dsp.js BATTERY — inputs for `tools/probe-equivalence.mjs`.
 *
 * Three families, chosen to span the axis MUTATION-PROGRAM §5 identifies: the equivalent-mutant share
 * is a property of what a function DOES, not of the file.
 *
 *   lombScargle     numeric / spectral    — mutations get ABSORBED (~29 % distinguishable, #1052)
 *   parsePPG        string / parsing      — ~26 %
 *   ppgLoadOwnExport validation/dispatch  — ~77 %, because it branches on input shape
 *
 * Rebuilding these rather than transcribing #1052's verdicts is the point: those batteries were never
 * committed, so their conclusions could not be re-checked, widened, or re-run against moved code. See
 * MUTATION-EQUIVALENCE §8.4 — a classification written from a prose summary is invented data.
 *
 * THE SUBJECT SURFACE IS NOT ONE GLOBAL, and getting that wrong is the recorded artefact. `parsePPG`
 * and `lombScargle` hang off `PPGDSP`; `loadOwnExport` hangs off `PpgDex`. #1052's first probe read
 * `PPGDSP.loadOwnExport`, which is undefined, so every case threw identically and it reported 0 of 22
 * — a battery that never runs its subject is indistinguishable from one that finds everything
 * equivalent. The engine's degenerate-baseline check exists for exactly this and would now catch it.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */

/* The suite co-loads clock.js before every DSP (dex-coload.js `shared:`). Without it a mutant can
   differ from the original only by "DexClock is not defined" — a difference caused by the probe, not
   by the code, which #1052 had to discard by hand. */
export const deps = ['clock.js'];

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
  return ctx;
}

export function subject(ctx) {
  const D = ctx.PPGDSP,
    P = ctx.PpgDex;
  if (!D && !P) return null;
  return { PPGDSP: D || {}, PpgDex: P || {} };
}

/* Stable stringify — a probe compares BYTES, so key order must not depend on construction order. */
function s(v) {
  const seen = new WeakSet();
  const norm = (x) => {
    if (x === null || typeof x !== 'object') return typeof x === 'number' && !Number.isFinite(x) ? String(x) : x;
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
    /* The message is part of the answer: a refusal that stops NAMING the thing it refused is a real
       behavioural change (#1052 killed a `loadOwnExport` mutant on exactly that). */
    return 'THREW:' + String(e && e.message).slice(0, 80);
  }
};

// ── lombScargle(tt, nn) ──────────────────────────────────────────────────────────────────────
/* A sinusoid at `hz` sampled as NN intervals. Band edges get just-inside / on / just-outside triples
   because that is where a `<` → `<=` lives, and an input that merely REACHES a comparison does not
   separate it — it has to magnify it. #1052: `f >= 0.003` → `>` costs one unit in 3910 at 0.0401 Hz
   and 27 % at exactly 0.003 Hz. */
function series(n, hz, amp, base = 1000) {
  const tt = [],
    nn = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const v = base + amp * Math.sin(2 * Math.PI * hz * (t / 1000));
    nn.push(v);
    t += v;
    tt.push(t / 1000);
  }
  return [tt, nn];
}
function twoTone(n, h1, a1, h2, a2) {
  const tt = [],
    nn = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const v = 1000 + a1 * Math.sin(2 * Math.PI * h1 * (t / 1000)) + a2 * Math.sin(2 * Math.PI * h2 * (t / 1000));
    nn.push(v);
    t += v;
    tt.push(t / 1000);
  }
  return [tt, nn];
}

const LS_CASES = [];
{
  // every band edge, and both sides of it
  const EDGES = [0.0029, 0.003, 0.0031, 0.0399, 0.04, 0.0401, 0.1499, 0.15, 0.1501, 0.399, 0.4, 0.401, 0.25, 0.1, 0.01, 0.5];
  for (const hz of EDGES) for (const n of [64, 128]) LS_CASES.push(series(n, hz, 40));
  // the `n < 8` guard from BOTH sides — only a case at exactly 8 separates `<` from `<=`
  for (const n of [0, 1, 2, 5, 6, 7, 8, 9, 10, 16]) LS_CASES.push(series(n, 0.25, 40));
  // amplitude, including ZERO — a flat series is the one input where "no peak" and "no power"
  // become observable; every plausible signal hides both (#1052's sharpest result)
  for (const amp of [0, 1e-9, 0.5, 5, 40, 400]) for (const n of [8, 64]) LS_CASES.push(series(n, 0.25, amp));
  // two components across each band pair — the power-ratio arithmetic, not just peak-picking
  LS_CASES.push(twoTone(128, 0.1, 30, 0.25, 8));
  LS_CASES.push(twoTone(128, 0.04, 30, 0.15, 8));
  LS_CASES.push(twoTone(128, 0.003, 30, 0.4, 8));
  LS_CASES.push(twoTone(128, 0.1, 8, 0.25, 30));
  LS_CASES.push(twoTone(64, 0.01, 50, 0.3, 50));
  // degenerate shapes
  LS_CASES.push([[], []]);
  LS_CASES.push([[1], [1000]]);
  LS_CASES.push([
    [1, 2, 3],
    [1000, 1000, 1000]
  ]);
  LS_CASES.push([
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [900, 1000, 1100, 900, 1000, 1100, 900, 1000, 1100, 900]
  ]);
  LS_CASES.push([
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  ]);
  LS_CASES.push([
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [-1000, 1000, -1000, 1000, -1000, 1000, -1000, 1000, -1000, 1000]
  ]);
  const [t0, n0] = series(64, 0.25, 40);
  LS_CASES.push([t0, n0.map((v, i) => (i === 3 ? NaN : v))]);
  LS_CASES.push([t0.map((v, i) => (i === 3 ? NaN : v)), n0]);
  LS_CASES.push([t0, n0.slice(0, 10)]); // length mismatch
  LS_CASES.push([null, null]);
  LS_CASES.push([undefined, undefined]);
}

// ── parsePPG(text, opts) ─────────────────────────────────────────────────────────────────────
const HDR6 = 'Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient';
function rows(n, { header = HDR6, cols = 6, fs = 135, jitterMs = 0, crlf = false, startMs = 0 } = {}) {
  const out = header ? [header] : [];
  for (let i = 0; i < n; i++) {
    const ms = startMs + (i * 1000) / fs + (jitterMs ? (i % 3) * jitterMs : 0);
    const t = new Date(Date.UTC(2026, 6, 1, 0, 0, 0) + ms).toISOString().replace('T', ' ').replace('Z', '');
    const ch = [1000 + i, 2000 + i, 3000 + i, 400 + i];
    out.push(cols === 3 ? `${t};${i * 1000000};${ch[0]}` : `${t};${i * 1000000};${ch[0]};${ch[1]};${ch[2]};${ch[3]}`);
  }
  return out.join(crlf ? '\r\n' : '\n');
}
/* TWO CLOCKS, ON PURPOSE — without this the whole `timingSource` arm is unreachable and the family
   reports BLIND. `rows()` above emits a device column of `i * 1e6` ns, i.e. perfectly uniform, so
   `quantizedShare` saturates, the axis is judged DRAWN (`axisSynthetic`), and L680's
   `axisSynthetic ? 'host' : hostAx.independent === false ? 'device' : 'device+host'` short-circuits
   on the FIRST branch. The `=== false` comparison is then never evaluated by any input, so its mutant
   `!== false` cannot be separated — the battery was blind to it, not the code equivalent to it.

   Separating it needs BOTH halves of CLAUDE.md §7's discriminator:
     · a device column with real per-sample jitter, so the axis is NOT drawn;
     · a host column whose residual SPREAD is above/below the 2 ms independence bound —
       >2 ms is a genuine second clock (box capture, 101.89–5124 ms observed), while a host column
       derived from the device stamp and rounded lands at ≤1 ms (phone capture, 0.13–1.00 ms).
   `hostNoiseMs` picks which side of that bound the case lands on. Deterministic pseudo-noise: a
   probe must be byte-reproducible, so no Math.random. */
function rowsTwoClock(n, { fs = 135, devJitterUs = 900, hostNoiseMs = 6, startMs = 0 } = {}) {
  const out = [HDR6];
  const step = 1000 / fs;
  let devMs = 0;
  for (let i = 0; i < n; i++) {
    // device axis: real crystal jitter, so inter-sample deltas do NOT concentrate on one value
    devMs += step + (((i * 7919) % 1000) / 1000 - 0.5) * (devJitterUs / 500);
    // host axis: the device instant plus delivery noise (or a rounded copy of it when noise is 0)
    const noise = hostNoiseMs ? (((i * 6271) % 1000) / 1000 - 0.5) * 2 * hostNoiseMs : 0;
    const hostMs = startMs + devMs + noise;
    const t = new Date(Date.UTC(2026, 6, 1, 0, 0, 0) + Math.round(hostMs)).toISOString().replace('T', ' ').replace('Z', '');
    out.push(`${t};${Math.round(devMs * 1e6)};${1000 + i};${2000 + i};${3000 + i};${400 + i}`);
  }
  return out.join('\n');
}

const PP_CASES = [];
{
  /* ── the timingSource arm (L680) ──
     ⚠ THE ROW COUNT IS LOAD-BEARING AND IT IS NOT SMALL. An anchor is taken on 1 row in every
     `PPG_AXIS_EVERY = 500`, and `hostAxis` refuses below THREE anchors (clock.js §7: two points define
     a line through any jitter and cannot be checked). So a 400-row case yields exactly ONE anchor,
     `hostAx.ok` is false, and the whole thing takes the L682 branch — L680 never executes and its
     mutant is unkillable BY THE BATTERY, not by the code. Measured, after the first widening still
     read BLIND: 1600 rows ⇒ 4 anchors, 2600 ⇒ 6.
     With ok:true both arms are then reachable and either one separates `=== false` from `!== false`:
       hostNoiseMs 0  ⇒ spread ~0.65 ms ⇒ independent FALSE ⇒ 'device'
       hostNoiseMs 40 ⇒ spread ~58 ms   ⇒ independent TRUE  ⇒ 'device+host'   */
  PP_CASES.push([rowsTwoClock(1600, { hostNoiseMs: 0 }), undefined]);
  PP_CASES.push([rowsTwoClock(1600, { hostNoiseMs: 40 }), undefined]);
  PP_CASES.push([rowsTwoClock(1600, { devJitterUs: 0, hostNoiseMs: 40 }), undefined]);
  PP_CASES.push([rowsTwoClock(1600, { devJitterUs: 0, hostNoiseMs: 0 }), undefined]);
  PP_CASES.push([rowsTwoClock(2600, { hostNoiseMs: 40 }), undefined]);
  PP_CASES.push([rowsTwoClock(1600, { hostNoiseMs: 1.2 }), undefined]); // near the 2 ms bound
  PP_CASES.push([rowsTwoClock(400, { hostNoiseMs: 6 }), undefined]); // ONE anchor ⇒ the ok:false arm (L682)
  // the row-count floor FROM BOTH SIDES — only a case at exactly the floor separates `<` from `<=`
  for (const n of [0, 1, 2, 5, 8, 9, 10, 11, 12, 50, 200]) PP_CASES.push([rows(n), undefined]);
  for (const n of [9, 10, 11]) PP_CASES.push([rows(n, { header: '' }), undefined]); // HEADERLESS — a real PSL case
  for (const n of [10, 60]) PP_CASES.push([rows(n, { cols: 3 }), undefined]);
  for (const fs of [25, 55, 130, 135, 500]) PP_CASES.push([rows(60, { fs }), undefined]);
  for (const j of [0, 1, 20, 400]) PP_CASES.push([rows(60, { jitterMs: j }), undefined]);
  PP_CASES.push([rows(60, { crlf: true }), undefined]);
  PP_CASES.push([HDR6, undefined]); // header ONLY — must be refused, not fabricated into n=0
  PP_CASES.push([rows(30) + '\n\n\n', undefined]);
  PP_CASES.push([rows(30) + '\njunk;junk;junk;junk;junk;junk', undefined]);
  PP_CASES.push(['junk\n' + rows(30, { header: '' }), undefined]);
  PP_CASES.push([rows(30).replace(/;/g, ','), undefined]); // comma-separated
  PP_CASES.push([rows(30).replace(/;/g, '\t'), undefined]);
  PP_CASES.push([rows(30, { startMs: 86399500 }), undefined]); // rolls midnight
  for (const raw of ['', ' ', '\n', '\r\n', ';;;;;', 'a;b;c;d;e;f', '1;2;3;4;5;6', 'null', '0', '"q";"r";"s"', HDR6 + '\n' + HDR6, 'Phone timestamp\n2026-07-01 00:00:00', ' '])
    PP_CASES.push([raw, undefined]);
  PP_CASES.push([null, undefined]);
  PP_CASES.push([undefined, undefined]);
  PP_CASES.push([12345, undefined]);
  for (const o of [{}, { preferDMY: true }, { preferDMY: false }, { fs: 135 }, { dateAnchorMs: Date.UTC(2026, 6, 1) }]) PP_CASES.push([rows(40), o]);
}

// ── ppgLoadOwnExport(json) ───────────────────────────────────────────────────────────────────
/* Validation and dispatch: it branches on input SHAPE, so nearly every boolean mutation is
   observable — the reason this family converts at ~77 % where the two above sit near 27 %. The
   cases that matter are the fallback CHAINS (a field present in BOTH places, so precedence is
   visible) and the refusal MESSAGES (a refusal that stops naming the node is a real change). */
/* ⚠ THE NODE NAME LIVES AT `json.schema.node`, NOT `json.node` (L4118). Getting that wrong is not a
   near miss — every case then falls into the `foreign-node` arm with node='', so all 41 inputs return
   the SAME refusal and the battery reports 2 distinct answers over 41. That is rule 2's degenerate
   case with a plausible-looking input set, and it is how a battery reports "everything is equivalent"
   about code it never entered. Caught by the engine, not by reading. */
const SCH = (over = {}) => ({ name: 'ganglior.node-export', node: 'PpgDex', ...over });
const ENV = (over = {}) => ({ schema: SCH(), recording: { startEpochMs: 1, durationSec: 100 }, hrv: { rmssd: 42 }, quality: { good: true }, ...over });
const LOE_CASES = [];
{
  LOE_CASES.push(ENV());
  // the node arm — a FOREIGN node is the actionable half of a refusal, and the message must name it
  for (const node of ['OxyDex', '  PpgDex  ', 'ppgdex', 'PpgDex ', '', null, undefined, 123, 'Integrator']) LOE_CASES.push(ENV({ schema: SCH({ node }) }));
  // not a node-export at all — a different reason, a different message
  for (const schema of [undefined, null, {}, { name: 'something.else' }, { name: 'ganglior.node-export' }, { name: '' }, { node: 'PpgDex' }]) LOE_CASES.push(ENV({ schema }));
  for (const scrubbed of [true, false, undefined, 0, 1, 'yes']) LOE_CASES.push(ENV({ schema: SCH({ scrubbed }) }));
  for (const f of ['provenance', 'generated', 'derivedFrom']) {
    LOE_CASES.push(ENV({ schema: SCH({ [f]: { v: 1 } }) }));
    LOE_CASES.push(ENV({ schema: SCH({ [f]: 0 }) })); // falsy ⇒ the `|| null` arm
  }
  /* The FIELD FALLBACK CHAIN — `(carrier[0] && carrier[0].X) || json.X || null`, three distinct
     outcomes. Only an export carrying the field in BOTH places separates the precedence from its
     mutants (#1052); one carrying it in neither cannot. */
  for (const f of ['recording', 'hrv', 'quality', 'personalization']) {
    LOE_CASES.push(ENV({ sessions: [{ [f]: { from: 'session' } }], [f]: { from: 'top' } }));
    LOE_CASES.push(ENV({ sessions: [{}], [f]: { from: 'top' } }));
    LOE_CASES.push(ENV({ sessions: [{ [f]: { from: 'session' } }], [f]: undefined }));
    LOE_CASES.push(ENV({ sessions: [], [f]: { from: 'top' } }));
    LOE_CASES.push(ENV({ sessions: [{ [f]: 0 }], [f]: { from: 'top' } })); // falsy session value
  }
  for (const k of ['kernel', 'crossNight']) {
    LOE_CASES.push(ENV({ [k]: { v: 2 } }));
    LOE_CASES.push(ENV({ [k]: 0 }));
  }
  // the `sessions` arm and multiNight's `elements.length > 1` from BOTH sides
  LOE_CASES.push(ENV({ sessions: [{ a: 1 }, { a: 2 }] }));
  LOE_CASES.push(ENV({ sessions: [{ a: 1 }] }));
  LOE_CASES.push(ENV({ sessions: [{ a: 1 }, { a: 2 }, { a: 3 }] }));
  LOE_CASES.push(ENV({ sessions: [] })); // empty ⇒ 0 elements, and carrier[0] undefined
  for (const sessions of ['not-an-array', null, 0, {}, [null]]) LOE_CASES.push(ENV({ sessions }));
  /* ganglior_events — the top-level list, the per-element fallback when it is empty, and the SORT
     comparator. A null element separates `(a && a.tMs)` from `(a || a.tMs)`: the mutant dereferences
     null and throws where the original returns 0. Two events minimum, or the comparator never runs. */
  LOE_CASES.push(ENV({ ganglior_events: [{ tMs: 9 }, { tMs: 1 }, { tMs: 5 }] }));
  LOE_CASES.push(ENV({ ganglior_events: [null, { tMs: 5 }] }));
  LOE_CASES.push(ENV({ ganglior_events: [{ tMs: 5 }, null] }));
  LOE_CASES.push(ENV({ ganglior_events: [{}, { tMs: 5 }] }));
  LOE_CASES.push(ENV({ ganglior_events: [{ tMs: 0 }, { tMs: -1 }] }));
  LOE_CASES.push(ENV({ ganglior_events: [] })); // empty ⇒ falls back to the elements' own lists
  LOE_CASES.push(ENV({ ganglior_events: 'nope' }));
  LOE_CASES.push(ENV({ sessions: [{ ganglior_events: [{ tMs: 3 }] }, { ganglior_events: [{ tMs: 1 }] }] }));
  LOE_CASES.push(ENV({ sessions: [{ ganglior_events: [{ tMs: 3 }] }], ganglior_events: [{ tMs: 7 }] }));
  LOE_CASES.push(ENV({ sessions: [{ ganglior_events: 'nope' }] }));
  // deep-copy: a reload must not hand back a reference into the caller's object
  LOE_CASES.push(ENV({ sessions: [{ nested: { deep: [1, 2, 3] } }] }));
  for (const j of [null, undefined, {}, [], 'a string', 42, 0, true]) LOE_CASES.push(j);
}

/* ══ THE PIPELINE — 679 of this file's 736 survivors were UNPROBED, not unreachable ══════════════
   Three families (`lombScargle`, `parsePPG`, `ppgLoadOwnExport`) covered **57** survivors of 736. The
   other 679 were never claimed by any family, so the prober could not have reached a verdict on them
   however good the batteries were — and nothing said so, because a family only ever reports on the
   mutants inside its own `fn`'s line range.

   They are not exotic. `analyze(rec, progress)` is exported and calls essentially all of them:

       120 analyze · 57 cvhrFromNN · 26 beatConfidence · 16 detectBeats · 10 consensusBeats
        10 beatSQI · 10 correctRR · 10 timeDomain · 10 intervalsSpanningTimeGap · 9 ppgCoverage
         8 channelSNR · 8 holdOverGaps · 7 sqiAt · 6 poincare · 5 dfaAlpha1 · 5 buildEpochs …

   WHAT WAS MISSING WAS A FIXTURE THAT SURVIVES BEAT DETECTION. The battery's existing `rowsTwoClock`
   emits a linear RAMP — correct for the timing-axis branches it was written for, and pulseless, so
   every beat-dependent function downstream returned empty. So the generator below emits an actual
   pulse: a sharp systolic upstroke, a dicrotic notch and a diastolic decay, on all three LEDs with
   per-channel gain so they are not bit-identical (identical channels take `distinctChannelIdx`'s
   `nCh < 2` path and never vote).

   Verified by execution before any of it was written down:
       60 s @ 60 bpm  →  59 beats, HR 60      120 s @ 72 bpm →  130 beats, HR 72
   and `cvhrFromNN` — the brief's "hard one", 57 survivors, previously filed as a project rather than
   a battery — falls straight out of an HR modulated in the apnea band:
       flat HR → cvhrIndex 0, 0 events    40 s cycle → 84.1, 7 events    30 s cycle → 108.4, 9 events */
const PPG_HDR = 'Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient';
function ppgText(sec, { fs = 135, hr = 60, amp = 800, base = 20000, cvhrPeriodSec = 0, cvhrDepth = 0, rrJitter = 0, ambient = 400, ambDrift = 0, noise = 0, flatline = 0, sentinel = 0 } = {}) {
  const out = [PPG_HDR];
  const n = Math.round(sec * fs),
    step = 1000 / fs,
    p2 = (x) => String(x).padStart(2, '0');
  let devMs = 0,
    ph = 0,
    beat = 0,
    /* The CURRENT beat's RR. Re-drawn at each beat boundary rather than per sample, because
       beat-to-beat variability is what `correctRR`, `poincare` and `timeDomain` measure — modulating
       it within a beat would smear the interval instead of varying it. */
    rr = 60000 / hr;
  for (let i = 0; i < n; i++) {
    devMs += step;
    const tSec = devMs / 1000;
    ph += step / rr;
    if (ph >= 1) {
      ph -= 1;
      beat++;
      const hrNow = hr * (1 + (cvhrPeriodSec ? cvhrDepth * Math.sin((2 * Math.PI * tSec) / cvhrPeriodSec) : 0));
      // deterministic per-beat jitter — a probe must be byte-reproducible, so never Math.random
      rr = (60000 / hrNow) * (1 + (rrJitter ? (((beat * 7919) % 100) / 100 - 0.5) * 2 * rrJitter : 0));
    }
    /* systolic peak + dicrotic notch + diastolic trough — the shape `refineFeet` looks for */
    const w = Math.exp(-Math.pow((ph - 0.15) / 0.07, 2)) + 0.35 * Math.exp(-Math.pow((ph - 0.42) / 0.1, 2)) - 0.15 * Math.exp(-Math.pow((ph - 0.75) / 0.25, 2));
    // deterministic pseudo-noise — a probe must be byte-reproducible, so never Math.random
    const nz = noise ? (((i * 7919) % 1000) / 1000 - 0.5) * 2 * noise : 0;
    const inFlat = flatline && tSec > sec * 0.4 && tSec < sec * 0.4 + flatline;
    let v = inFlat ? base : base + amp * w + nz;
    if (sentinel && i % sentinel === 0) v = 156; // the O2Ring sentinel markO2Sentinels/holdOverGaps handle
    const t = new Date(Date.UTC(2026, 6, 1, 0, 0, 0) + Math.round(devMs));
    const ts = `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}.${String(t.getUTCMilliseconds()).padStart(3, '0')}`;
    const amb = ambient + (ambDrift ? (ambDrift * i) / n : 0);
    /* per-channel gain/offset: three real photodiodes are never bit-identical, and identical ones
       take the honest `nCh < 2` path instead of voting with themselves */
    out.push(`${ts};${Math.round(devMs * 1e6)};${Math.round(v)};${Math.round(v * 0.95 + 30)};${Math.round(v * 1.03 - 25)};${Math.round(amb)}`);
  }
  return out.join('\n');
}

/* Parse ONCE per case and reuse — `parsePPG` on 40 000 samples dominates the cost otherwise, and the
   record is not mutated by `analyze`. Built lazily so a battery load costs nothing. */
let PIPE_CASES = null;
function pipeCases(D) {
  if (PIPE_CASES) return PIPE_CASES;
  const mk = (sec, o) => {
    try {
      return D.parsePPG(ppgText(sec, o), undefined);
    } catch (e) {
      return { __err: String(e && e.message).slice(0, 60) };
    }
  };
  PIPE_CASES = [
    ['clean 60 s @60', mk(60, {})],
    ['clean 120 s @72', mk(120, { hr: 72 })],
    ['bradycardic @45', mk(120, { hr: 45 })],
    ['tachycardic @110', mk(120, { hr: 110 })],
    ['RR jitter 8 %', mk(120, { hr: 65, rrJitter: 0.08 })],
    /* CVHR — the apnea band. Flat HR is the negation, and both are needed: an index that is always
       zero and an index that is never zero are the same measurement. */
    ['CVHR 40 s cycle', mk(300, { cvhrPeriodSec: 40, cvhrDepth: 0.18 })],
    ['CVHR 30 s deep', mk(300, { cvhrPeriodSec: 30, cvhrDepth: 0.25 })],
    ['CVHR 60 s shallow', mk(300, { cvhrPeriodSec: 60, cvhrDepth: 0.06 })],
    ['flat HR 300 s (CVHR negation)', mk(300, {})],
    /* SIGNAL QUALITY — SQI, beatConfidence and channelSNR are all contrasts, so a battery of clean
       signals exercises none of them. */
    ['noisy (SNR floor)', mk(120, { hr: 68, noise: 900 })],
    ['very noisy', mk(120, { hr: 68, noise: 4000 })],
    ['low amplitude', mk(120, { hr: 68, amp: 60 })],
    ['30 s flatline mid-record', mk(180, { hr: 68, flatline: 30 })],
    ['O2Ring 156 sentinels', mk(120, { hr: 68, sentinel: 97 })],
    ['ambient drift', mk(120, { hr: 68, ambDrift: 3000 })],
    /* SAMPLE RATE and LENGTH — cadence, epoching and the coverage split all read fs and span. */
    ['fs 55 Hz', mk(120, { fs: 55, hr: 68 })],
    ['fs 28 Hz', mk(120, { fs: 28, hr: 68 })],
    ['short 20 s', mk(20, { hr: 68 })],
    ['very short 5 s', mk(5, { hr: 68 })],
    ['long 300 s', mk(300, { hr: 62 })]
  ];
  return PIPE_CASES;
}

/* ONE probe, MANY families. A family's `fn` decides which survivors it claims and which kills are
   its controls — NOT which function the probe calls. Registered as a single `analyze` family this
   would classify the 120 survivors inside `analyze` and silently leave ~250 untouched. */
function pipelineProbe(s0) {
  const D = s0.PPGDSP;
  const out = [];
  for (const [, rec] of pipeCases(D)) {
    if (rec && rec.__err) {
      out.push('PARSE:' + rec.__err);
      continue;
    }
    out.push(call(D.analyze, [rec, null]));
  }
  /* A `progress` callback is invoked with distinct stage strings; capturing them proves the calls
     happen and in what order, which no null-progress case can show. */
  const seen = [];
  const first = pipeCases(D)[0][1];
  if (first && !first.__err)
    call(D.analyze, [
      first,
      (pct, msg) => {
        seen.push(pct + ':' + msg);
      }
    ]);
  out.push(JSON.stringify(seen));
  for (const bad of [null, undefined, {}, { ch: [], fs: 0 }]) out.push(call(D.analyze, [bad, null]));
  return out;
}

/* The pipeline functions `analyze` reaches. Each claims its own survivors and needs its own
   controls, so a blind one is reported per-function rather than hidden in an aggregate. */
/* NOTE: the seven functions in LEAF_FAMILIES are deliberately ABSENT here. They have direct families
   with inputs chosen for their own branches; registering them twice would give one mutant two
   verdicts from two probes of very different power, and the weaker (diluted) one would be the
   family that voids. One fn, one family. */
const PPG_PIPELINE_FNS = [
  'analyze',
  'cvhrFromNN',
  'beatConfidence',
  'detectBeats',
  'detectChannel',
  'consensusBeats',
  'consensusSign',
  'applyConsensusPolarity',
  'beatSQI',
  'sqiAt',
  'correctRR',
  'buildPPI',
  'poincare',
  'dfaAlpha1',
  'buildEpochs',
  'channelSNR',
  'holdOverGaps',
  'ppgCoverage',
  'buildEvents',
  'refineFeet',
  'gapBeats',
  'countPairs',
  'pickChannel',
  'distinctChannelIdx',
  'hrvShapeViolates'
];

/* ══ DIRECT LEAF FAMILIES — because ROUTING THROUGH analyze() DILUTES ═══════════════════════════
   The pipeline probe reaches all of these, and #1147 measured what that is worth: 22 families VOID,
   with `beatRegularity` separating 0 OF 6 CONTROLS despite being called on every one of the 25
   inputs. A leaf's result is aggregated, rounded and summarised into the export long before the
   fingerprint sees it, so a mutation that genuinely changes the leaf changes nothing observable at
   the far end.

   REACHING A FUNCTION IS NECESSARY AND IT IS NOT SUFFICIENT. That is `probe-reach`'s stated caveat,
   now measured rather than anticipated. Every function below is EXPORTED, so it can be called
   directly with inputs chosen for ITS branches rather than for a whole night's recording — which is
   the only way its controls can separate. Contracts read from source, not inferred. */
const LEAF_FAMILIES = [
  {
    name: 'beatRegularity · local cadence agreement (direct)',
    fn: 'beatRegularity',
    probe: (s0) => {
      const B = s0.PPGDSP;
      const out = [];
      /* `peaks` are SAMPLE INDICES. Each score is 1 − min(1, dev/0.5)·0.4 against the MEDIAN interval,
         floored at 0.6 — so what separates mutants is an exact deviation at a band edge, and a beat
         whose two neighbouring intervals disagree (it takes the MINIMUM of the two). */
      const even = (n, step) => Array.from({ length: n }, (_, i) => i * step);
      for (const n of [0, 1, 2, 3, 4, 5, 12]) out.push(call(B.beatRegularity, [even(n, 135), 135])); // the n<4 guard, both sides
      for (const frac of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
        const p = [0, 135, 270, 405, 540];
        p.push(p[p.length - 1] + Math.round(135 * (1 + frac)));
        for (let k = 0; k < 4; k++) p.push(p[p.length - 1] + 135);
        out.push(call(B.beatRegularity, [p, 135]));
      }
      /* ⚠️ A SINGLE ODD INTERVAL SCORES 1.0 AND CANNOT SEE THE SCALING FACTOR. Each beat takes the
         MINIMUM of its two adjacent deviations, so a lone irregular interval always has a regular
         neighbour on its other side and every beat still comes out perfect. Measured: with only the
         single-deviation cases above, the `* 0.4 -> * 0` mutant — which flattens EVERY score to 1.0
         — read as EQUIVALENT, because no input ever produced a score below 1.0 to begin with.

         TWO CONSECUTIVE irregular intervals are what put a beat between two deviations, and that is
         the only shape in which the scaling factor is observable at all. */
      const runOf = (dev, count) => {
        const p = [0, 135, 270, 405];
        for (let k = 0; k < count; k++) p.push(p[p.length - 1] + Math.round(135 * (1 + dev)));
        for (let k = 0; k < 4; k++) p.push(p[p.length - 1] + 135);
        return p;
      };
      for (const dev of [0.1, 0.25, 0.5, 0.9]) for (const count of [2, 3, 5]) out.push(call(B.beatRegularity, [runOf(dev, count), 135]));
      /* A HALVED interval (a double-counted beat) and a DOUBLED one (a missed beat) — the two real
         detector failures the 0.6 floor exists to score. In RUNS, for the reason above, and singly. */
      out.push(call(B.beatRegularity, [[0, 135, 270, 337, 404, 471, 606, 741], 135])); // halved, run of 3
      out.push(call(B.beatRegularity, [[0, 135, 270, 540, 810, 1080, 1215, 1350], 135])); // doubled, run of 3
      out.push(call(B.beatRegularity, [[0, 135, 270, 337, 472, 607, 742], 135])); // a LONE halved interval
      out.push(call(B.beatRegularity, [[0, 135, 270, 540, 675, 810, 945], 135])); // a LONE doubled interval
      out.push(call(B.beatRegularity, [[0, 0, 0, 0, 0, 0], 135])); // median interval 0 ⇒ all null
      out.push(call(B.beatRegularity, [[5, 4, 3, 2, 1, 0], 135])); // descending ⇒ negative median
      for (const fs of [135, 55, 0, -1, undefined]) out.push(call(B.beatRegularity, [even(8, 135), fs]));
      for (const bad of [null, undefined, []]) out.push(call(B.beatRegularity, [bad, 135]));
      return out;
    }
  },
  {
    name: 'timeDomain · NN summary with masks (direct)',
    fn: 'timeDomain',
    probe: (s0) => {
      const B = s0.PPGDSP;
      const out = [];
      /* timeDomain(nn, cleanMask, omit) draws TWO different subsets from one call: sdnn/meanRR over
         the omit-filtered set, rMSSD/pNN50 over adjacent CLEAN-MASK pairs only. A battery that never
         supplies a mask exercises neither. */
      const nn = (n, base, jit) => Array.from({ length: n }, (_, i) => base + (jit ? (((i * 7919) % 100) / 100 - 0.5) * 2 * jit : 0));
      for (const n of [0, 1, 2, 3, 60]) out.push(call(B.timeDomain, [nn(n, 1000, 0), null, null]));
      for (const jit of [0, 5, 50, 200]) out.push(call(B.timeDomain, [nn(60, 1000, jit), null, null]));
      const base = nn(60, 1000, 40);
      const allTrue = base.map(() => true);
      const allFalse = base.map(() => false);
      out.push(call(B.timeDomain, [base, allTrue, null]));
      out.push(call(B.timeDomain, [base, allFalse, null])); // NO clean pair at all
      out.push(call(B.timeDomain, [base, base.map((_, i) => i % 2 === 0), null])); // alternating ⇒ no ADJACENT pair
      out.push(call(B.timeDomain, [base, base.map((_, i) => i < 30), null])); // one contiguous clean half
      out.push(call(B.timeDomain, [base, null, allFalse]));
      out.push(call(B.timeDomain, [base, null, allTrue])); // omit EVERYTHING — the `keep or nn` guard
      out.push(call(B.timeDomain, [base, null, base.map((_, i) => i > 1)])); // omit all but two — exactly the floor
      out.push(call(B.timeDomain, [base, allTrue, allTrue]));
      /* pNN50 counts |Δ| > 50 ms, so a series whose successive difference is EXACTLY 50 is the only
         input that separates `>` from `>=`. */
      out.push(call(B.timeDomain, [Array.from({ length: 60 }, (_, i) => 1000 + (i % 2) * 50), null, null]));
      out.push(call(B.timeDomain, [Array.from({ length: 60 }, (_, i) => 1000 + (i % 2) * 51), null, null]));
      out.push(call(B.timeDomain, [Array.from({ length: 60 }, (_, i) => 1000 + (i % 2) * 49), null, null]));
      for (const bad of [null, undefined]) out.push(call(B.timeDomain, [bad, null, null]));
      return out;
    }
  },
  {
    name: 'sampEn · sample entropy (direct)',
    fn: 'sampEn',
    probe: (s0) => {
      const B = s0.PPGDSP;
      const out = [];
      const nn = (n, base, jit, period) =>
        Array.from({ length: n }, (_, i) => base + (period ? 30 * Math.sin((2 * Math.PI * i) / period) : 0) + (jit ? (((i * 7919) % 100) / 100 - 0.5) * 2 * jit : 0));
      for (const n of [0, 1, 59, 60, 61, 300]) out.push(call(B.sampEn, [nn(n, 1000, 30), 2, 0.2])); // the N<60 refusal, both sides
      for (const m of [undefined, 1, 2, 3]) out.push(call(B.sampEn, [nn(300, 1000, 30), m, 0.2]));
      for (const r of [undefined, 0.05, 0.2, 0.5, 1]) out.push(call(B.sampEn, [nn(300, 1000, 30), 2, r]));
      out.push(call(B.sampEn, [nn(300, 1000, 0), 2, 0.2])); // perfectly flat ⇒ sd 0 ⇒ tolerance 0
      out.push(call(B.sampEn, [nn(300, 1000, 0, 20), 2, 0.2])); // pure periodic ⇒ maximally predictable
      out.push(call(B.sampEn, [nn(300, 1000, 200), 2, 0.2])); // near-random
      out.push(call(B.sampEn, [nn(4000, 1000, 30), 2, 0.2])); // past the O(N²) decimation cap
      for (const bad of [null, undefined]) out.push(call(B.sampEn, [bad, 2, 0.2]));
      return out;
    }
  },
  {
    name: 'markO2Sentinels · the 156 invalid marker (direct)',
    fn: 'markO2Sentinels',
    probe: (s0) => {
      const B = s0.PPGDSP;
      const out = [];
      /* A sentinel is judged against its REAL neighbours: an isolated 156 is a legitimate sample that
         happens to equal the marker, a RUN of them is genuinely missing — because a run has no real
         neighbour to vote for it. So the separating pair is one isolated marker against a run. */
      const mk = (n, at, runLen, base) => {
        const a = Array.from({ length: n }, (_, i) => base + (i % 7));
        for (let k = 0; k < runLen; k++) if (at + k < n) a[at + k] = 156;
        return a;
      };
      for (const runLen of [0, 1, 2, 3, 5, 20]) out.push(call(B.markO2Sentinels, [mk(60, 20, runLen, 20000)]));
      for (const runLen of [1, 5]) out.push(call(B.markO2Sentinels, [mk(60, 20, runLen, 150)])); // neighbours NEAR 156
      out.push(call(B.markO2Sentinels, [mk(60, 0, 3, 20000)])); // at the very start — no left neighbour
      out.push(call(B.markO2Sentinels, [mk(60, 57, 3, 20000)])); // at the very end
      out.push(call(B.markO2Sentinels, [new Array(40).fill(156)])); // nothing BUT the marker
      out.push(call(B.markO2Sentinels, [new Array(40).fill(20000)])); // no marker at all
      for (const bad of [[], [156], [156, 156]]) out.push(call(B.markO2Sentinels, [bad]));
      return out;
    }
  },
  {
    name: 'harmonicOutlierRefIdx · the harmonic-counting re-pick (direct)',
    fn: 'harmonicOutlierRefIdx',
    probe: (s0) => {
      const B = s0.PPGDSP;
      const out = [];
      /* Re-picks the reference channel ONLY when the others COHERE (spread < 0.15) AND the reference
         sits at ≥ 1.5× their median — the double-counting signature. Both conditions need their own
         edge, and `others.length < 2` needs a two-channel case. */
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, 60, 61, 59], [10, 9, 8, 7]])); // classic 2× harmonic
      out.push(call(B.harmonicOutlierRefIdx, [0, [90, 60, 61, 59], [10, 9, 8, 7]])); // exactly 1.5× — the edge
      out.push(call(B.harmonicOutlierRefIdx, [0, [89, 60, 61, 59], [10, 9, 8, 7]])); // just under 1.5×
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, 60, 70, 55], [10, 9, 8, 7]])); // others do NOT cohere
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, 60, 61], [10, 9, 8]])); // exactly 2 others
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, 60], [10, 9]])); // only ONE other ⇒ refuse
      out.push(call(B.harmonicOutlierRefIdx, [1, [60, 120, 61, 59], [8, 10, 9, 7]])); // reference is not index 0
      out.push(call(B.harmonicOutlierRefIdx, [0, [null, 60, 61, 59], [10, 9, 8, 7]]));
      out.push(call(B.harmonicOutlierRefIdx, [0, [0, 60, 61, 59], [10, 9, 8, 7]]));
      out.push(call(B.harmonicOutlierRefIdx, [0, [Number.NaN, 60, 61, 59], [10, 9, 8, 7]]));
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, null, null, 59], [10, 9, 8, 7]]));
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, 0, 0, 0], [10, 9, 8, 7]])); // median of others is 0
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, 60, 61, 59], [1, 2, 9, 3]])); // best SNR among matchers
      out.push(call(B.harmonicOutlierRefIdx, [0, [120, 60, 61, 59], [10, 10, 10, 10]])); // tied SNR
      return out;
    }
  },
  {
    name: 'intervalsSpanningTimeGap · beats that straddle a discontinuity (direct)',
    fn: 'intervalsSpanningTimeGap',
    probe: (s0) => {
      const B = s0.PPGDSP;
      const out = [];
      /* A fast path returns early when there is NO discontinuity anywhere — which is every pre-fix
         file and every Verity file, so a battery of contiguous recordings never leaves it. */
      const rel = (n, fs, jumpAt, jumpSec) => Array.from({ length: n }, (_, i) => i / fs + (jumpAt >= 0 && i >= jumpAt ? jumpSec : 0));
      const contiguous = rel(600, 135, -1, 0);
      const jumped = rel(600, 135, 300, 10);
      out.push(call(B.intervalsSpanningTimeGap, [contiguous, 135, [10, 140, 280, 420, 560], 4])); // no jump anywhere
      out.push(call(B.intervalsSpanningTimeGap, [jumped, 135, [10, 140, 280, 420, 560], 4])); // one interval straddles
      out.push(call(B.intervalsSpanningTimeGap, [jumped, 135, [310, 340, 370, 400], 3])); // all AFTER the jump
      out.push(call(B.intervalsSpanningTimeGap, [jumped, 135, [10, 40, 70, 100], 3])); // all BEFORE it
      out.push(call(B.intervalsSpanningTimeGap, [jumped, 135, [299, 301], 1])); // straddling by one sample
      out.push(call(B.intervalsSpanningTimeGap, [rel(600, 135, 300, 0.02), 135, [10, 140, 280, 420, 560], 4])); // jump too small to count
      out.push(call(B.intervalsSpanningTimeGap, [jumped, 135, [-5, 700], 1])); // feet outside the axis ⇒ clamped
      for (const fs of [135, 0, -1, undefined]) out.push(call(B.intervalsSpanningTimeGap, [jumped, fs, [10, 140], 1]));
      out.push(call(B.intervalsSpanningTimeGap, [jumped, 135, [10], 0])); // fewer than 2 feet
      for (const bad of [null, undefined, []]) out.push(call(B.intervalsSpanningTimeGap, [bad, 135, [10, 140], 1]));
      out.push(call(B.intervalsSpanningTimeGap, [jumped, 135, [null, 140, undefined, 420], 3]));
      return out;
    }
  },
  {
    name: 'validatePPI · device PPI against our own (direct)',
    fn: 'validatePPI',
    probe: (s0) => {
      const B = s0.PPGDSP;
      const out = [];
      /* Three states the app must tell apart: NO file, an EMPTY file, and a file with too few usable
         rows. The row filter drops ppi outside (300, 2000) and any non-zero blocker, so each bound
         needs a row sitting exactly on it. */
      const ppi = (vals, blocker) => vals.map((v) => ({ ppi: v, blocker: blocker === undefined ? 0 : blocker }));
      const self = Array.from({ length: 60 }, (_, i) => 900 + (i % 7) * 5);
      out.push(call(B.validatePPI, [self, null])); // no file
      out.push(call(B.validatePPI, [self, undefined]));
      out.push(call(B.validatePPI, [self, []])); // present but empty
      for (const n of [1, 2, 3, 4, 30]) out.push(call(B.validatePPI, [self, ppi(Array.from({ length: n }, () => 900))]));
      for (const v of [300, 301, 1999, 2000, 299, 2001]) out.push(call(B.validatePPI, [self, ppi([v, v, v, v])])); // every bound
      for (const b of [0, 1, null, undefined]) out.push(call(B.validatePPI, [self, ppi([900, 905, 910, 915], b)]));
      out.push(call(B.validatePPI, [self.slice(0, 2), ppi([900, 905, 910, 915])])); // too few of OUR OWN
      out.push(call(B.validatePPI, [self, ppi([900, 905, 910, 915])])); // agreeing
      out.push(call(B.validatePPI, [self, ppi([1800, 1805, 1810, 1815])])); // disagreeing by 2×
      out.push(call(B.validatePPI, [self, ppi([450, 455, 460, 465])])); // disagreeing the other way
      out.push(call(B.validatePPI, [[], ppi([900, 905, 910, 915])]));
      return out;
    }
  }
];

export const families = PPG_PIPELINE_FNS.map((fn) => ({
  name: `${fn} · via analyze() — the beat pipeline`,
  fn,
  probe: pipelineProbe
}))
  .concat([
    {
      name: 'lombScargle · numeric/spectral',
      fn: 'lombScargle',
      probe: (s0) => LS_CASES.map(([tt, nn]) => call(s0.PPGDSP.lombScargle, [tt, nn]))
    },
    {
      name: 'parsePPG · string/parsing',
      fn: 'parsePPG',
      probe: (s0) => PP_CASES.map(([text, opts]) => call(s0.PPGDSP.parsePPG, [text, opts]))
    },
    {
      name: 'ppgLoadOwnExport · validation/dispatch',
      fn: 'ppgLoadOwnExport',
      /* NOT PPGDSP.loadOwnExport — that is undefined, and reading it is the recorded artefact. */
      probe: (s0) => LOE_CASES.map((j) => call(s0.PpgDex.loadOwnExport, [j]))
    }
  ])
  .concat(LEAF_FAMILIES);
