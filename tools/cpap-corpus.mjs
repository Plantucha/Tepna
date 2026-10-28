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
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';

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
// EDF names whose stamp field the owner refused — folded into `problems` below, never dropped silently.
const stampRefusals = [];
/* ── THE POPULATION THIS HARNESS REPORTS OVER ────────────────────────────────────────────────
   Row 2026-10-21-forty-one-corpus-enumerators-report-no-population. The headline said
   `nights: N`, which counted the day folders that COMPUTED — never what the card offered, so a
   card half of whose nights failed to read reported the same shape as a clean one, and `problems`
   carried the difference in prose only. The population below is the day-folder set this run
   walked, published once before the read and once after, so a folder arriving or leaving mid-run
   is a FAIL rather than a silently different denominator. */
const POP_TOOL = 'tools/cpap-corpus.mjs';
const POP_EV = [POP_TOOL, 'tools/corpus-scope-core.mjs'];
/* A NAMED lister: `snapshotEntries` publishes `rule: list.name`, and an inline arrow publishes
   `rule: null`. This function IS the walk below — the stock ResMed day folder, `YYYYMMDD`. */
function listDayFolders(root) {
  return fs
    .readdirSync(root)
    .filter((d) => /^\d{8}$/.test(d))
    .sort();
}
function sampleDays() {
  return ['20260610', '20260611', '20260612'];
}
/* THE SAMPLE LIVES IN A NAMED HELPER, because `corpus-reads.mjs` blanks a `verdictSample` body
   before it decides whether this tool reports a population: a fabricated call left at top level
   would clear the tool over a walk no run makes. It reads no card and prints the object ALONE,
   because `verify:verdict-adoption` parses stdout as JSON. */
function verdictSample() {
  const at = '2026-10-28T00:00:00Z';
  const snap = snapshotEntries('<sd-card>/DATALOG', { list: sampleDays, unit: 'days', at });
  return populationVerdict(snap, snap, { tool: POP_TOOL, at, evidence: POP_EV });
}
if (process.argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
/* The shared exit rule of this slice, pure so a caller and a test can both read it: a card nobody
   can enumerate and a run that computed no night both exit 2; reduced coverage annotates and
   exits 0 (owner ruling 2026-09-17, §∅). */
function exitCodeFor(population, scored) {
  return population.status === 'NOT_RUN' || scored === 0 ? 2 : 0;
}
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
    /* THE FILENAME STAMP HAS ONE OWNER — `DexClock.fileStamp` (clock.js:255; Clock Contract §4,
       anchor source 2), off the realm this module already loads `clock.js` into. The slices that
       stood here fed a bare `Date.UTC`, which rolls an out-of-range component onto a real instant
       rather than refusing, so a `20261332_225058_BRP.edf` clustered onto
       2027-02-01T22:50:58 (measured 2026-10-27) and the day folder it sat in said nothing. The owner range-validates and requires a plausible year; a
       null is reported as a problem of this day, not filtered away with the non-EDF names (§∅). */
    const got = ctx.DexClock.fileStamp(d + '_' + t);
    if (!got) {
      stampRefusals.push({ day: path.basename(dir), why: 'filename stamp field is not a readable time (DexClock.fileStamp)', file: f });
      return null;
    }
    return { sec: got.tMs / 1000, type: type.toUpperCase(), file: f };
  };
  const stamps = fs
    .readdirSync(dir)
    .map(stampOf)
    .filter(Boolean)
    .sort((a, b) => a.sec - b.sec);
  const clusters = [];
  for (const s of stamps) {
    /* NEAREST eligible cluster, not the FIRST. `find` took whichever cluster came earlier in the
       array, so when two sessions open inside the same minute the waveforms landed on the wrong
       one: 2026-04-21 has CSL/EVE at 20:56:15 and 20:56:28, and BRP/PLD/SA2 at 20:56:33 — 18 s
       from the first, 5 s from the second. They joined the first, leaving the session that
       actually held that night's `CSR Start`/`CSR End` pair with no waveform, hence no duration to
       report a percentage against: the device scored 20 min of periodic breathing and this harness
       reported none. Invisible until §1 made PB measurable at all — while every night read 0, no
       grouping error could show. */
    let best = null,
      bestD = Infinity;
    for (const c of clusters) {
      const d = Math.abs(c.sec - s.sec);
      if (d <= 60 && !c.byType[s.type] && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) best.byType[s.type] = s;
    else clusters.push({ sec: s.sec, byType: { [s.type]: s } });
  }
  return clusters;
}

/* ── run ──────────────────────────────────────────────────────────────────── */
const ctx = cpapRealm();
const exports_ = [];
const problems = [];

const snapBefore = snapshotEntries(ROOT, { list: listDayFolders, unit: 'days' });
if (!snapBefore.ok) {
  console.error(`refused: ${snapBefore.reason} — ${ROOT}`);
  console.log('POPULATION ' + JSON.stringify(populationVerdict(snapBefore, snapBefore, { tool: POP_TOOL, evidence: POP_EV })));
  process.exit(2);
}
const commitOf = gitCommitOf();

/* The loop walks the SNAPSHOT, not a second `readdirSync`: the published population and the
   scored set then come from one enumeration, so the arithmetic control below is about the run
   rather than about two reads of the same directory. */
for (const day of snapBefore.members) {
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

problems.push(...stampRefusals);

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

/* ── ONE PUBLISHER, CALLED BEFORE THE ONE EXIT ───────────────────────────────────────────────
   `problems` already names each failure, but nothing said what the denominator was: the two
   counts that matter are the folders the card OFFERED and the nights that produced an export. */
function publishPopulation() {
  const population = populationVerdict(snapBefore, snapshotEntries(ROOT, { list: listDayFolders, unit: 'days' }), {
    commit: commitOf.commit,
    commitReason: commitOf.reason,
    tool: POP_TOOL,
    evidence: POP_EV
  });
  console.log(
    `\npopulation: ${snapBefore.n} day folder(s) offered under ${ROOT} · ${exports_.length} computed a night export · movement ${population.status}` +
      (population.reason ? ` — ${population.reason}` : '')
  );
  const rule = ruleLine(population);
  if (rule) console.log(rule);
  /* The exports, not their names — `notCovered` reads `row[key]`, and the day folder rides each
     export as `_day`. */
  const unscored = notCovered(snapBefore, exports_, { key: '_day' });
  if (unscored.length)
    console.log(`  ${unscored.length} offered day folder(s) produced no export, by name: ${unscored.slice(0, 8).join(' · ')}${unscored.length > 8 ? ` · … (+${unscored.length - 8})` : ''}`);
  if (unscored.length !== snapBefore.n - exports_.length) throw new Error(`population arithmetic: ${snapBefore.n} offered − ${exports_.length} scored ≠ ${unscored.length} unscored`);
  console.log('POPULATION ' + JSON.stringify(population));
  return population;
}

/* 🔴 THIS EXITED 0 OVER AN EMPTY CARD — the way a run that read every night exits. A harness that
   computed no export at all is not a weaker result, it is no result (§∅). */
process.exit(exitCodeFor(publishPopulation(), exports_.length));
