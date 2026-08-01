#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pb-operating-point.mjs — what does OxyDex's periodic-breathing detector actually track?
 * ----------------------------------------------------------------------------
 * OXYDEX-PB-OVERCALL-2026-07-31 §4 asks for the emission threshold's derivation and an operating-point
 * sweep. This runs the sweep against a real corpus, driving the SHIPPED `processNight` — no reimplementation.
 *
 * THE DETECTOR. A 5-min window is flagged when, per `detectOscillations`:
 *     lowMotion (motion fraction < 0.08)
 *     sustained (>= 40 samples below SPO2_OSC_THRESHOLD)
 *     cross >= OSC_FLAG_CROSSINGS          (crossings of the ABSOLUTE 95 % level)
 * There is NO cycle-length criterion in the gate — `cycleLen` is computed for `meta` only — and no
 * crescendo-decrescendo test. The three constants carry no citation; oxydex-dsp labels them
 * "detector tuning" and "algorithmic" in their own comments.
 *
 * WHY THAT MATTERS. AASM scores Cheyne-Stokes on a 40-90 s cycle length, >= 3 consecutive cycles, and a
 * crescendo-decrescendo envelope, measured against the patient's OWN baseline. An absolute 95 % crossing
 * level is a different quantity: for a subject whose overnight mean sits at 95-96 %, the trace spends most
 * of the night within a point of the line it must cross, and 1 Hz oximetry is reported as INTEGERS — so a
 * value dithering 94/95/96 crosses `>= 95` continually without any breathing periodicity at all.
 *
 * MEASURED (37-night reference corpus, 2026-08-01): flagged on 36/37 nights (97 %), and the episode count
 * correlates r = 0.893 with the fraction of the night below 95 % and r = -0.821 with mean SpO2. It is
 * tracking mild hypoxemia burden, not periodicity — which is why the over-call cannot be tuned away:
 * raising OSC_FLAG_CROSSINGS only makes it a stricter hypoxemia threshold.
 *
 * USAGE
 *   node tools/pb-operating-point.mjs <dir-with-O2Ring-csv>
 *   node tools/pb-operating-point.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n,
    my = y.reduce((a, b) => a + b, 0) / n;
  let s = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx,
      b = y[i] - my;
    s += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx && dy ? s / Math.sqrt(dx * dy) : null;
}

function realm() {
  const DexBuild = require(join(ROOT, 'tools/build-core.js'));
  const el = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML() {},
    get textContent() {
      return '';
    },
    set textContent(v) {},
    get innerHTML() {
      return '';
    },
    set innerHTML(v) {},
    getContext: () => null
  });
  const ctx = {
    console,
    Date,
    Math,
    JSON,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    Object,
    Array,
    String,
    Number,
    Error,
    Float32Array,
    Float64Array,
    Int16Array,
    Int32Array,
    Uint8Array,
    ArrayBuffer,
    DataView,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    performance,
    URL,
    crypto,
    RegExp,
    Map,
    Set,
    Symbol,
    Promise
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.document = { createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: el(), body: el(), documentElement: el() };
  ctx.navigator = { userAgent: 'node' };
  vm.createContext(ctx);
  for (const f of ['kernel-constants.js', 'clock.js', 'oxydex-util.js', 'oxydex-profile.js', 'oxydex-dsp.js']) {
    vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8'), f), ctx, { filename: f });
  }
  return ctx;
}

function selftest() {
  let fail = 0;
  const ok = (n, c) => {
    if (!c) fail++;
    console.log(`  ${c ? '✓' : '✕'} ${n}`);
  };
  ok('pearson is +1 on a perfect increasing pair', Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
  ok('pearson is -1 on a perfect decreasing pair', Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-9);
  ok('pearson is null on a constant series (no variance to correlate)', pearson([1, 1, 1], [1, 2, 3]) === null);
  /* The threshold this tool reasons about must still be the one the DSP uses. A tool that silently
     drifts from the code it judges reports about a detector that no longer exists. */
  const src = readFileSync(join(ROOT, 'oxydex-dsp.js'), 'utf8');
  const thr = src.match(/SPO2_OSC_THRESHOLD:\s*(\d+)/);
  const crs = src.match(/OSC_FLAG_CROSSINGS:\s*(\d+)/);
  ok('SPO2_OSC_THRESHOLD is still 95 (the absolute level this analysis turns on)', thr && thr[1] === '95');
  ok('OSC_FLAG_CROSSINGS is still 6', crs && crs[1] === '6');
  /* And the gate still has NO cycle-length criterion — the moment it gains one, this tool's central
     claim ("it cannot distinguish periodicity") needs re-deriving rather than re-quoting. */
  const gate = src.match(/if \(lowMotion && sustained && cross >= CFG\.OSC_FLAG_CROSSINGS\)/);
  ok('the flag gate is still lowMotion && sustained && crossings — no cycle-length term', !!gate);
  console.log(fail ? `\n✕ selftest: ${fail} failing` : '\n✓ selftest: all passing');
  process.exit(fail ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
const dir = args[0];
if (!dir) {
  console.error('usage: node tools/pb-operating-point.mjs <dir>  |  --selftest');
  process.exit(2);
}

const files = readdirSync(dir)
  .filter((f) => /^O2Ring.*\.csv$/i.test(f))
  .sort();
if (!files.length) {
  console.error('no O2Ring *.csv in ' + dir);
  process.exit(2);
}
const ctx = realm();
const rows = [];

console.log('night                     mean  %in[94,96]  %<95  PB episodes');
for (const f of files) {
  ctx.__csv = readFileSync(join(dir, f), 'utf8');
  ctx.__name = f;
  const o = JSON.parse(
    vm.runInContext(
      `(function(){ const B=window.OxyDex._bare;
         const rows=B.parseCSV(__csv,{name:__name});
         const nt=B.processNight(rows,__name);
         const v=rows.map(r=>r.spo2).filter(x=>x>=40&&x<=100);
         const mean=v.reduce((a,b)=>a+b,0)/v.length;
         return JSON.stringify({ mean:+mean.toFixed(1),
           near:+(100*v.filter(x=>x>=94&&x<=96).length/v.length).toFixed(0),
           below:+(100*v.filter(x=>x<95).length/v.length).toFixed(0),
           eps:(nt.oscEpisodes||[]).length }); })()`,
      ctx
    )
  );
  rows.push(o);
  console.log(`${f.slice(0, 26).padEnd(26)} ${String(o.mean).padStart(5)} ${String(o.near + '%').padStart(9)} ${String(o.below + '%').padStart(6)} ${String(o.eps).padStart(8)}`);
}

const flagged = rows.filter((r) => r.eps > 0).length;
const rBelow = pearson(
  rows.map((r) => r.below),
  rows.map((r) => r.eps)
);
const rMean = pearson(
  rows.map((r) => r.mean),
  rows.map((r) => r.eps)
);
const near = rows.map((r) => r.near).sort((a, b) => a - b);

console.log(`\nflagged on ${flagged}/${rows.length} nights (${((100 * flagged) / rows.length).toFixed(0)} %)`);
console.log(`median time within ±1 % of the 95 % crossing level: ${near[Math.floor(near.length / 2)]} %`);
console.log(`PB episodes vs %time below 95 %:  r = ${rBelow == null ? 'n/a' : rBelow.toFixed(3)}`);
console.log(`PB episodes vs mean SpO₂:         r = ${rMean == null ? 'n/a' : rMean.toFixed(3)}`);
console.log(
  `\nRead these together: a detector that fires on nearly every night, whose episode count tracks\n` +
    `hypoxemia burden this closely, is measuring how long SpO₂ sat below an ABSOLUTE line — not whether\n` +
    `breathing was periodic. Raising OSC_FLAG_CROSSINGS only makes it a stricter hypoxemia threshold.`
);
