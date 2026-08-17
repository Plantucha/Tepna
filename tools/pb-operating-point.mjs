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
 * ⚠️ THE DETECTOR THIS TOOL WAS WRITTEN AGAINST NO LONGER EXISTS — re-derived 2026-08-17.
 * Everything below describes the PREDECESSOR, and is kept because this tool's whole output is a
 * critique of it. `OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md` replaced it with a periodicity gate, and
 * the selftest's tripwire required the central claim be RE-DERIVED rather than re-quoted. It was,
 * on this corpus, paired over the same 42 nights, old code vs new:
 *
 *     nights flagged            38/42   ->  16/42
 *     r, episodes vs %<95%      0.910   ->  0.370
 *     r, episodes vs mean SpO2 -0.832   -> -0.380
 *
 * So the critique below is now HISTORICAL: the over-call it measured has been substantially removed,
 * and burden no longer explains most of the signal. Note 0.370 is not 0 — PB and hypoxemia genuinely
 * co-occur, and a detector uncorrelated with burden would be suspicious in the other direction.
 * Corroborated independently through the node-export path on 18 identical nights: nights with >= 1 PB
 * episode 14/18 -> 4/18, total episodes 119 -> 5.
 *
 * THE PREDECESSOR (what the numbers below were measured against). A 5-min window was flagged when,
 * per `detectOscillations`:
 *     lowMotion (motion fraction < 0.08)
 *     sustained (>= 40 samples below SPO2_OSC_THRESHOLD)
 *     cross >= OSC_FLAG_CROSSINGS          (crossings of the ABSOLUTE 95 % level)
 * There was NO cycle-length criterion in the gate — `cycleLen` was computed for `meta` only — and no
 * crescendo-decrescendo test. The three constants carried no citation; oxydex-dsp labelled them
 * "detector tuning" and "algorithmic" in their own comments.
 *
 * THE CURRENT GATE, for contrast: episodes are variable-length runs from `detectSpO2Periodicity`,
 * gated on baseline-relative crossings + cycle length in 40-130 s + >= PB_MIN_CYCLES consecutive
 * cycles on DISJOINT pairs + cycle-length regularity (CV < PB_MAX_CYCLE_CV), then filtered for motion
 * per episode. The fixed 5-min window is gone: four cycles at up to 130 s need 520 s and could never
 * have fitted in the window they were scored in.
 *
 * WHY THAT MATTERS. AASM scores Cheyne-Stokes on a cycle length of AT LEAST 40 s (typically 45-90 s),
 * >= 3 consecutive cycles, and a crescendo-decrescendo envelope, measured against the patient's OWN
 * baseline.
 *   ^ CORRECTED 2026-08-16. This header previously read "a 40-90 s cycle length". That is a misreading:
 *     AASM states "a cycle length of at least 40 seconds (typically 45 to 90 seconds)" — a one-sided
 *     FLOOR plus a typicality note, not a two-sided scoring window (Berry RB et al. 2012, J Clin Sleep
 *     Med 8(5):597-619, doi:10.5664/jcsm.2172). The distinction matters because cycle length tracks
 *     circulatory delay and LENGTHENS as cardiac function worsens — mean 86 +/- 23 s in the worst-LVEF
 *     group (Wedewardt J et al. 2010, Sleep Med 11(2):137-42, doi:10.1016/j.sleep.2009.09.004) — so a
 *     90 s ceiling discards about half of the most severely impaired patients. See
 *     OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md §2.1, which settles the window at 40-130 s.
 * An absolute 95 % crossing
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
  /* ── THE TRIPWIRE FIRED, 2026-08-17, and was honoured rather than flipped ──────────────────────
     This used to assert `if (lowMotion && sustained && cross >= CFG.OSC_FLAG_CROSSINGS)` and read
     "no cycle-length term". Its own comment set the obligation: *the moment it gains one, this tool's
     central claim ("it cannot distinguish periodicity") needs RE-DERIVING rather than re-quoting.*
     OXYDEX-PB-DETECTOR wired a periodicity gate, so the claim WAS re-derived on this corpus — the
     numbers are in the header. The assertion is re-pointed, not deleted, so the next unannounced
     change to the gate trips exactly as this one did. */
  const gate = src.match(/detectSpO2Periodicity\(spo2Series, CFG\)/);
  ok('the flag gate is now periodicity-gated (detectSpO2Periodicity drives the episodes)', !!gate);
  const motionGuard = src.match(/if \(motion \/ span >= 0\.08\) continue;/);
  ok('and low-motion rejection survived the rewrite, per-episode rather than per-window', !!motionGuard);
  /* The four criteria ARE the detector's spec (brief §2 + §2.3); each is a named constant so this
     selftest can see it. A missing one means the gate was quietly weakened. */
  for (const k of ['PB_CYCLE_MIN_SEC', 'PB_CYCLE_MAX_SEC', 'PB_MIN_CYCLES', 'PB_MAX_CYCLE_CV']) {
    ok(`${k} is present — the four gating criteria are all still named`, new RegExp(`${k}:\\s*[\\d.]+`).test(src));
  }
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
