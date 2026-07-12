/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * cpap-oxy-couple.mjs — cross-node event↔event coupling with a SHUFFLED NULL.
 *
 * Folds O2Ring (OxyDex) into a CPAP corpus and asks the question the Integrator
 * cannot currently ask: is a co-occurrence between two nodes' events BETTER THAN
 * CHANCE?
 *
 * The null model is a circular time-shift surrogate: re-run the same match after
 * displacing every event of node A by ±5–15 min. That preserves both nodes'
 * marginal event rates and destroys only the ALIGNMENT — so the observed-vs-null
 * ratio ("lift") isolates genuine temporal coupling from two signals simply both
 * being busy. Without it, any two frequent event streams look "related".
 *
 * Both nodes emit floating wall-clock tMs (the Clock Contract), so an EDF-header
 * clock and an O2Ring CSV clock align with NO timezone negotiation. That is the
 * contract's whole point, demonstrated across two unrelated parsers.
 *
 * PROTOTYPE for the shared `event-coupling.js` primitive proposed in
 * briefs/CPAP-REAL-CORPUS-2026-07-11-BRIEF.md §P5. Generalizes to any (node A
 * event, node B event) pair — CPAP apnea × desat, ECG arrhythmia × desat, …
 *
 *   node tools/cpap-oxy-couple.mjs --exports <cpap-exports.json> --oxy <dir-of-O2Ring-csv>
 *
 * (--exports is the output of `tools/cpap-corpus.mjs --out`.)
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const EXPORTS = arg('--exports', null);
const OXYDIR = arg('--oxy', null);
if (!EXPORTS || !OXYDIR) {
  console.error('usage: node tools/cpap-oxy-couple.mjs --exports <cpap-exports.json> --oxy <dir-of-O2Ring-csv>');
  process.exit(2);
}

/* ── OxyDex realm ─────────────────────────────────────────────────────────── */
const noop = () => {};
const el = () => ({
  style: {},
  dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop,
  getAttribute: () => null,
  appendChild: noop,
  append: noop,
  removeChild: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop
});
const sb = {
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
  crypto: globalThis.crypto,
  document: {
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
  },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop }
};
sb.window = sb;
sb.self = sb;
sb.globalThis = sb;
const ctx = vm.createContext(sb);
ctx.__DEX_NAMESPACED__ = true;
for (const f of ['kernel-constants.js', 'clock.js', 'oxydex-util.js', 'oxydex-dsp.js']) vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f });

/* ── THE PRIMITIVE (§P5) ──────────────────────────────────────────────────────
   coupling(eventsA, eventsB, opts) → { n, hits, observedPct, chancePct, lift }
   eventsA/eventsB: [{ tMs }]. A "hit" = some B falls in [tA+lo, tA+hi].        */
export function coupling(eventsA, eventsB, opts = {}) {
  const [lo, hi] = opts.window || [0, 60000];
  const shifts = opts.nullShifts || [-900e3, -720e3, -600e3, -420e3, -300e3, 300e3, 420e3, 600e3, 720e3, 900e3];
  if (!eventsA.length) return { n: 0, hits: 0, observedPct: NaN, chancePct: NaN, lift: NaN };
  const rate = (shift) => {
    let h = 0;
    for (const a of eventsA) {
      const t = a.tMs + shift;
      // eventsB is per-night; callers scope it. Linear scan is fine at this size.
      if (eventsB.some((b) => b.tMs - t >= lo && b.tMs - t <= hi)) h++;
    }
    return (h / eventsA.length) * 100;
  };
  const observedPct = rate(0);
  const nulls = shifts.map(rate);
  const chancePct = nulls.reduce((s, x) => s + x, 0) / nulls.length;
  return {
    n: eventsA.length,
    hits: Math.round((observedPct / 100) * eventsA.length),
    observedPct,
    chancePct,
    lift: observedPct / (chancePct || 1e-9)
  };
}

/* ── load both sides, pair by overlapping floating clock ──────────────────── */
const CP = JSON.parse(fs.readFileSync(EXPORTS, 'utf8')).exports;
const oxy = [];
for (const f of fs
  .readdirSync(OXYDIR)
  .filter((f) => /\.csv$/i.test(f))
  .sort()) {
  let e = null;
  try {
    e = ctx.OxyDex.compute({ text: fs.readFileSync(path.join(OXYDIR, f), 'utf8'), fname: f }, { fname: f, kernel: ctx.DexKernel });
  } catch {
    continue;
  }
  if (!e?.recording?.startEpochMs) continue;
  oxy.push({
    file: f,
    t0: e.recording.startEpochMs,
    durMin: e.recording.durationMin,
    desats: (e.ganglior_events || []).filter((x) => x.impulse === 'desat_event')
  });
}

const pairs = [];
for (const o of oxy) {
  const oEnd = o.t0 + (o.durMin || 0) * 60000;
  let best = null;
  for (const c of CP) {
    const t0 = c.recording.startEpochMs,
      end = t0 + (c.recording.therapyHours || 0) * 3600000;
    const ov = Math.min(oEnd, end) - Math.max(o.t0, t0);
    if (ov > 0 && (!best || ov > best.ov)) best = { c, ov };
  }
  if (best && best.ov > 3600000) pairs.push({ o, c: best.c });
}
console.log(`OxyDex nights: ${oxy.length}  |  paired to a CPAP night (>1 h overlap): ${pairs.length}`);

/* ── classify CPAP events, then couple each class against that night's desats ── */
const CLASSES = { central: [], obstructive: [], hypopnea: [] };
for (const p of pairs) {
  const d = p.o.desats;
  for (const ev of p.c.ganglior_events || []) {
    const bucket = ev.impulse === 'apnea' ? (ev.meta?.class === 'central' ? 'central' : 'obstructive') : ev.impulse === 'hypopnea' ? 'hypopnea' : null;
    if (bucket) CLASSES[bucket].push({ tMs: ev.tMs, durSec: ev.meta?.durSec, _d: d });
  }
}

const WINDOWS = [
  [0, 30e3, '0–30 s'],
  [0, 60e3, '0–60 s'],
  [0, 90e3, '0–90 s'],
  [0, 120e3, '0–120 s']
];
console.log('\n── EVENT → DESAT COUPLING  (observed% vs shuffled-null%, lift) ──');
console.log(
  '  window     ' +
    Object.keys(CLASSES)
      .map((k) => `${k} (n=${CLASSES[k].length})`.padEnd(24))
      .join('')
);
for (const [lo, hi, label] of WINDOWS) {
  const cells = Object.values(CLASSES).map((evs) => {
    // scope each event's B-set to its OWN night (carried on _d)
    const r = couplingPerNight(evs, [lo, hi]);
    return `${r.observedPct.toFixed(1)}% vs ${r.chancePct.toFixed(1)}%  ×${r.lift.toFixed(1)}`.padEnd(24);
  });
  console.log('  ' + label.padEnd(11) + cells.join(''));
}

function couplingPerNight(evs, window) {
  if (!evs.length) return { observedPct: NaN, chancePct: NaN, lift: NaN };
  // each event carries its own night's desats — run the primitive per event-group
  const shifts = [-900e3, -720e3, -600e3, -420e3, -300e3, 300e3, 420e3, 600e3, 720e3, 900e3];
  const rate = (shift) => {
    let h = 0;
    for (const e of evs) {
      const t = e.tMs + shift;
      if (e._d.some((b) => b.tMs - t >= window[0] && b.tMs - t <= window[1])) h++;
    }
    return (h / evs.length) * 100;
  };
  const observedPct = rate(0);
  const chancePct = shifts.map(rate).reduce((s, x) => s + x, 0) / shifts.length;
  return { observedPct, chancePct, lift: observedPct / (chancePct || 1e-9) };
}

/* ── the decisive cut: long apneas MUST desaturate if they matter ─────────── */
console.log('\n── central apneas, stratified by duration (0–90 s window) ──');
for (const [lo, hi, label] of [
  [0, 15, '≤15 s'],
  [15, 25, '15–25 s'],
  [25, 999, '>25 s']
]) {
  const g = CLASSES.central.filter((e) => e.durSec >= lo && e.durSec < hi);
  if (!g.length) continue;
  const r = couplingPerNight(g, [0, 90e3]);
  console.log(`  ${label.padEnd(8)} n=${String(g.length).padStart(4)}   observed ${r.observedPct.toFixed(1)}%   chance ${r.chancePct.toFixed(1)}%   lift ×${r.lift.toFixed(1)}`);
}
