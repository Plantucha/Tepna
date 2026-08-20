#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * integrator-block-precision.mjs — JOINT-UNWRAP-ATTEMPT §4's one open item
 * ------------------------------------------------------------------------------------------------
 * The brief's remaining box:
 *
 *     "Get per-block residual scatter well below ~450 ms. Estimator problem: more beats per block
 *      trades against drift within the block. `concentration` is the metric."
 *
 * §2 established the blocker is not the unwrap algorithm but the PRECISION OF THE PER-BLOCK OFFSET
 * relative to one RR: concentration rose monotonically with block length across a 3x3 sweep, which is
 * what "more beats ⇒ better offset" predicts. The named obstacle to simply lengthening blocks is that
 * the true offset DRIFTS inside a longer block, smearing the very correspondence peak being centroided.
 *
 * THE TRADE IS BREAKABLE, AND THAT IS WHAT THIS MEASURES. Within-block drift is not noise — it is a
 * known linear ramp whose slope the coarse fit already reports. Remove it from the B timebase first and
 * a long block no longer smears, so beats-per-block and within-block drift stop being opposed. Three
 * arms are measured on the same nights, same corpus, same estimator:
 *
 *   raw        `fitClockDrift(A, B)` as shipped, swept over blockMs
 *   dedrift    coarse ppm fitted once, removed from B, then the identical sweep
 *   dedrift2   the same, iterated a second time (does the first pass leave anything?)
 *
 * WHAT IS REPORTED, and why it is not `concentration` alone. Concentration is a phase statistic on the
 * wrapped residuals and answers "is there a phase to regress"; the brief's target is stated in
 * MILLISECONDS against a ~595 ms half-tooth. So the primary endpoint here is the robust SCATTER of the
 * per-block offsets about their own regression line — the quantity the ~450 ms target names — with
 * concentration reported beside it because a fit can be tight and still wrap.
 *
 * Robust scatter is the IQR-based sigma (IQR/1.349), not the sd: one badly-locked block is exactly the
 * failure mode under study and must not be allowed to set the number that decides whether unwrapping is
 * viable. §3.5 of the brief was RETRACTED once for a slip-inflated residual; this reports both the
 * robust scatter and the raw sd so the gap between them is visible rather than chosen.
 *
 * NO DETECTOR CHANGE. Everything runs through the exported `fitClockDrift` / `_wrappedSlopeFit`; the
 * only new code is the de-drift transform and the sweep bookkeeping, exercised corpus-free by
 * `--selftest` against a synthesised pair with a planted offset and a planted ppm.
 *
 * USAGE
 *   node tools/integrator-block-precision.mjs --dir <trio-dir> [--max-nights 12]
 *   node tools/integrator-block-precision.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import { rayleighP } from './circular-stats.mjs';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { median, quantile } from './ppi-match.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const MAX_NIGHTS = +opt('--max-nights', 12);
const TARGET_MS = +opt('--target-ms', 450); // the brief's own bar
const BLOCKS = (opt('--blocks', '300,600,900,1200,1800') || '').split(',').map(Number);

/* The scatter primitives live in `block-scatter.mjs` and are re-exported here so every existing
   caller and this file's own selftest keep working against ONE implementation. They moved because
   `unwrap-night-covariates.mjs` needs the identical definition, and importing it FROM this file
   runs this file's top-level argv parsing and `process.exit()` in the importer — see the header of
   `block-scatter.mjs` for the measurement. */
export { robustSigma, sd, lineResiduals, dedrift } from './block-scatter.mjs';
import { dedrift, lineResiduals, robustSigma, sd } from './block-scatter.mjs';

/* ════════════════════════════════════════════ SELFTEST ═════════════════════════════════════════ */
function selftest() {
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? '  ok   ' : '  FAIL ') + m);
    if (!c) fail++;
  };
  ok(Math.abs(robustSigma([1, 2, 3, 4, 5, 6, 7, 8, 9]) - 4 / 1.349) < 1e-9, 'robustSigma is IQR/1.349');
  const withOutlier = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10000];
  ok(robustSigma(withOutlier) < sd(withOutlier) / 10, 'one wild block moves the sd by >10x and the robust sigma barely at all');

  const x = [],
    y = [];
  for (let i = 0; i < 20; i++) {
    x.push(i * 1000);
    y.push(500 + 0.03 * (i * 1000)); // exact line
  }
  const lr = lineResiduals(x, y);
  ok(Math.abs(lr.slope - 0.03) < 1e-9, 'lineResiduals recovers a planted slope');
  ok(Math.max(...lr.res.map(Math.abs)) < 1e-6, '…and an exact line leaves ~0 residual');

  const t0 = 1000000;
  const t = [t0, t0 + 3600000]; // one hour apart
  const d = dedrift(t, 100, t0); // 100 ppm over 3600 s = 360 ms
  ok(Math.abs(d[0] - t0) < 1e-9, 'dedrift is identity at the anchor');
  ok(Math.abs(t[1] - d[1] - 360) < 1e-6, `…and removes 360 ms over an hour at 100 ppm (got ${(t[1] - d[1]).toFixed(3)})`);
  ok(Math.abs(dedrift(t, 0, t0)[1] - t[1]) < 1e-9, 'zero ppm is a no-op');

  console.log(fail ? `\nselftest: ${fail} FAILURE(S)` : '\nselftest: all green');
  return fail;
}

if (SELFTEST) process.exit(selftest() ? 1 : 0);
if (!DIR) {
  console.error('need --dir <trio-dir>  (or --selftest)');
  process.exit(2);
}

/* ═══════════════════════════════════════════ CORPUS RUN ════════════════════════════════════════ */
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const I = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'integrator-dsp.js']).IntegratorDSP;
if (!I || typeof I.fitClockDrift !== 'function') {
  console.error('IntegratorDSP.fitClockDrift unavailable');
  process.exit(2);
}

const nights = readdirSync(DIR)
  .filter((d) => {
    try {
      return statSync(join(DIR, d)).isDirectory();
    } catch {
      return false;
    }
  })
  .sort()
  .slice(0, MAX_NIGHTS);

function beatsOf(dir, node, key) {
  try {
    const f = readdirSync(join(DIR, dir)).find((x) => x.startsWith(node) && x.endsWith('.json'));
    if (!f) return null;
    const j = JSON.parse(readFileSync(join(DIR, dir, f), 'utf8'));
    const t0 = j.recording && j.recording.startEpochMs;
    const ts = j.timeseries && j.timeseries[key] && j.timeseries[key].tSec;
    if (t0 == null || !ts || ts.length < 500) return null;
    return ts.map((s) => t0 + s * 1000);
  } catch {
    return null;
  }
}

/* One arm: run the shipped fit at each blockMs and report the robust scatter of the per-block offsets
   about their own line, plus the wrapped-phase concentration. */
function arm(A, Bt) {
  const out = {};
  for (const blockSec of BLOCKS) {
    let r = null;
    try {
      r = I.fitClockDrift(A, Bt, { blockMs: blockSec * 1000 });
    } catch {
      r = null;
    }
    /* `blocks` is a COUNT; the rows are `perBlock` (each { tMs, off, frac, iqr }). Reading `blocks`
       as the array yields undefined and every night silently scores n/a — checked, not assumed. */
    if (!r || !Array.isArray(r.perBlock) || r.perBlock.length < 5) {
      out[blockSec] = null;
      continue;
    }
    const x = r.perBlock.map((b) => b.tMs),
      y = r.perBlock.map((b) => b.off);
    const lr = lineResiduals(x, y);
    out[blockSec] = lr
      ? {
          n: r.perBlock.length,
          robust: robustSigma(lr.res.slice().sort((a, b) => a - b)),
          sd: sd(lr.res),
          ppm: r.driftPpm,
          conc: r.wrappedConcentration != null ? r.wrappedConcentration : null,
          /* THE NULL THE CONCENTRATION LACKED (INTERDISCIPLINARY-LITERATURE §13h.1): concentration IS
             the mean resultant length, and the Rayleigh test says whether THIS value over THIS many
             blocks is distinguishable from a uniform phase. §5 of the parent brief read 0.15–0.38 as
             noise and 0.79 as lock by eye; this is that judgement with the n attached. */
          rayleighP: r.wrappedConcentration != null ? rayleighP(r.perBlock.length, r.wrappedConcentration) : null
        }
      : null;
  }
  return out;
}

console.log('JOINT-UNWRAP-ATTEMPT §4 — per-block offset precision: can the block/drift trade be broken?');
console.log(`target: robust scatter well below ${TARGET_MS} ms (half-tooth ~595 ms)   blocks(s): ${BLOCKS.join(', ')}\n`);

const rows = [];
for (const n of nights) {
  const A = beatsOf(n, 'ECGDex', 'rr');
  const Bt = beatsOf(n, 'PpgDex', 'ppi');
  if (!A || !Bt) continue;
  const t0 = Bt[0];

  const raw = arm(A, Bt);
  // coarse ppm from the shipped default block length, then remove it and re-run
  const coarse = raw[300] && raw[300].ppm != null ? raw[300].ppm : null;
  const de1 = coarse != null ? arm(A, dedrift(Bt, coarse, t0)) : null;
  let de2 = null;
  if (de1 && de1[300] && de1[300].ppm != null) {
    de2 = arm(A, dedrift(dedrift(Bt, coarse, t0), de1[300].ppm, t0));
  }
  rows.push({ n, raw, de1, de2, coarse });

  const g = (o, b) => (o && o[b] ? o[b].robust : null);
  const f = (v) => (v == null ? '   n/a' : v.toFixed(0).padStart(6));
  console.log(`${n}  coarse ${coarse == null ? 'n/a' : coarse.toFixed(1).padStart(7)} ppm`);
  console.log(`     raw     ${BLOCKS.map((b) => f(g(raw, b))).join(' ')}   ms robust scatter`);
  if (de1) console.log(`     dedrift ${BLOCKS.map((b) => f(g(de1, b))).join(' ')}`);
  if (de2) console.log(`     dedrift2${BLOCKS.map((b) => f(g(de2, b))).join(' ')}`);
}

if (!rows.length) {
  console.log('\nno night scored.');
  process.exit(0);
}
console.log(`\n${rows.length} night(s)\n`);
const summarise = (armName) => {
  console.log(`  ${armName}`);
  for (const b of BLOCKS) {
    const v = rows.map((r) => (r[armName] && r[armName][b] ? r[armName][b].robust : null)).filter((x) => x != null);
    const c = rows.map((r) => (r[armName] && r[armName][b] ? r[armName][b].conc : null)).filter((x) => x != null);
    if (!v.length) {
      console.log(`    ${String(b).padStart(4)} s   n/a`);
      continue;
    }
    const under = v.filter((x) => x < TARGET_MS).length;
    const ps = rows.map((r) => (r[armName] && r[armName][b] ? r[armName][b].rayleighP : null)).filter((x) => x != null);
    const phaseReal = ps.filter((x) => x < 0.01).length;
    console.log(
      `    ${String(b).padStart(4)} s   robust ${median(v).toFixed(0).padStart(5)} ms (IQR ${quantile(v, 0.25).toFixed(0)}–${quantile(v, 0.75).toFixed(0)})   concentration ${c.length ? median(c).toFixed(2) : ' n/a'}` +
        (ps.length ? `   Rayleigh p<0.01 on ${phaseReal}/${ps.length}` : '') +
        `   ${under}/${v.length} night(s) under ${TARGET_MS} ms`
    );
  }
};
summarise('raw');
summarise('de1');
summarise('de2');
console.log('\n  de1 = coarse ppm removed once before blocking · de2 = removed twice');
console.log('  If dedrift does not beat raw at long blocks, within-block drift was NOT the limit and');
console.log('  the residual is genuine per-block estimation noise — which would close the box with a');
console.log('  negative rather than leave it open on an untried idea.');
