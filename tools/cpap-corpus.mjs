/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * cpap-corpus.mjs — drive a WHOLE ResMed SD card through the REAL CPAPDex.
 *
 * Walks a day-foldered SD-card tree, groups each night's EDF files into session
 * sets, and runs the real headless surface — CPAPDex.compute({edfSets}) → a
 * `ganglior.node-export` per night — in a vm realm co-loaded exactly as
 * CPAPDex.src.html does. No re-implemented parser; the modules under test ARE
 * the shipped ones.
 *
 * This is the harness behind briefs/CPAP-REAL-CORPUS-2026-07-11-BRIEF.md, and it
 * is the existence proof for that brief's §F3: the FIXTURE-PROVENANCE claim that
 * CPAPDex "can't join the equivalence gate (its real input is a BINARY multi-file
 * EDF set, not a {text}/CSV)" is FALSE — binary multi-file EDF runs headless in
 * Node just fine.
 *
 *   node tools/cpap-corpus.mjs --root <sd-card-dir> [--out exports.json] [--stats]
 *
 * The tree is the stock ResMed layout: <root>/YYYYMMDD/YYYYMMDD_HHMMSS_{BRP,PLD,SA2,EVE,CSL}.edf
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ESM-MIGRATION: shed cpapdex-dsp.js's top-level export/import via the single classicify source before
// vm-loading (else "Unexpected token 'export'"). No-op on the classic co-load files.
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── args ─────────────────────────────────────────────────────────────────── */
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const ROOT = arg('--root', null);
const OUT = arg('--out', null);
const STATS = process.argv.includes('--stats');
if (!ROOT) {
  console.error('usage: node tools/cpap-corpus.mjs --root <sd-card-dir> [--out exports.json] [--stats]');
  process.exit(2);
}

/* ── realm: the CPAPDex.src.html script order (headless subset — no render/app) ── */
export function cpapRealm() {
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
  const sandbox = {
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
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  // NOTE: cpapdex-cross.js MUST be co-loaded — buildLongitudinal() reaches CPAPCross
  // through the browser global only (cpapdex-dsp.js:227), so a plain require() realm
  // gets crossNight:null SILENTLY. See the brief's §F5.
  const CO_LOAD = [
    'kernel-constants.js',
    'ganglior-provenance.js',
    'signal-frame.js',
    'metric-registry.js',
    'clock.js',
    'crossnight-envelope.js',
    'cpapdex-registry.js',
    'cpapdex-edf.js',
    'cpapdex-dsp.js',
    'cpapdex-cross.js',
    'cpapdex-fusion.js'
  ];
  for (const f of CO_LOAD) vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

/* ── SD-card tree → per-night EDF session sets ────────────────────────────────
   The session-grouping rule, which is NOT obvious and has one trap:
     cluster files whose stamps are within ±60 s of the set's anchor, AND
     a SECOND file of a type opens a NEW set.
   Without that second clause a brief mask-off/on inside one minute writes a
   second CSL/EVE pair that silently OVERWRITES the first → lost events.
   (8 sessions in the reference corpus hit exactly this.)                      */
export function sessionSetsForDay(dir) {
  const stampOf = (f) => {
    const m = /^(\d{8})_(\d{6})_([A-Z0-9]+)\.edf$/i.exec(f);
    if (!m) return null;
    const [, d, t, type] = m;
    const sec = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)) / 1000;
    return { sec, type: type.toUpperCase(), file: f };
  };
  const stamps = fs
    .readdirSync(dir)
    .map(stampOf)
    .filter(Boolean)
    .sort((a, b) => a.sec - b.sec);
  const clusters = [];
  for (const s of stamps) {
    const c = clusters.find((c) => Math.abs(c.sec - s.sec) <= 60 && !c.byType[s.type]);
    if (c) c.byType[s.type] = s;
    else clusters.push({ sec: s.sec, byType: { [s.type]: s } });
  }
  return clusters;
}

/* ── run ──────────────────────────────────────────────────────────────────── */
const ctx = cpapRealm();
const exports_ = [];
const problems = [];

for (const day of fs
  .readdirSync(ROOT)
  .filter((d) => /^\d{8}$/.test(d))
  .sort()) {
  const dir = path.join(ROOT, day);
  const clusters = sessionSetsForDay(dir);
  if (!clusters.length) {
    problems.push({ day, why: 'empty folder' });
    continue;
  }

  const sets = [];
  for (const c of clusters) {
    const set = {};
    for (const [type, s] of Object.entries(c.byType)) {
      const b = fs.readFileSync(path.join(dir, s.file));
      try {
        set[type] = ctx.CpapEdf.readEDF(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      } catch (e) {
        problems.push({ day, why: 'EDF read: ' + e.message, file: s.file });
      }
    }
    set._fname = day + '/' + Object.values(c.byType)[0].file;
    sets.push(set);
  }

  let exp = null;
  try {
    exp = ctx.CPAPDex.compute({ edfSets: sets });
  } catch (e) {
    problems.push({ day, why: 'compute: ' + e.message });
    continue;
  }
  if (!exp) {
    problems.push({ day, why: 'compute returned null' });
    continue;
  }
  exp._day = day;
  exports_.push(exp);
}

const hours = exports_.reduce((s, e) => s + (e.recording?.therapyHours || 0), 0);
const evs = exports_.reduce((s, e) => s + (e.ganglior_events || []).length, 0);
console.log(`nights: ${exports_.length}  |  therapy hours: ${hours.toFixed(1)}  |  ganglior events: ${evs}  |  problems: ${problems.length}`);
for (const p of problems) console.log(`  ! ${p.day}: ${p.why}${p.file ? ' (' + p.file + ')' : ''}`);

if (STATS) {
  const mean = (a) => {
    const f = a.filter((x) => x != null && isFinite(x));
    return f.length ? f.reduce((s, x) => s + x, 0) / f.length : NaN;
  };
  const col = (k) => exports_.map((e) => e.metrics?.[k]);
  console.log('\n  metric              mean');
  for (const k of ['usageHours', 'residualAHI', 'centralIndex', 'obstructiveIndex', 'hypopneaIndex', 'medianPressure', 'p95Pressure', 'epap95', 'p95Leak', 'largeLeakPct']) {
    const m = mean(col(k));
    console.log(`  ${k.padEnd(20)}${(isFinite(m) ? m.toFixed(2) : '–').padStart(7)}`);
  }
  const mix = {};
  exports_.forEach((e) =>
    (e.ganglior_events || []).forEach((ev) => {
      mix[ev.impulse] = (mix[ev.impulse] || 0) + 1;
    })
  );
  console.log('\n  impulse mix:', JSON.stringify(mix));
}

if (OUT) {
  fs.writeFileSync(
    OUT,
    JSON.stringify({ exports: exports_, problems }, (k, v) => (ArrayBuffer.isView(v) ? undefined : v))
  );
  console.log(`\nwrote ${OUT}`);
}
