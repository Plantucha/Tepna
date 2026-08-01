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
 *
 * The real O2Ring captures are gitignored personal biosignal data; `--selftest` is what CI can run.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const AS_JSON = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');
const DIR = opt('--dir', null);
const TOP = +opt('--top', 25);

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
  // THE POINT: nGapBeats is what §4 needs, and it moves. nGapSpanIntervals stays 0 on a contiguous
  // grid no matter how many beats are dropped — which is why deferring §4 on it was a category error.
  ok('§4 trigger `nGapBeats` FIRES on a planted mid-rise sentinel run', s && s.nGapBeats > 0, 'nGapBeats=' + (s && s.nGapBeats));
  ok('…while §2 `nGapSpanIntervals` stays 0 (contiguous grid — it cannot see a dropped beat)', s && s.nGapSpanIntervals === 0, 'nGapSpanIntervals=' + (s && s.nGapSpanIntervals));
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}

const sb = realm();
if (SELFTEST) process.exit(selftest(sb));

const PD = sb.PPGDSP;
let files = argv.filter((a) => !a.startsWith('--') && existsSync(a) && statSync(a).isFile());
if (!files.length && DIR) {
  const acc = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/O2Ring.*_PPG\.txt$/i.test(e.name)) acc.push(p);
    }
  };
  walk(DIR);
  files = acc.sort((a, b) => statSync(b).size - statSync(a).size).slice(0, TOP);
}
if (!files.length) {
  console.error('no input — pass files, or --dir <captures dir>; --selftest needs neither');
  process.exit(2);
}

const rows = [];
for (const p of files) {
  let s = null;
  try {
    s = scanText(PD, readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('  ERR ' + basename(p) + ' — ' + ((e && e.message) || e));
    continue;
  }
  if (s) rows.push(Object.assign({ file: basename(p) }, s));
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
if (AS_JSON) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
  process.exit(0);
}
console.log('O2RING-PPG-GAP §4 — is the bridged path really unexercised?\n');
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
