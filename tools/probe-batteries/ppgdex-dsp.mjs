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
const PP_CASES = [];
{
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

export const families = [
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
];
