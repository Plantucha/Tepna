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
 * CONSUMER of the shared `event-coupling.js` primitive (was its prototype; the
 * local copy is deleted, so this tool cannot drift from the gated module).
 * Generalizes to any (node A event, node B event) pair — CPAP apnea × desat,
 * ECG arrhythmia × desat, …
 *
 * ⚠️ Re-running this through the FIXED primitive RETRACTED the original §M1
 * magnitude: the prototype's null did not WRAP, so surrogates fell off the end
 * of a night where no desat could match them → chance deflated → lift inflated.
 * Re-derived on 44 paired nights, NO event class couples above chance
 * (CPAP-REAL-CORPUS-FOLLOWUPS §2). Read `maxLift` before believing any `lift`.
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

/* ── THE PRIMITIVE — now imported, not re-implemented (FOLLOWUPS §2) ─────────────────────────
   `coupling()` used to be defined HERE as a prototype. It is now the shared spine module
   `event-coupling.js`, which fixed three defects in this prototype — a non-wrapping null (which
   INFLATED lift), unflagged window saturation, and resonant whole-minute default shifts. Importing
   it means this tool can no longer drift from the gated primitive.                              */
// event-coupling.js is a DUAL-REALM (CommonJS + browser-global) spine module, not an ES module,
// so it arrives as a default export rather than named bindings.
import EventCoupling from '../event-coupling.js';

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
    const sat = r.saturated ? ' SAT' : '';
    return `${r.observedPct.toFixed(1)}% vs ${r.chancePct.toFixed(1)}%  ×${r.lift.toFixed(1)}${sat}`.padEnd(24);
  });
  console.log('  ' + label.padEnd(11) + cells.join(''));
}

/* ── couplingPerNight — now a CONSUMER of the real primitive (FOLLOWUPS §2) ──────────────────
   The prototype that used to live here is GONE. It had three defects, all of which biased toward
   BELIEVING (see event-coupling.js's header), and the one that matters most here is that its null
   shift did NOT WRAP: surrogates displaced off the end of a night could never match a desat, which
   deflates `chance` and therefore INFLATES `lift`. Every magnitude §M1 reported came from that.

   The wrap is only meaningful WITHIN a night, so we run the primitive PER NIGHT (each event carries
   its own night's desats + that night's span) and then POOL — summing hits and n across nights
   rather than averaging per-night percentages, so a 20-event night cannot outvote a 200-event one. */
function couplingPerNight(evs, window) {
  if (!evs.length) return { n: 0, observedPct: NaN, chancePct: NaN, lift: NaN, saturated: false };

  // group by night (each event carries a reference to its own night's desat array)
  const byNight = new Map();
  for (const e of evs) {
    if (!byNight.has(e._d)) byNight.set(e._d, []);
    byNight.get(e._d).push(e);
  }

  let nTot = 0,
    hitsTot = 0,
    chanceWeighted = 0,
    satNights = 0;
  for (const [desats, nightEvs] of byNight) {
    if (!desats.length) {
      nTot += nightEvs.length;
      continue;
    } // no desats that night → 0 hits, still counts
    // span = the night itself, so the circular shift stays inside the recording
    const all = [...nightEvs.map((e) => e.tMs), ...desats.map((d) => d.tMs)];
    const span = [Math.min(...all), Math.max(...all)];
    const r = EventCoupling.coupling(nightEvs, desats, { window, span });
    nTot += r.n;
    hitsTot += r.hits;
    if (isFinite(r.chancePct)) chanceWeighted += r.chancePct * r.n;
    if (r.saturated) satNights++;
  }
  const observedPct = nTot ? (hitsTot / nTot) * 100 : NaN;
  const chancePct = nTot ? chanceWeighted / nTot : NaN;
  const maxLift = chancePct > 0 ? 100 / chancePct : Infinity;
  return {
    n: nTot,
    observedPct,
    chancePct,
    lift: chancePct > 0 ? observedPct / chancePct : NaN,
    maxLift,
    // a window this wide is uninformative BY ARITHMETIC — lift cannot exceed maxLift
    saturated: isFinite(maxLift) && maxLift < 1.5,
    satNights
  };
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
  console.log(
    `  ${label.padEnd(8)} n=${String(g.length).padStart(4)}   observed ${r.observedPct.toFixed(1)}%   chance ${r.chancePct.toFixed(1)}%   lift ×${r.lift.toFixed(1)}   maxLift ×${r.maxLift.toFixed(1)}${r.saturated ? '  [SATURATED — uninformative]' : ''}`
  );
}
