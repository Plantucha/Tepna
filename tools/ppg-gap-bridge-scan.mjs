#!/usr/bin/env node
/*
 * tools/ppg-gap-bridge-scan.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * IS O2RING-PPG-GAP §4 REALLY UNEXERCISED BY REAL DATA?
 *
 * §4 (bridged-interval exclusion) is PROPOSED-deferred, and its stated reason is:
 *
 *     "After §3 the foot-anchored window drops SO FEW beats that on every real segment measured
 *      here the bridged path fired ZERO times (`nGapSpanIntervals: 0 → 0`) — so it is unexercised
 *      by real data and cannot be validated the way §3 was."
 *
 * THAT SENTENCE NAMES THE WRONG COUNTER, and the whole deferral rests on it.
 *
 *   · `nGapSpanIntervals` (§2) counts intervals straddling a TIME DISCONTINUITY in the source —
 *     `intervalsSpanningTimeGap(rec.relSec, …)`. It reads 0 whenever the capture grid is
 *     contiguous, which is most nights, and it says nothing about §4.
 *   · `nGapBeats` (§3) counts beats DROPPED because their foot→peak span touched a gap. Each such
 *     drop is exactly what creates a §4 bridge: the two survivors become adjacent in the array but
 *     NOT in time, so the interval between them spans the removed beat and reads ~2× true.
 *
 * A dropped beat leaves NO discontinuity in `relSec` — the samples are all still there, only the
 * beat is gone — so `spansGap` cannot see it BY CONSTRUCTION. Measuring `nGapSpanIntervals` to
 * decide whether §4 fires is measuring the one quantity guaranteed not to move.
 *
 * This tool reports `nGapBeats` per file, which is §4's actual trigger, by driving the SHIPPED
 * `PPGDSP.parsePPG` + `PPGDSP.analyze` — no reimplementation of the gap logic.
 *
 * USAGE
 *   node tools/ppg-gap-bridge-scan.mjs <file.txt>…            # explicit files
 *   node tools/ppg-gap-bridge-scan.mjs --dir <captures> [--top N]
 *     --json        machine-readable
 *     --selftest    known-answer check on a synthetic gapped record (no corpus, no I/O)
 *     --verdict-sample   the population verdict alone, over a synthetic offer, for the adoption gate
 *
 * The real O2Ring captures are gitignored personal biosignal data; `--selftest` is what CI can run.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { isCliEntry, positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { notCovered, populationVerdict, snapshotEntries } from './corpus-scope-core.mjs';

/* ONE spec, read twice: the guard refuses an undeclared flag with it, and `positionalArgs`
   skips each valued flag's VALUE with it, so a flag written before the positional cannot be
   mistaken for the positional (residue `2026-10-21-a-dash-test-picker-takes-a-valued-flags-value`). */
const ARGV_SPEC = { valued: ['--dir', '--top'], boolean: ['--json', '--selftest', '--verdict-sample'], positional: true };

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const argv = process.argv.slice(2);
/* `process.argv` BELONGS TO WHOEVER IS RUNNING: at module scope this refusal would read the
   IMPORTER's arguments, so it runs for the CLI only (residue
   `2026-10-20-four-argv-adopters-refuse-at-module-scope-and-export`). */
if (isCliEntry(import.meta.url)) refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'ppg-gap-bridge-scan' });
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const AS_JSON = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');
const DIR = opt('--dir', null);
const TOP = +opt('--top', 25);
const TOOL = 'tools/ppg-gap-bridge-scan.mjs';

/* THE OFFER IS ONE FUNCTION, so the snapshot taken before the reads and the one taken after them are
   the same enumeration and a corpus that moved mid-run reads as SHORTFALL rather than vanishing
   (§∅; residue `2026-10-21-forty-one-corpus-enumerators-report-no-population`). */
const PPG_NAME_RE = /O2Ring.*_PPG\.txt$/i;
function listPpgFiles(root) {
  const acc = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (PPG_NAME_RE.test(e.name)) acc.push(p);
    }
  };
  walk(root);
  return acc;
}

/* The population verdict ALONE, over a synthetic offer: the real captures are gitignored, and the
   adoption gate parses stdout as one object.
   🔴 THIS SNAPSHOT USED TO BE A HAND-WRITTEN MIRROR of what `snapshotEntries` returns, and a
   mirror drifts in silence. It carried `ruleIsDefault: true`, asserting a comparison against the
   night yardstick that nobody ran over a file listing, and the primitive's own fix could not reach
   it (row 2026-10-26-the-entries-walk-asserts-a-night-rule-answer-it-never-computed). So the sample
   now calls the REAL primitive over a synthetic lister: the shape cannot disagree with the one this
   tool emits, because it IS that shape. */
const SAMPLE_AT = '2026-10-26T00:00:00Z';
const SAMPLE_MEMBERS = ['O2Ring_20260610_PPG.txt', 'O2Ring_20260611_PPG.txt'];

/* The sample's POPULATION, exposed on its own so a leg can read the snapshot itself. The verdict
   below cannot stand in for it: `populationVerdict` recomputes the digest from the members and never
   publishes `ruleIsDefault` at all, so a verdict-level comparison passes over a hand-written mirror
   without a symptom. That is the side this unit is about, so that is the side the leg reads. */
function sampleSnapshot() {
  return snapshotEntries('<captures>', { list: () => SAMPLE_MEMBERS, unit: 'ppg-files', at: SAMPLE_AT });
}

function verdictSample() {
  const snap = sampleSnapshot();
  return populationVerdict(snap, snap, { tool: TOOL, at: SAMPLE_AT, evidence: [TOOL] });
}

/* The sample answers above every refusal below, because it runs where the corpus is absent. */
if (isCliEntry(import.meta.url) && argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample(), null, 2));
  process.exit(0);
}

function realm() {
  const DexBuild = require(join(ROOT, 'tools/build-core.js'));
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => null
  });
  const sb = {
    console,
    Math,
    Date,
    JSON,
    RegExp,
    Object,
    Array,
    String,
    Number,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    Error,
    Float64Array,
    Float32Array,
    Int32Array,
    Uint8Array,
    ArrayBuffer,
    TextDecoder,
    Map,
    Set,
    Symbol,
    Promise,
    performance,
    document: { createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: el(), body: el(), documentElement: el() },
    navigator: { userAgent: 'node' }
  };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  vm.createContext(sb);
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-spec.js', 'signal-frame.js', 'ppgdex-dsp.js'])
    if (existsSync(join(ROOT, f))) vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8'), f), sb, { filename: f });
  return sb;
}

/* One file → the two counters, from the SHIPPED analyze(). */
function scanText(PD, text) {
  const rec = PD.parsePPG(text);
  if (!rec || !rec.n) return null;
  const r = PD.analyze(rec, null);
  return {
    site: rec.site,
    n: rec.n,
    durSec: rec.durSec || 0,
    sentinelRejected: rec.sentinelRejected || 0,
    nGapBeats: r.nGapBeats || 0, // §4's ACTUAL trigger
    nGapSpanIntervals: r.nGapSpanIntervals || 0, // §2's counter — NOT §4's
    beats: r.nn ? r.nn.length : 0
  };
}

/* A synthetic single-channel record with a sentinel run planted mid-beat, so the known answer is
   "gapBeats drops at least one beat" WITHOUT any real corpus. This is the committed adversarial
   twin: it makes the claim "§4 is unexercised" falsifiable on a machine with no medical data. */
function synthGapped() {
  const FS = 125.7,
    DUR = 120,
    N = Math.round(FS * DUR);
  let out = 'Phone timestamp;sensor timestamp [ns];channel 0\n';
  const t0 = Date.UTC(2026, 6, 25, 1, 0, 0);
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    // ~60 bpm pulse with a sharp-ish foot→peak rise so detectBeats has real feet to anchor to.
    const ph = (t % 1.0) / 1.0;
    let v = 1000 + 200 * Math.exp(-Math.pow((ph - 0.18) / 0.07, 2)) + 60 * Math.exp(-Math.pow((ph - 0.42) / 0.11, 2));
    // Two sentinel runs (the O2Ring's 156 marker) planted so they STRADDLE A FOOT — the beat troughs
    // sit at whole seconds here. That placement is load-bearing, not incidental: `gapBeats` drops a
    // beat only when a gap sample lands within GAP_FOOT_SPAN (±3 samples, ~24 ms) of the FOOT, which
    // is the whole point of §3's foot-anchored window. A first draft planted the runs mid-rise, well
    // clear of the foot, and nGapBeats came back 0 — a twin that would have "confirmed" the very
    // deferral this tool disproves.
    if ((t > 39.85 && t < 40.15) || (t > 74.85 && t < 75.15)) v = 156;
    const ms = new Date(t0 + Math.round(t * 1000)).toISOString().replace('Z', '');
    out += ms + ';' + Math.round(t * 1e9) + ';' + Math.round(v) + '\n';
  }
  return out;
}

function selftest(sb) {
  const PD = sb.PPGDSP;
  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail != null && !cond ? '  — ' + detail : ''));
    if (!cond) fail++;
  };
  if (!(PD && typeof PD.parsePPG === 'function' && typeof PD.analyze === 'function')) {
    console.log('  FAIL ppgdex-dsp did not expose parsePPG/analyze');
    return 1;
  }
  const s = scanText(PD, synthGapped());
  ok('synthetic gapped record parses as the finger layout', s && s.site === 'finger', JSON.stringify(s));
  ok('…and carries rejected sentinels', s && s.sentinelRejected > 0, 'sentinelRejected=' + (s && s.sentinelRejected));
  /* THE POINT: `nGapBeats` is what §4 needs, and it moves.
     BEFORE §4 landed, the companion assertion here was `nGapSpanIntervals === 0` — the demonstration
     that the counter the deferral watched CANNOT respond to a dropped beat, because a dropped beat
     leaves the source grid contiguous. That was the §4a finding and it is why the deferral was a
     category error.
     AFTER §4 landed that assertion inverts BY DESIGN: bridged intervals are now OR-ed into `spansGap`,
     so each dropped beat raises `nGapSpanIntervals` by exactly the bridge it created. The selftest was
     the first thing to detect §4's behavioural change, which is the tool working — so it is updated
     deliberately (never edited to match a surprise) and now pins the POST-§4 contract:
     a planted sentinel run drops beats AND those bridges are counted as exclusions. */
  ok('§4 trigger `nGapBeats` FIRES on a planted mid-rise sentinel run', s && s.nGapBeats > 0, 'nGapBeats=' + (s && s.nGapBeats));
  ok('§4 LANDED · the bridges those drops created are now counted as exclusions, not median-filled', s && s.nGapSpanIntervals > 0, 'nGapSpanIntervals=' + (s && s.nGapSpanIntervals));
  /* …and the two remain DISTINCT quantities: the source grid is still contiguous, so every one of these
     exclusions came from a bridge rather than from a time discontinuity. If §4 were reverted this reads
     0 while nGapBeats stays > 0 — the original §4a separation, now expressed as a floor. */
  ok(
    '…and every exclusion here is a BRIDGE — the synthetic grid carries no time discontinuity',
    s && s.nGapSpanIntervals <= s.nGapBeats,
    'spans=' + (s && s.nGapSpanIntervals) + ' beats=' + (s && s.nGapBeats)
  );
  /* (2) THE POPULATION ARITHMETIC — the real primitives over a synthetic lister, so no corpus and no
     I/O are needed. The lister IS the enumeration for a record population, so these are the only
     assertions that can hold it to the `§∅` line: an unreadable root is not a dataset of zero. */
  const AT = '2026-10-26T00:00:00Z';
  const synthSnap = (members) => snapshotEntries('<t>', { list: () => members, unit: 'ppg-files', at: AT });
  const sorted = synthSnap(['b_PPG.txt', 'a_PPG.txt']);
  ok('a synthetic offer enumerates its members, sorted', sorted.ok && sorted.n === 2 && sorted.members[0] === 'a_PPG.txt', JSON.stringify(sorted.members));
  const unreadable = snapshotEntries('<t>', {
    list: () => {
      const e = new Error('no such directory');
      e.code = 'ENOENT';
      throw e;
    },
    unit: 'ppg-files',
    at: AT
  });
  ok('an unreadable root refuses with a named reason and NEVER an empty population', unreadable.ok === false && /ENOENT/.test(unreadable.reason || ''), JSON.stringify(unreadable.reason));
  const three = synthSnap(['a_PPG.txt', 'b_PPG.txt', 'c_PPG.txt']);
  const named = notCovered(
    three,
    [
      { path: 'a_PPG.txt', ok: true },
      { path: 'b_PPG.txt', ok: false }
    ],
    { key: 'path' }
  );
  ok('a member whose read FAILED is named unscored, not covered by membership', named.join(',') === 'b_PPG.txt,c_PPG.txt', named.join(','));
  const moved = populationVerdict(three, synthSnap(['a_PPG.txt', 'b_PPG.txt']), { tool: TOOL, at: AT, evidence: [TOOL] });
  ok(
    'a population that moved mid-run reads SHORTFALL over the intersection',
    moved.status === 'SHORTFALL' && moved.population.checked === 2 && moved.population.eligible === 3,
    moved.status + ' ' + JSON.stringify(moved.population)
  );
  const sample = verdictSample();
  ok(
    'the corpus-free sample is one valid tepna.verdict/1 over a non-empty population',
    sample.schema === 'tepna.verdict/1' && sample.population.checked === 2 && sample.population.checked + sample.population.excluded === sample.population.eligible,
    JSON.stringify(sample.population)
  );
  /* THE MIRROR IS GONE, AND THIS LEG IS WHAT KEEPS IT GONE. A hand-written snapshot drifts from the
     primitive without a symptom, which is how `ruleIsDefault: true` survived the primitive's own
     fix. Rebuilding the sample's population through `snapshotEntries` here must reproduce it field
     for field, so any future hand-rolling reds. */
  const sampleSnap = sampleSnapshot();
  const fromPrimitive = snapshotEntries('<captures>', { list: () => ['O2Ring_20260610_PPG.txt', 'O2Ring_20260611_PPG.txt'], unit: 'ppg-files', at: sampleSnap.at });
  ok(
    'the sample population comes FROM the primitive, so no hand-written mirror can drift from it',
    JSON.stringify(sampleSnap) === JSON.stringify(fromPrimitive),
    JSON.stringify({ sample: sampleSnap.digest, primitive: fromPrimitive.digest })
  );
  ok(
    'and it therefore gives no night-rule answer, which is the field the verdict never publishes',
    sampleSnap.ruleIsDefault === null && sampleSnap.ruleIsDefault !== true,
    JSON.stringify(sampleSnap.ruleIsDefault)
  );
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}

const sb = realm();
if (SELFTEST) process.exit(selftest(sb));

const PD = sb.PPGDSP;
const argvPaths = positionalArgs(argv, ARGV_SPEC);
if (!argvPaths.length && !DIR) {
  console.error('no input — pass files, or --dir <captures dir>; --selftest and --verdict-sample need neither');
  process.exit(2);
}

/* THE POPULATION IS NAME-SELECTED, AND A NAME IS A DECISION. `O2Ring*_PPG.txt` is what the walk
   offers, and the capture tree holds sidecars, derived files and a clip beside each export that the
   name leaves out — `tools/h10-session-rate.mjs` measured 709 `ecg`-shaped names where 641 were
   exports. So the OFFER travels as the population, and every member this run did not score is NAMED,
   because a count names nothing a reader can chase. `--top` is a SELECTION over that offer, never a
   narrowing of it. */
const offer = argvPaths.length ? snapshotEntries('(argv)', { list: () => argvPaths, unit: 'ppg-files' }) : snapshotEntries(DIR, { list: listPpgFiles, unit: 'ppg-files' });
if (!offer.ok) {
  console.error('ppg-gap-bridge-scan: ' + offer.reason + ' — an unreadable root is not an empty corpus');
  process.exit(2);
}
const dropped = [];
const readable = offer.members.filter((p) => {
  if (existsSync(p) && statSync(p).isFile()) return true;
  dropped.push({ file: basename(p), why: 'not a readable file' });
  return false;
});
/* Explicit paths are scanned as written; only the `--dir` walk ranks by size and takes `--top`. */
const files = argvPaths.length
  ? readable
  : readable
      .slice()
      .sort((a, b) => statSync(b).size - statSync(a).size)
      .slice(0, TOP);
const selected = new Set(files);
for (const p of readable) if (!selected.has(p)) dropped.push({ file: basename(p), why: 'not in --top ' + TOP });
if (!files.length) {
  console.error('nothing to scan — the offer held ' + offer.n + ' name(s) and none was a readable file');
  process.exit(2);
}

const rows = [];
const scoredOk = new Set();
for (const p of files) {
  let s = null;
  try {
    s = scanText(PD, readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('  ERR ' + basename(p) + ' — ' + ((e && e.message) || e));
    dropped.push({ file: basename(p), why: 'read failed: ' + ((e && e.message) || e) });
    continue;
  }
  if (s) {
    rows.push(Object.assign({ file: basename(p) }, s));
    scoredOk.add(p);
  } else dropped.push({ file: basename(p), why: 'no scan — not a recognised PPG layout' });
}

const fired = rows.filter((r) => r.nGapBeats > 0);
const totalDropped = rows.reduce((a, r) => a + r.nGapBeats, 0);
const spanFired = rows.filter((r) => r.nGapSpanIntervals > 0);
const summary = {
  filesScanned: rows.length,
  filesWhereGapBeatsDropped: fired.length,
  totalBeatsDropped: totalDropped,
  maxDroppedInOneFile: rows.reduce((a, r) => Math.max(a, r.nGapBeats), 0),
  filesWhereNGapSpanIntervalsNonZero: spanFired.length
};
/* The population goes out ABOVE the summary, because a reader who stops at the first number must
   still see the set it was cut over. `notCovered` reads `ok === false`, so a member whose read
   failed counts as unscored instead of covered by membership alone. In explicit-paths mode the two
   snapshots are the same object BY CONSTRUCTION: argv cannot move between two reads of it. */
const population = populationVerdict(offer, argvPaths.length ? offer : snapshotEntries(DIR, { list: listPpgFiles, unit: 'ppg-files' }), { tool: TOOL, evidence: [TOOL] });
const unscored = notCovered(
  offer,
  offer.members.map((p) => ({ path: p, ok: scoredOk.has(p) })),
  { key: 'path' }
).map((p) => basename(p));

if (AS_JSON) {
  console.log(JSON.stringify({ population, summary, unscored, dropped, rows }, null, 2));
  process.exit(0);
}
console.log('O2RING-PPG-GAP §4 — is the bridged path really unexercised?\n');
console.log(
  '  population: ' +
    population.status +
    ' — ' +
    population.population.checked +
    ' of ' +
    population.population.eligible +
    ' ' +
    offer.unit +
    ' offered under ' +
    String(PPG_NAME_RE) +
    (population.reason ? '\n  ' + population.reason : '')
);
/* NAMES, capped for a console only: every one of them is in `--json`, which is the machine form. */
const shown = unscored.slice(0, 12);
console.log(
  '  offered but not scored: ' +
    (unscored.length ? shown.join(', ') + (unscored.length > shown.length ? ' … and ' + (unscored.length - shown.length) + ' more (all of them are in --json)' : '') : 'none')
);
for (const d of dropped.slice(0, 12)) console.log('    · ' + d.file + ' — ' + d.why);
console.log('');
for (const r of rows)
  console.log(
    '  ' +
      r.file.padEnd(48) +
      ' dur=' +
      r.durSec.toFixed(0).padStart(6) +
      's  beats=' +
      String(r.beats).padStart(5) +
      '  nGapBeats=' +
      String(r.nGapBeats).padStart(3) +
      '  nGapSpanIntervals=' +
      String(r.nGapSpanIntervals).padStart(4)
  );
console.log('\n  files scanned                          : ' + summary.filesScanned);
console.log('  files where gapBeats DROPPED a beat    : ' + summary.filesWhereGapBeatsDropped + '   ← §4 is exercised on each of these');
console.log('  total beats dropped                    : ' + summary.totalBeatsDropped + ' (max ' + summary.maxDroppedInOneFile + ' in one file)');
console.log('  files where nGapSpanIntervals ≠ 0      : ' + summary.filesWhereNGapSpanIntervalsNonZero + '   (§2’s counter — not §4’s trigger)');
