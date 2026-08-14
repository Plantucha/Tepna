#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * motion-rho-vs-minrho.mjs — is the shipped correlation proxy in the right
 * range, on the right nights?
 *
 * THE PROBLEM IT ADDRESSES. `integrator-dsp.js` corrects the three-cornered hat
 * for common-mode error using `_tchRhoFromMotion` — a proxy built from
 * cross-node motion correlation. That proxy has NEVER had a valid yardstick.
 * CROSS-DOMAIN-METHODS-FOLLOWUPS §1 proved the one previously used (the "direct"
 * residual correlation) is the polarization identity — a deterministic
 * rearrangement of the same three pairwise variances TCH already consumes,
 * carrying zero additional information. A figure of r = 0.173 was quoted against
 * it; that figure means nothing.
 *
 * THE YARDSTICK THIS USES INSTEAD. §2.2 measures `minRho` — the smallest common
 * correlation that makes the classic solve physical, i.e. the correlation the
 * DATA REQUIRES. It comes from the same three variances, but it is used
 * differently: as a demand, against which an EXTERNAL estimate can be checked
 * for RANGE and for WHICH NIGHTS it fires on. That is a consistency test, not a
 * self-validation, and it is the first one available.
 *
 * ⚠️ WHAT A DISAGREEMENT WOULD AND WOULD NOT PROVE. minRho is the minimum
 * EQUICORRELATION (one scalar for three pair covariances), so the proxy landing
 * elsewhere is not automatically an error — the true per-pair structure may be
 * unequal. What IS checkable without that caveat:
 *   · does the proxy fire on the nights that need it, and stay quiet otherwise?
 *   · is it saturating against its own [0, 0.9] clamp on nights needing 0.87?
 *   · is it in the right ORDER of magnitude at all?
 * Those are the questions asked here. A rank correlation is reported but is
 * deliberately NOT the headline, for the reason above.
 *
 * ⚠️ THE REAL FUNCTION IS CALLED, NOT REIMPLEMENTED. `_tchRhoFromMotion` is
 * module-local, so the module is loaded as a classic script in a vm realm where
 * its top-level declarations are context properties. Reimplementing the
 * aggregation (Σr²/Σr, negative-clamped, capped at 0.9) would measure a copy.
 *
 * USAGE
 *   node tools/motion-rho-vs-minrho.mjs [--trio uploads/trio]
 * ════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const TCH = require(path.join(ROOT, 'integrator-tch.js'));

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TRIO = path.resolve(ROOT, arg('--trio', 'uploads/trio'));

/* ── the real integrator, as a classic script, so module-local fns are reachable ── */
const mod = require(path.join(ROOT, 'tools/build-core.js'));
const classicify = mod.classicify || mod.default?.classicify || ((s) => s);
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
  if (fs.existsSync(p)) vm.runInContext(classicify(fs.readFileSync(p, 'utf8')), ctx, { filename: f });
}
if (typeof ctx._tchRhoFromMotion !== 'function' || typeof ctx._epKey !== 'function') {
  console.error('the shipped proxy is not reachable — refusing to substitute a copy');
  process.exit(2);
}

const NODES = ['ECGDex', 'PpgDex', 'OxyDex'];

/* Per node: aligned HR (for minRho) and the {tMin, motion} epochs the proxy reads. */
function loadNight(dir) {
  const per = {};
  for (const n of NODES) {
    const f = fs.readdirSync(dir).find((x) => x.startsWith(`${n}_`) && x.endsWith('.json'));
    if (!f) return null;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const t0 = d?.recording?.startEpochMs;
    const ep = d?.timeseries?.epochs;
    if (!Number.isFinite(t0) || !Array.isArray(ep)) return null;
    per[n] = { t0, ep };
  }
  // align on absolute floating wall-clock ms (Clock Contract §1)
  const ref = per[NODES[0]];
  const rows = [];
  for (const e of ref.ep) {
    if (!Number.isFinite(e?.hr) || !Number.isFinite(e?.tMin)) continue;
    const t = ref.t0 + e.tMin * 60000;
    const pick = NODES.slice(1).map((n) => {
      const s = per[n];
      return s.ep.find((x) => Number.isFinite(x?.hr) && Number.isFinite(x?.tMin) && Math.abs(s.t0 + x.tMin * 60000 - t) < 150000);
    });
    if (pick.some((p) => !p)) continue;
    rows.push({ tMin: e.tMin, hr: [e.hr, pick[0].hr, pick[1].hr], motion: [e.motionIndex, pick[0].motionIndex, pick[1].motionIndex] });
  }
  if (rows.length < 24) return null;

  const keys = rows.map((r) => ctx._epKey({ tMin: r.tMin }));
  const triplet = NODES.map((n, k) => ({
    node: n,
    series: { hrvEpochs: rows.map((r) => ({ tMin: r.tMin, motion: Number.isFinite(r.motion[k]) ? r.motion[k] : null })) }
  }));
  return { rows, keys, triplet };
}

function minRhoOf(rows) {
  const A = rows.map((r) => r.hr[0]);
  const B = rows.map((r) => r.hr[1]);
  const C = rows.map((r) => r.hr[2]);
  const pAB = TCH.pairDiffVar(A, B);
  const pAC = TCH.pairDiffVar(A, C);
  const pBC = TCH.pairDiffVar(B, C);
  if (!pAB || !pAC || !pBC) return null;
  const cl = TCH.classic(pAB.v, pAC.v, pBC.v);
  const negative = !(cl && cl.a > -1e-9 && cl.b > -1e-9 && cl.c > -1e-9);
  if (!negative) return { negative: false, minRho: 0 };
  const co = TCH.correlated(pAB.v, pAC.v, pBC.v, {});
  return { negative: true, minRho: co ? co.rho : null };
}

const nights = fs
  .readdirSync(TRIO)
  .filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
  .sort();

console.log('Shipped motion-ρ proxy vs the correlation the data REQUIRES');
console.log('  proxy = _tchRhoFromMotion (the real function, called in a realm)');
console.log('  minRho = smallest common ρ making the classic solve physical\n');
console.log('  night        needs ρ?   minRho   proxy ρ   weightedPairR   verdict');

const rows = [];
for (const night of nights) {
  const L = loadNight(path.join(TRIO, night));
  if (!L) continue;
  const mr = minRhoOf(L.rows);
  if (!mr) continue;
  const pr = ctx._tchRhoFromMotion(L.triplet, L.keys);
  const proxy = pr ? pr.value : null;
  /* DOES THE PROXY ACTUALLY REACH THE ESTIMATE? `threeCorneredHat` can reject an
     external rho, so a proxy that is wrong may still be harmless. This asks the
     shipped hat directly rather than inferring it from a comment. */
  const A = L.rows.map((r) => r.hr[0]);
  const B = L.rows.map((r) => r.hr[1]);
  const C = L.rows.map((r) => r.hr[2]);
  const base = TCH.threeCorneredHat(A, B, C, { labels: NODES, minN: 12 });
  const withRho = proxy == null ? null : TCH.threeCorneredHat(A, B, C, { labels: NODES, minN: 12, rho: proxy });
  const accepted = !!(withRho && withRho.ok && !withRho.externalRhoRejected);
  let shift = null;
  if (accepted && base && base.ok && withRho.sigma) {
    shift = NODES.map((n) => Math.abs((withRho.sigma[n] ?? 0) - (base.sigma[n] ?? 0))).reduce((a, b) => Math.max(a, b), 0);
  }
  const needs = mr.negative;
  let verdict;
  if (proxy == null) verdict = needs ? 'MISS — needed, no proxy' : 'quiet (no proxy)';
  else if (needs && mr.minRho != null) verdict = proxy + 1e-9 >= mr.minRho ? 'covers' : `SHORT by ${(mr.minRho - proxy).toFixed(2)}`;
  else if (!needs) verdict = proxy > 0.05 ? `fires unnecessarily (${proxy.toFixed(2)})` : 'quiet — correct';
  else verdict = 'unsolvable';
  rows.push({ night, needs, minRho: mr.minRho, proxy, w: pr ? pr.weightedPairR : null, verdict, accepted, shift });
  console.log(
    `  ${night}  ${(needs ? 'YES' : 'no ').padEnd(9)} ${(mr.minRho == null ? 'none' : mr.minRho.toFixed(2)).padStart(6)}   ` +
      `${(proxy == null ? '—' : proxy.toFixed(3)).padStart(7)}   ${(pr ? pr.weightedPairR.toFixed(3) : '—').padStart(13)}   ${verdict}`
  );
}

if (!rows.length) {
  console.log('\n⊘ no nights loaded.');
  process.exit(0);
}

const need = rows.filter((r) => r.needs && r.minRho != null);
const quiet = rows.filter((r) => !r.needs);
const covered = need.filter((r) => r.proxy != null && r.proxy + 1e-9 >= r.minRho);
const short = need.filter((r) => r.proxy != null && r.proxy < r.minRho);
const missing = need.filter((r) => r.proxy == null);
const falseFire = quiet.filter((r) => r.proxy != null && r.proxy > 0.05);
const saturated = rows.filter((r) => r.proxy != null && r.proxy >= 0.8995);

console.log(`\n  ${rows.length} nights · ${need.length} require ρ > 0 · ${quiet.length} do not\n`);
console.log('  On the nights that NEED a correction:');
console.log(`    proxy covers minRho          : ${covered.length}/${need.length}`);
console.log(`    proxy falls SHORT            : ${short.length}/${need.length}`);
console.log(`    proxy absent entirely        : ${missing.length}/${need.length}`);
if (short.length) {
  const g = short.map((r) => r.minRho - r.proxy);
  console.log(`      shortfall: median ${g.sort((a, b) => a - b)[Math.floor(g.length / 2)].toFixed(2)} · worst ${Math.max(...g).toFixed(2)}`);
}
console.log('\n  On the nights that do NOT:');
console.log(`    proxy quiet (<=0.05)         : ${quiet.length - falseFire.length}/${quiet.length}`);
console.log(`    proxy fires anyway           : ${falseFire.length}/${quiet.length}`);
console.log(`\n  saturating the [0, 0.9] clamp : ${saturated.length}/${rows.length}`);

const acc = rows.filter((r) => r.accepted);
const shifts = acc.map((r) => r.shift).filter((v) => Number.isFinite(v));
console.log('\n  DOES IT REACH THE ESTIMATE?');
console.log(`    external ρ ACCEPTED by the hat : ${acc.length}/${rows.length}`);
console.log(`    rejected                       : ${rows.length - acc.length}/${rows.length}`);
if (shifts.length) {
  shifts.sort((a, b) => a - b);
  console.log(`    largest σ shift when accepted  : median ${shifts[Math.floor(shifts.length / 2)].toFixed(3)} bpm · worst ${shifts[shifts.length - 1].toFixed(3)} bpm`);
}

/* Rank correlation, reported but NOT the headline — minRho is an equicorrelation
   summary of a 3-dimensional quantity, so disagreement is not proof of error. */
const withBoth = rows.filter((r) => r.proxy != null && r.minRho != null);
if (withBoth.length > 3) {
  const rank = (a) => {
    const s = [...a].map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const out = new Array(a.length);
    s.forEach(([, i], k) => {
      out[i] = k;
    });
    return out;
  };
  const x = rank(withBoth.map((r) => r.proxy));
  const y = rank(withBoth.map((r) => r.minRho));
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  console.log(`\n  Spearman(proxy, minRho) = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)}  (n=${n}) — secondary, see header`);
}
