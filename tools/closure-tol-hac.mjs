#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * closure-tol-hac.mjs — derive the 3-source clock-closure tolerance from the
 * legs' own PRECISION instead of their MAGNITUDE.
 *
 * THE CONSTANT BEING REPLACED. `integrator-dsp.js:5477`:
 *
 *     Math.max(5, 0.25 * Math.max(|d1|, |d2|, |d3|))
 *
 * Its stated rationale is "a triple of weak fits is allowed a looser closure
 * than a triple of sharp ones" — correct in principle, but it uses leg
 * MAGNITUDE as the proxy for weakness, and magnitude is not precision. Measured
 * over the corpus, closure error is UNCORRELATED with leg magnitude
 * (r = -0.238), the median |closure| is 8.4 ppm against the 5 ppm floor, and the
 * distribution is bimodal — 12 nights at or under 17.8 ppm, a 17 ppm gap, then
 * two at 34.8 and 46.3. So roughly two nights have a genuinely wrong fit and
 * about eight currently-voided nights are threshold artifacts.
 *
 * WHY THE TWO OBVIOUS REPLACEMENTS WERE REJECTED (#1231, recorded so they are
 * not retried): naive OLS underestimates the observed closure noise ~10x,
 * because consecutive block offsets share the same wander and OLS assumes
 * INDEPENDENT residuals; and sigma_y at the longest tau overestimates ~25x,
 * because ADEV answers "how stable is this clock over tau" and not "how
 * precisely is a slope over T determined".
 *
 * WHAT THIS USES INSTEAD. Newey-West HAC — the standard estimator for exactly
 * "OLS slope uncertainty when residuals are autocorrelated". The documented
 * failure mode of plain OLS matches the measurement: OLS and HAC agree at zero
 * autocorrelation and OLS coverage collapses as autocorrelation rises. The input
 * is `fitClockDrift`'s `blocks_` — the per-block {tMs, off} PHASE series the fit
 * was made from, exposed in #1231 for this purpose.
 *
 * The closure of a triple is d1+d2+d3, so under independence of the three legs
 * its standard error is sqrt(SE1^2 + SE2^2 + SE3^2) and the tolerance becomes
 * k * that — a precision-derived bound with a stated confidence, not a fraction
 * of a magnitude.
 *
 * ⚠️ BANDWIDTH IS THE JUDGEMENT CALL, so it is swept rather than chosen here.
 * The Bartlett lag truncation L trades bias against variance, and every source
 * says sensitivity analysis matters in small samples — a night has ~80 blocks,
 * which is a small sample.
 *
 * USAGE
 *   node tools/closure-tol-hac.mjs [--trio uploads/trio] [--limit 40]
 * ════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TRIO = path.resolve(ROOT, arg('--trio', 'uploads/trio'));
const LIMIT = Number(arg('--limit', '99'));

/* ── co-load the real integrator in a realm (the geometry-scan.mjs pattern) ── */
async function loadIntegrator() {
  const mod = await import(path.join(ROOT, 'tools/build-core.js')).catch(() => null);
  const classicify = mod?.classicify || mod?.default?.classicify || ((s) => s);
  const ctx = vm.createContext({
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
    Float64Array,
    Float32Array,
    Uint8Array,
    Set,
    Map,
    Infinity,
    NaN
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'dex-export.js', 'integrator-tch.js', 'integrator-dsp.js']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    try {
      vm.runInContext(classicify(fs.readFileSync(p, 'utf8')), ctx, { filename: f });
    } catch (e) {
      console.error(`  ! ${f}: ${e.message}`);
    }
  }
  const I = ctx.IntegratorDSP || ctx.Integrator || ctx.INTEGRATOR;
  if (!I || typeof I.fitClockDrift !== 'function') throw new Error('fitClockDrift not reachable');
  return I;
}

/* ── beat times (absolute floating ms) from a node export's RR series ─────── */
function beatTimes(exp, key) {
  const t0 = exp?.recording?.startEpochMs;
  const ser = exp?.timeseries?.[key];
  if (!Number.isFinite(t0) || !ser || !Array.isArray(ser.tSec)) return null;
  const out = [];
  /* Same filter `trio-batch`'s `rd` applies: a Malik-CORRECTED beat is an
     interpolation, not an observation, and feeding one to a clock fit measures
     the corrector. */
  for (let i = 0; i < ser.tSec.length; i++) {
    if (ser.corrected && ser.corrected[i] !== 0) continue;
    const t = ser.tSec[i];
    if (Number.isFinite(t)) out.push(t0 + t * 1000);
  }
  return out.length >= 500 ? out : null;
}

/* ── Newey-West HAC standard error of an OLS slope ─────────────────────────
   Bartlett kernel, w_l = 1 - l/(L+1). At L = 0 this reduces to the
   heteroskedasticity-robust (White) SE, and with homoskedastic independent
   residuals to the textbook OLS SE — so the L sweep below contains the
   rejected naive estimator as its own first row, which is the point. */
function olsHac(x, y, L) {
  const n = x.length;
  if (n < 5) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const inter = my - slope * mx;
  const e = x.map((xi, i) => y[i] - (inter + slope * xi));
  const z = x.map((xi) => xi - mx);
  let S = 0;
  for (let i = 0; i < n; i++) S += z[i] * z[i] * e[i] * e[i];
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    let acc = 0;
    for (let i = l; i < n; i++) acc += z[i] * z[i - l] * e[i] * e[i - l];
    S += 2 * w * acc;
  }
  const varB = S / (sxx * sxx);
  return { slope, se: Math.sqrt(Math.max(0, varB)) };
}

/* The closure triple is the one `trio-batch` actually builds: H10 chest ECG,
   Verity armband PPG, and the O2Ring FINGER PPG through PpgDex — NOT OxyDex,
   whose export carries no beat series at all (only spo2/hr). */
const NODES = [
  ['ECGDex', 'rr'],
  ['PpgDex', 'ppi'],
  ['PpgDexFinger', 'ppi']
];
const LAGS = [0, 2, 4, 8];

const I = await loadIntegrator();
const nights = fs
  .readdirSync(TRIO)
  .filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
  .sort()
  .slice(0, LIMIT);

console.log('Closure tolerance — magnitude rule vs Newey-West HAC');
console.log(`  ${nights.length} nights · Bartlett lags swept ${LAGS.join(', ')}\n`);

const rows = [];
for (const night of nights) {
  const dir = path.join(TRIO, night);
  const beats = {};
  let ok = true;
  for (const [n, key] of NODES) {
    const f = fs.readdirSync(dir).find((x) => x.startsWith(`${n}_`) && x.endsWith('.json'));
    if (!f) {
      ok = false;
      break;
    }
    const bt = beatTimes(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), key);
    if (!bt) {
      ok = false;
      break;
    }
    beats[n] = bt;
  }
  if (!ok) continue;

  const legs = [
    ['ECGDex', 'PpgDex'],
    ['PpgDex', 'PpgDexFinger'],
    ['PpgDexFinger', 'ECGDex']
  ];
  const fits = legs.map(([a, b]) => I.fitClockDrift(beats[a], beats[b], {}));
  if (fits.some((f) => !f || f.driftPpm == null || !Array.isArray(f.blocks_) || f.blocks_.length < 8)) continue;

  const closure = fits.reduce((s, f) => s + f.driftPpm, 0);
  const maxleg = Math.max(...fits.map((f) => Math.abs(f.driftPpm)));
  const oldTol = Math.max(5, 0.25 * maxleg);

  const hac = {};
  for (const L of LAGS) {
    const ses = fits.map((f) => {
      const x = f.blocks_.map((b) => b.tMs);
      const y = f.blocks_.map((b) => b.off);
      const r = olsHac(x, y, L);
      return r ? r.se * 1e6 : null; // ms/ms -> ppm
    });
    hac[L] = ses.every((v) => Number.isFinite(v)) ? Math.sqrt(ses.reduce((s, v) => s + v * v, 0)) : null;
  }
  rows.push({ night, closure, maxleg, oldTol, hac, nBlocks: fits.map((f) => f.blocks_.length) });
  console.log(
    `  ${night}  closure=${closure.toFixed(1).padStart(7)} ppm  maxleg=${maxleg.toFixed(1).padStart(6)}` +
      `  oldTol=${oldTol.toFixed(1).padStart(6)}  hacSE(L=4)=${hac[4] == null ? '  n/a' : hac[4].toFixed(2).padStart(6)}`
  );
}

if (!rows.length) {
  console.log('\n⊘ no nights produced three confident legs with blocks_.');
  process.exit(0);
}

console.log(`\n  ${rows.length} nights with three fitted legs\n`);
console.log('  Bandwidth sensitivity — how many nights CLOSE, by rule:');
console.log('    rule                       closes   voids');
const oldClose = rows.filter((r) => Math.abs(r.closure) <= r.oldTol).length;
console.log(`    magnitude  max(5, .25*leg)  ${String(oldClose).padStart(6)}  ${String(rows.length - oldClose).padStart(6)}`);
for (const L of LAGS) {
  const usable = rows.filter((r) => r.hac[L] != null);
  const c = usable.filter((r) => Math.abs(r.closure) <= 1.96 * r.hac[L]).length;
  const medSE = usable.length ? [...usable.map((r) => r.hac[L])].sort((a, b) => a - b)[Math.floor(usable.length / 2)] : NaN;
  console.log(`    HAC 1.96*SE  L=${String(L).padEnd(2)}          ${String(c).padStart(6)}  ${String(usable.length - c).padStart(6)}   (median SE ${medSE.toFixed(2)} ppm)`);
}

/* Does closure track PRECISION better than it tracks MAGNITUDE? That is the whole
   claim, and it is a correlation the old rule implicitly asserts and the corpus
   already refuted for magnitude (r = -0.238). */
function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
const absClosure = rows.map((r) => Math.abs(r.closure));
console.log('\n  Does |closure| track the predictor each rule uses?');
console.log(
  `    vs leg MAGNITUDE (old rule) : r = ${pearson(
    absClosure,
    rows.map((r) => r.maxleg)
  ).toFixed(3)}`
);
for (const L of LAGS) {
  const u = rows.filter((r) => r.hac[L] != null);
  if (u.length > 3)
    console.log(
      `    vs HAC SE  L=${String(L).padEnd(2)} (new rule)  : r = ${pearson(
        u.map((r) => Math.abs(r.closure)),
        u.map((r) => r.hac[L])
      ).toFixed(3)}  (n=${u.length})`
    );
}
