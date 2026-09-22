#!/usr/bin/env node
/*
 * tools/odi4-shhs-recut.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE SHHS1 TABLES OF `papers/odi4-ahi-bias.html` §3.2, RE-CUT FROM A COMMITTED RECORD — Table 3 (ODI-4
 * vs scored AHI and vs the expert desaturation index on the same nights), Table 4's real-stratum column
 * (mean bias by reference-AHI stratum), the SpO₂ coverage sentence, and the two saturation summaries
 * (T90 · mean SpO₂) the NSRR lane reported through the adapter — over ONE `nsrr-score-pool.mjs
 * --scorer ./nsrr-oxydex-odi.mjs` run of the full cohort.
 *
 * WHY THIS FILE EXISTS. Table 3 was published 2026-09-13 (#2475) from a pool run and hand arithmetic:
 * no script, no committed record, so when the input under it moved twice — the `OX stat` channel
 * (#2725, residue `2026-09-20-shhs-figures-predate-oxstat`) and `computeStats` rating T90 / mean SpO₂
 * over MEASURED seconds only (residue `2026-09-21-nsrr-t90-counted-dropouts-as-desaturation`) — nothing
 * could say by how much. Owner ruling 2026-09-21 (OWNER-DECISION-QUEUE D9.1): re-cut in ONE run, old
 * figures stay under a correction notice, every load-bearing number a sourced CLAIM.
 *
 * The statistics are the paper's own definitions, restated here so a reader can check them:
 *   OLS slope (R²)      ODI-4 regressed on the reference, ordinary least squares
 *   bias                mean(ODI-4 − reference)   ·   median difference   median(ODI-4 − reference)
 *   95 % LoA            bias ± 1.96 · SD(ODI-4 − reference)   (Bland–Altman)
 *   vs expert desat     over records whose expert 4 % desaturation index is NON-ZERO (the paper's 4932 of 5136)
 *   median ratio        median(ODI-4 / expert desaturation index) over those same pairs
 *   Table 4 real bias   MEAN(ODI-4 − scored AHI) per reference-AHI stratum (Table 2's statistic)
 *   coverage            median · p5 · min of per-record SpO₂ coverage %, and the count below 95 %
 *   T90 inflation       the OLD computeStats counted every null second as < 90 and averaged nulls as 0,
 *                       so per record  T90_old = T90_new·c + (1 − c)·100  and  mean_old = mean_new·c
 *                       with c = coverage/100 — the pre-fix value is DERIVABLE from the fixed one and the
 *                       coverage, exactly, so the shift is reported without re-running the old code
 * A number is quoted at the precision the paper published it (claims) beside full precision (result).
 * "moved" = |new − old| ≥ one unit of the published precision — pre-stated before the run
 * (scratchpad recut/MOVED.md, 2026-09-22, reproduced in the PR body).
 *
 *   node tools/odi4-shhs-recut.mjs --results <pool results.json> [--out analysis/published-numbers/<name>.json]
 *   node tools/odi4-shhs-recut.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const sorted = (a) => [...a].sort((x, y) => x - y);
const quant = (v, f) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : null);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
};
export function ols(xs, ys) {
  const n = xs.length;
  if (n < 3) return { n, slope: null, intercept: null, r2: null };
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
    syy += (ys[i] - my) * (ys[i] - my);
  }
  const slope = sxx ? sxy / sxx : null;
  return { n, slope, intercept: slope == null ? null : my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : null };
}
export function agreement(pairs) {
  const d = pairs.map((p) => p.a - p.b);
  const s = sorted(d);
  const b = mean(d);
  const dev = sd(d);
  return { n: d.length, bias: b, medianDiff: quant(s, 0.5), sd: dev, loa: b != null && dev != null ? [b - 1.96 * dev, b + 1.96 * dev] : null };
}
export const STRATA = [
  ['none', 0, 5],
  ['mild', 5, 15],
  ['moderate', 15, 30],
  ['severe', 30, Infinity]
];

/* The whole re-cut, pure over the pool's rows. */
export function recut(rows) {
  const ok = rows.filter((r) => r && !r.err);
  const vsAhi = ok.filter((r) => fin(r.odi4) && fin(r.scoredAHI));
  // the paper's right column is over records with a NON-ZERO expert 4 % desaturation index (5136 → 4932 on
  // 2026-09-13); a night the expert scored no 4 % desaturation on has no reference to agree with
  const vsDes = ok.filter((r) => fin(r.odi4) && fin(r.expertDesat4Idx) && r.expertDesat4Idx > 0);
  const A = agreement(vsAhi.map((r) => ({ a: r.odi4, b: r.scoredAHI })));
  const fitA = ols(
    vsAhi.map((r) => r.scoredAHI),
    vsAhi.map((r) => r.odi4)
  );
  const D = agreement(vsDes.map((r) => ({ a: r.odi4, b: r.expertDesat4Idx })));
  const fitD = ols(
    vsDes.map((r) => r.expertDesat4Idx),
    vsDes.map((r) => r.odi4)
  );
  const ratios = sorted(vsDes.filter((r) => r.expertDesat4Idx > 0).map((r) => r.odi4 / r.expertDesat4Idx));
  const strata = {};
  for (const [name, lo, hi] of STRATA) {
    const g = vsAhi.filter((r) => r.scoredAHI >= lo && r.scoredAHI < hi);
    strata[name] = { n: g.length, meanBias: mean(g.map((r) => r.odi4 - r.scoredAHI)), medianBias: quant(sorted(g.map((r) => r.odi4 - r.scoredAHI)), 0.5), meanAhi: mean(g.map((r) => r.scoredAHI)) };
  }
  const cov = sorted(ok.filter((r) => fin(r.coveragePct)).map((r) => r.coveragePct));
  const coverage = { n: cov.length, median: quant(cov, 0.5), p5: quant(cov, 0.05), min: cov.length ? cov[0] : null, below95: cov.filter((c) => c < 95).length };
  const sat = ok.filter((r) => fin(r.t90) && fin(r.meanSpo2) && fin(r.coveragePct));
  const t90New = sat.map((r) => r.t90);
  const t90Old = sat.map((r) => (r.t90 * r.coveragePct) / 100 + (1 - r.coveragePct / 100) * 100);
  const meanNew = sat.map((r) => r.meanSpo2);
  const meanOld = sat.map((r) => (r.meanSpo2 * r.coveragePct) / 100);
  const dist = (v) => {
    const s = sorted(v);
    return { n: s.length, median: quant(s, 0.5), p5: quant(s, 0.05), p95: quant(s, 0.95), mean: mean(s) };
  };
  const inflT90 = sorted(sat.map((r, i) => t90Old[i] - t90New[i]));
  const inflMean = sorted(sat.map((r, i) => meanOld[i] - meanNew[i]));
  return {
    records: { total: rows.length, ok: ok.length, vsScoredAhi: vsAhi.length, vsExpertDesat: vsDes.length },
    table3: {
      vsScoredAhi: { n: A.n, olsSlope: fitA.slope, r2: fitA.r2, bias: A.bias, medianDiff: A.medianDiff, loa: A.loa },
      vsExpertDesat: { n: D.n, bias: D.bias, medianDiff: D.medianDiff, loa: D.loa, medianRatio: quant(ratios, 0.5), ratioN: ratios.length, olsSlope: fitD.slope, r2: fitD.r2 }
    },
    table4Real: strata,
    coverage,
    saturation: {
      t90: { fixed: dist(t90New), preFixDerived: dist(t90Old), inflationPoints: dist(inflT90) },
      meanSpo2: { fixed: dist(meanNew), preFixDerived: dist(meanOld), shiftPoints: dist(inflMean) },
      note: 'preFixDerived = the value the OLD computeStats would have reported, derived exactly from the fixed value and the coverage (null seconds counted as < 90 and averaged as 0); inflation (T90) and shift (mean SpO₂, negative) = old − new per record'
    }
  };
}

/* Claims at the paper's published precision (Table 3: 2 dp for events/h, 3 dp for the slope and ratio, 2 dp
   for R²; Table 4: 1 dp; coverage 2 dp; counts integers), beside full precision under `result`. */
export function claimsOf(R) {
  const f = (v, d) => (v == null ? null : +v.toFixed(d));
  const t = R.table3;
  const out = {
    nRecords: R.records.ok,
    nVsScoredAhi: t.vsScoredAhi.n,
    nVsExpertDesat: t.vsExpertDesat.n,
    olsSlopeVsAhi: f(t.vsScoredAhi.olsSlope, 3),
    r2VsAhi: f(t.vsScoredAhi.r2, 2),
    biasVsAhi: f(t.vsScoredAhi.bias, 2),
    medianDiffVsAhi: f(t.vsScoredAhi.medianDiff, 2),
    loaLoVsAhi: f(t.vsScoredAhi.loa && t.vsScoredAhi.loa[0], 2),
    loaHiVsAhi: f(t.vsScoredAhi.loa && t.vsScoredAhi.loa[1], 2),
    biasVsDesat: f(t.vsExpertDesat.bias, 2),
    medianDiffVsDesat: f(t.vsExpertDesat.medianDiff, 2),
    loaLoVsDesat: f(t.vsExpertDesat.loa && t.vsExpertDesat.loa[0], 2),
    loaHiVsDesat: f(t.vsExpertDesat.loa && t.vsExpertDesat.loa[1], 2),
    medianRatioVsDesat: f(t.vsExpertDesat.medianRatio, 3),
    olsSlopeVsDesat: f(t.vsExpertDesat.olsSlope, 3),
    r2VsDesat: f(t.vsExpertDesat.r2, 3),
    coverageMedianPct: f(R.coverage.median, 2),
    coverageP5Pct: f(R.coverage.p5, 2),
    coverageMinPct: f(R.coverage.min, 2),
    coverageBelow95: R.coverage.below95,
    coverageBelow95Pct: R.coverage.n ? f((100 * R.coverage.below95) / R.coverage.n, 1) : null,
    t90MedianPct: f(R.saturation.t90.fixed.median, 2),
    t90InflationMedianPoints: f(R.saturation.t90.inflationPoints.median, 2),
    meanSpo2Median: f(R.saturation.meanSpo2.fixed.median, 2),
    meanSpo2ShiftMedianPoints: f(R.saturation.meanSpo2.shiftPoints.median, 2)
  };
  for (const [name] of STRATA) {
    out['real' + name[0].toUpperCase() + name.slice(1) + 'N'] = R.table4Real[name].n;
    out['real' + name[0].toUpperCase() + name.slice(1) + 'Bias'] = f(R.table4Real[name].meanBias, 1);
  }
  return out;
}

function sha12(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
}
function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (!c && d != null ? '  — ' + d : ''));
    if (!c) fail++;
  };
  // planted rows: ODI-4 = 0.5·AHI − 2 exactly (slope 0.5, R² 1), expert desat = ODI-4 + 1, coverage known
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const ahi = 2 + i * 2; // 2 … 80
    const odi4 = 0.5 * ahi - 2;
    rows.push({ id: 'r' + i, odi4, scoredAHI: ahi, expertDesat4Idx: odi4 + 1, coveragePct: i % 4 === 0 ? 90 : 99, t90: 10, meanSpo2: 95 });
  }
  rows.push({ id: 'err', err: 'unparsed' });
  const R = recut(rows);
  ok('records: the errored row is excluded from ok, counted in total', R.records.total === 41 && R.records.ok === 40);
  ok('Table 3 vs AHI: planted slope 0.5 recovered, R² 1', Math.abs(R.table3.vsScoredAhi.olsSlope - 0.5) < 1e-12 && Math.abs(R.table3.vsScoredAhi.r2 - 1) < 1e-12, JSON.stringify(R.table3.vsScoredAhi));
  ok(
    'Table 3 vs desat: over the 39 non-zero-reference rows, bias exactly −1 (odi4 = desat − 1), median diff −1',
    R.table3.vsExpertDesat.n === 39 && Math.abs(R.table3.vsExpertDesat.bias + 1) < 1e-12 && R.table3.vsExpertDesat.medianDiff === -1,
    JSON.stringify(R.table3.vsExpertDesat)
  );
  ok('LoA: bias ± 1.96·SD — zero-SD pairs collapse the interval onto the bias', R.table3.vsExpertDesat.loa[0] === -1 && R.table3.vsExpertDesat.loa[1] === -1);
  ok(
    'median ratio: over pairs with a non-zero reference (row 0 has desat 0 → 39 of 40)',
    R.table3.vsExpertDesat.ratioN === 39 && R.table3.vsExpertDesat.medianRatio < 1,
    JSON.stringify({ n: R.table3.vsExpertDesat.ratioN, r: R.table3.vsExpertDesat.medianRatio })
  );
  ok('Table 4: strata partition the vs-AHI population (n sums to 40)', Object.values(R.table4Real).reduce((a, s) => a + s.n, 0) === 40, JSON.stringify(Object.values(R.table4Real).map((s) => s.n)));
  ok('Table 4: mean bias in the none stratum is −3.5 (AHI 2 → ODI −1 → bias −3; AHI 4 → ODI 0 → bias −4)', Math.abs(R.table4Real.none.meanBias + 3.5) < 1e-12, String(R.table4Real.none.meanBias));
  ok('coverage: 10 of 40 below 95, min 90', R.coverage.below95 === 10 && R.coverage.min === 90 && R.coverage.median === 99);
  const t = R.saturation.t90;
  ok(
    'T90 pre-fix derivation: at 90 % coverage, T90 10 → 19 (10·0.9 + 10); at 99 %, 10 → 10.9',
    Math.abs(t.preFixDerived.p95 - 19) < 1e-9 && Math.abs(t.preFixDerived.median - 10.9) < 1e-9,
    JSON.stringify(t.preFixDerived)
  );
  ok('T90 inflation is never negative (dropouts only ever inflated it)', t.inflationPoints.p5 >= 0 && t.inflationPoints.median >= 0);
  const m = R.saturation.meanSpo2;
  ok('mean SpO₂ pre-fix derivation: 95 → 85.5 at 90 % coverage', Math.abs(m.preFixDerived.p5 - 85.5) < 1e-9, JSON.stringify(m.preFixDerived));
  const C = claimsOf(R);
  ok(
    'claims: published precision (slope 3 dp, bias 2 dp, Table 4 1 dp, counts integers)',
    C.olsSlopeVsAhi === 0.5 && C.biasVsDesat === -1 && C.realNoneBias === -3.5 && Number.isInteger(C.realSevereN),
    JSON.stringify(C)
  );
  ok(
    'claims: every value is a number or null, never NaN',
    Object.values(C).every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)))
  );
  const empty = recut([{ id: 'x', err: 'e' }]);
  ok('an empty run yields nulls, never zeros standing in for absence', empty.table3.vsScoredAhi.bias === null && empty.coverage.median === null && empty.records.ok === 0);
  console.log(fail ? fail + ' failed of 14' : 'all 14 selftests passed');
  return fail ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const resultsPath = arg('--results', null);
  if (!resultsPath) {
    console.error('usage: node tools/odi4-shhs-recut.mjs --results <pool results.json> [--out <record.json>] | --selftest');
    return 2;
  }
  const raw = readFileSync(resultsPath);
  const pool = JSON.parse(raw.toString('utf8'));
  const rows = pool.records || pool;
  const R = recut(rows);
  const record = {
    schema: 'tepna.published-number-record/1',
    producer: 'tools/odi4-shhs-recut.mjs',
    producerCommit: headCommit(),
    invocation: 'node tools/nsrr-score-pool.mjs --scorer ./nsrr-oxydex-odi.mjs --workers 8 --out <results.json> · node tools/odi4-shhs-recut.mjs --results <results.json>',
    generated: new Date().toISOString().slice(0, 10),
    inputs: {
      path: 'NSRR SHHS1 (EDF + annotations-events-nsrr XML; data-use agreement — NOT committed, never fetched by the suite)',
      committed: false,
      files: R.records.total,
      digest: sha12(raw),
      note: 'digest = sha256[0:12] over the pool results file bytes (the per-record rows this re-cut reads) — recorded-only, since the corpus itself is not in the tree; the pool run is reproducible from the same corpus + producerCommit'
    },
    publishedIn: 'papers/odi4-ahi-bias.html §3.2 (re-cut correction block, 2026-09-22) · docs/SHHS-COHORT-REFERENCE.md',
    claims: { note: 'values EXACTLY as the prose states them (published precision), so CLAIM … FROM … #claims/<key> compares equal; full precision is under result', ...claimsOf(R) },
    result: R
  };
  const out = arg('--out', null);
  if (out) {
    writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
    console.error('wrote ' + out);
  } else console.log(JSON.stringify(record, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
