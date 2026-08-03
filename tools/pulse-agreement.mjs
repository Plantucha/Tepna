#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pulse-agreement.mjs — the O2Ring's 1 Hz VENDOR pulse vs an HR derived from its own finger PPG.
 * ----------------------------------------------------------------------------
 * OXYDEX-PULSE-RESOURCING-FOLLOWUPS §3 asks for the MEASURED agreement on the real corpus; the parent
 * only has a synthetic (Δ≈2 bpm). A negative result is explicitly allowed.
 *
 * ── WHY THE FIRST TWO PASSES FAILED, AND WHAT PAIRS THE DATA CORRECTLY ──────────────────────────
 *
 * Pass 1 compared the largest PPG FRAGMENT against the WHOLE-NIGHT vendor median: bias −0.83 bpm,
 * SD 4.58, LoA −9.8…+8.1 — numbers that look publishable and are meaningless, because the two series
 * cover different spans.
 *
 * Pass 2 restricted to a matched window and found that on 5 of 6 nights the fragment and the vendor
 * file share ZERO samples. It reported n=1 and refused to estimate, which was right — but it read the
 * cause as "different capture sessions on the same date" and stopped there.
 *
 * THE ACTUAL CAUSE is one line of file selection. The ring writes ONE `_SPO2.csv` PER `_PPG.txt`,
 * sharing a 14-digit session stamp:
 *     Wellue_O2Ring-S_S8AW2100_20260727001113_PPG.txt
 *     Wellue_O2Ring-S_S8AW2100_20260727001113_SPO2.csv
 * Pass 2 took `find … _SPO2.csv | head -1` (an arbitrary session) and the LARGEST `_PPG.txt` (usually
 * a different one), so on almost every night it window-matched two unrelated sessions and correctly
 * found no overlap. Measured over the corpus: 117 PPG fragments against ~115 SPO2 CSVs, 1:1 per
 * session. Nothing was wrong with the data and nothing needed session INFERENCE — the pairing key
 * was in the filename all along.
 *
 * ── WHAT THIS TOOL MEASURES ─────────────────────────────────────────────────────────────────────
 *
 * Pairs by session stamp, then compares PER 5-MIN EPOCH rather than one median per session: PPGDSP
 * already yields `epochs[].hr` from its own beat detection, so each epoch is matched against the
 * median vendor pulse over that epoch's OWN wall-clock window. That turns a handful of session
 * medians into a paired series, which is what a Bland-Altman needs.
 *
 * ── WHAT IT STILL REFUSES TO DO ─────────────────────────────────────────────────────────────────
 *
 * NO SILENT FALLBACK. An epoch whose vendor window is thinly covered is DROPPED and counted, never
 * back-filled from a wider window; a session with no usable epoch is SKIPPED and counted. A silent
 * fallback converts "these do not overlap" into a bias — the same failure shape as reporting a
 * sentinel-filled file as coverage (CPAP-SA2-OXIMETRY-SOURCE, refuted the same day).
 *
 * Both sides are stamped with `DexClock.parseTimestamp`, never `Date.parse` — the O2Ring writes
 * `HH:MM:SS DD/MM/YYYY`, which `Date.parse` returns NaN for. Pass 1 did exactly that, matched zero
 * samples, and fell through to the invalid comparison above without erroring.
 *
 * USAGE  node tools/pulse-agreement.mjs [--src <dir>] [--min-cov 0.5]
 * ════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, existsSync, statSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const R = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const SRC = opt('--src', '/run/media/michal/647A504F7A50205A');
/* Fraction of an epoch's 300 s that must carry a vendor sample for the epoch to be paired. Deliberately
   not tuned: it is "at least half the window actually observed". `--min-cov` re-runs it, and the
   sensitivity is reported in the brief rather than assumed away. */
const MIN_COV = +opt('--min-cov', '0.5');

const el = () => ({
  style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {},
  addEventListener() {},
  setAttribute() {},
  getAttribute: () => null,
  querySelector: () => null
});
function realm() {
  const DexBuild = require(R + 'tools/build-core.js');
  const ctx = {
    console,
    Math,
    Date,
    JSON,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    Number,
    String,
    Array,
    Object,
    TextDecoder,
    performance,
    Set,
    Map,
    Symbol,
    Float64Array,
    Float32Array,
    Uint8Array,
    Int32Array,
    RegExp,
    Error,
    Promise,
    ArrayBuffer,
    DataView
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.document = { createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: el(), body: el(), documentElement: el() };
  ctx.navigator = { userAgent: 'node' };
  vm.createContext(ctx);
  for (const f of ['kernel-constants.js', 'clock.js', 'ppgdex-dsp.js']) vm.runInContext(DexBuild.classicify(readFileSync(R + f, 'utf8'), f), ctx, { filename: f });
  return ctx;
}

/* ── child mode: analyse ONE session, emit one JSON line ─────────────────────────────────────────
   A child per session because the corpus holds 140 MB fragments: a fresh heap per session is
   returned to the OS on exit, so nothing accumulates across 117 of them. */
if (argv.includes('--one')) {
  const ppgPath = opt('--one', null);
  const csvPath = opt('--csv', null);
  const ctx = realm();
  const out = { ppg: path.basename(ppgPath), ok: false, reason: null, epochs: [], t0Ms: null, durSec: null, vendor: [] };
  try {
    ctx.__t = readFileSync(ppgPath, 'utf8');
    const r = JSON.parse(
      vm.runInContext(
        `(function(){
           var rec = PPGDSP.parsePPG(__t);
           var a = PPGDSP.analyze(rec);
           return JSON.stringify({
             t0Ms: rec.t0Ms, durSec: rec.durSec, fs: rec.fs, site: rec.site,
             epochs: (a && a.epochs ? a.epochs : []).map(function (e) { return { tMin: e.tMin, hr: e.hr }; })
           });
         })()`,
        ctx
      )
    );
    ctx.__t = null;
    Object.assign(out, r, { ok: true });
  } catch (e) {
    out.reason = 'analyze failed: ' + String((e && e.message) || e).slice(0, 120);
  }
  try {
    const lines = readFileSync(csvPath, 'utf8').trim().split('\n');
    const hdr = lines[0].split(/[;,]/).map((x) => x.trim().toLowerCase());
    const pi = hdr.findIndex((h) => /pulse|hr\b|heart/.test(h));
    const ti = hdr.findIndex((h) => /time|stamp/.test(h));
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(/[;,]/);
      const v = +c[pi];
      if (!(isFinite(v) && v >= 30 && v <= 220)) continue;
      ctx.__s = String(c[ti]).trim();
      const t = vm.runInContext('(function(){var p=DexClock.parseTimestamp(__s,{preferDMY:true});return p?p.tMs:null;})()', ctx);
      if (t != null) out.vendor.push([t, v]);
    }
  } catch {
    out.reason = (out.reason ? out.reason + '; ' : '') + 'vendor read failed';
  }
  /* SYNCHRONOUS write to fd 1, looping over partial writes. A long session's JSON is ~500 KB, and
     `process.stdout.write` to a PIPE is ASYNC: followed by `process.exit()` it truncates at the pipe
     buffer boundary — measured, every payload cut at exactly 146176 bytes. The parent then failed to
     JSON.parse it and counted the session "analyse failed", silently dropping the SEVEN LARGEST
     sessions (the actual overnight recordings) while still printing a healthy-looking bias from the
     short fragments that survived. Dropping the `exit()` instead makes the child hang, because the
     vm realm keeps the loop alive — so write synchronously and exit deliberately.
     (Redirecting to a FILE hides the whole bug: file writes are already synchronous.) */
  const buf = Buffer.from(JSON.stringify(out) + '\n');
  for (let off = 0; off < buf.length; ) off += writeSync(1, buf, off, buf.length - off);
  process.exit(0);
}

/* ── parent: enumerate sessions, fan out, aggregate ──────────────────────────────────────────── */
const med = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

let found = '';
try {
  found = execFileSync('find', [SRC, '-name', '*O2Ring*_PPG.txt'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
} catch {
  /* find exits non-zero on unreadable subtrees; whatever it printed is still usable */
}
/* One entry per SESSION STAMP — the corpus is mirrored across several trees, so the same basename
   appears more than once; the stamp is the identity, the path is incidental. */
const byStamp = new Map();
for (const raw of found.split('\n')) {
  const p = raw.trim();
  if (!p) continue;
  const m = path.basename(p).match(/_(\d{14})_PPG\.txt$/);
  if (m && !byStamp.has(m[1])) byStamp.set(m[1], p);
}
const stamps = [...byStamp.keys()].sort();
if (!stamps.length) {
  console.log('no O2Ring *_PPG.txt found under ' + SRC);
  process.exit(0);
}

console.log(`O2Ring vendor pulse vs finger-PPG HR — ${stamps.length} session(s) under ${SRC}`);
console.log("paired PER 5-MIN EPOCH on each session's own wall-clock window (see file header for why)\n");

const pairs = [];
const perSession = [];
let noCsv = 0,
  failed = 0,
  noEpoch = 0,
  thin = 0;

for (const st of stamps) {
  const ppgPath = byStamp.get(st);
  const csvPath = ppgPath.replace(/_PPG\.txt$/, '_SPO2.csv');
  const night = st.slice(0, 8);
  if (!existsSync(csvPath)) {
    noCsv++;
    continue;
  }
  let rec;
  try {
    const line = execFileSync(process.execPath, ['--max-old-space-size=6000', SELF, '--one', ppgPath, '--csv', csvPath], {
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString();
    rec = JSON.parse(line.trim().split('\n').pop());
  } catch (e) {
    if (process.env.PA_DEBUG) console.log('    FAIL ' + st + ': ' + String((e && e.message) || e).slice(0, 200));
    failed++;
    continue;
  }
  if (!rec.ok || !rec.epochs.length || rec.t0Ms == null) {
    noEpoch++;
    continue;
  }
  let used = 0;
  for (const e of rec.epochs) {
    if (e.hr == null || !isFinite(e.hr)) continue;
    const a = rec.t0Ms + e.tMin * 60000,
      b = a + 300000;
    const win = rec.vendor.filter((r) => r[0] >= a && r[0] < b).map((r) => r[1]);
    if (win.length < 300 * MIN_COV) {
      thin++;
      continue;
    }
    const v = med(win);
    pairs.push({ night, stamp: st, tMin: e.tMin, ppg: e.hr, vendor: v, d: +(e.hr - v).toFixed(2) });
    used++;
  }
  if (used) perSession.push({ night, stamp: st, epochs: used, sizeMB: +(statSync(ppgPath).size / 1e6).toFixed(1) });
}

console.log(`sessions: ${stamps.length} · no sibling CSV ${noCsv} · analyse failed ${failed} · no usable epoch ${noEpoch}`);
console.log(`epochs dropped for thin vendor coverage (<${Math.round(MIN_COV * 100)}% of 300 s): ${thin}`);
console.log(`\n${perSession.length} session(s) contributed ${pairs.length} paired epoch(s):`);
for (const s of perSession) console.log(`  ${s.night}  ${s.stamp}  ${String(s.epochs).padStart(3)} epoch(s)  ${String(s.sizeMB).padStart(6)} MB`);

if (pairs.length < 10) {
  console.log(`\nn=${pairs.length} paired epochs — too few for a distribution. Reporting the values, not a bias:`);
  for (const p of pairs) console.log(`  ${p.night} t+${p.tMin}min  ppg ${p.ppg}  vendor ${p.vendor}  d ${p.d}`);
  process.exit(0);
}

const ds = pairs.map((p) => p.d);
const bias = ds.reduce((a, b) => a + b, 0) / ds.length;
const sd = Math.sqrt(ds.reduce((a, b) => a + (b - bias) * (b - bias), 0) / (ds.length - 1));
const nights = [...new Set(pairs.map((p) => p.night))];
console.log(`\n-- AGREEMENT (ppg - vendor), ${pairs.length} paired epochs across ${nights.length} night(s) --`);
console.log(`  bias   ${bias.toFixed(2)} bpm`);
console.log(`  SD     ${sd.toFixed(2)} bpm`);
console.log(`  LoA    ${(bias - 1.96 * sd).toFixed(2)} .. ${(bias + 1.96 * sd).toFixed(2)} bpm  (bias +/- 1.96 SD)`);
console.log(`  median d ${med(ds).toFixed(2)} · range ${Math.min(...ds).toFixed(1)} .. ${Math.max(...ds).toFixed(1)}`);

/* PER NIGHT — a bias pooled over epochs is dominated by whichever night contributed most of them, so
   the per-night medians are printed beside it. If they disagree, the pooled figure is the wrong summary. */
console.log('\n  per night (median d, n epochs):');
for (const n of nights) {
  const dn = pairs.filter((p) => p.night === n).map((p) => p.d);
  console.log(`    ${n}  ${med(dn).toFixed(2)} bpm  (n=${dn.length})`);
}
