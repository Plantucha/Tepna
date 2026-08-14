#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * tch-minrho-corpus.mjs — HOW MUCH shared error does the data actually require?
 *
 * WHY. The bootstrap (`tch-bootstrap-ci.mjs`) found that 41.7 % of within-night
 * replicates produce a non-physical negative-variance split — the three-cornered
 * hat's own signal that its uncorrelated-error assumption is violated. That is a
 * RATE. It does not say how badly.
 *
 * There is a natural magnitude, and `integrator-tch.js` already computes it.
 * `correlated(Vab, Vac, Vbc)` scans rho upward from 0 and returns the SMALLEST
 * common correlation that makes the solve physical. That number is exactly "the
 * minimum shared error consistent with these measurements" — a lower bound on
 * how far independence is violated, in units anyone can argue with.
 *
 * ⚠️ NOTHING NEW IS IMPLEMENTED HERE, DELIBERATELY. The temptation was to build
 * Premoli & Tavella's (1993) positive-definite constrained solve, which allows
 * three DISTINCT covariances rather than one shared rho. That may still be
 * worth doing — but the shipped estimator already answers the first question,
 * and building a second solver before measuring with the first is how this repo
 * ended up with two Allan cores.
 *
 * ⚠️ WHAT THE SHIPPED SOLVER ASSUMES, STATED SO THE RESULT IS NOT OVER-READ.
 * `_solveMulti` uses ONE scalar rho for all three pairs (equicorrelation). Real
 * shared error is unlikely to be equal across pairs — the two optical sensors
 * plausibly share more with each other than either does with the chest ECG. So
 * `minRho` is the minimum EQUICORRELATION that works, which is neither an upper
 * nor a lower bound on any individual pair's correlation. It is a scalar summary
 * of a 3-dimensional quantity, and it is reported as one.
 *
 * ⚠️ AND THE NEGATIVE-VARIANCE PATH STAYS. minRho > 0 is derived FROM the
 * classic solve failing; a tool that replaced classic with correlated would
 * destroy the very signal it reports.
 *
 * USAGE
 *   node tools/tch-minrho-corpus.mjs [--trio uploads/trio] [--reps 400]
 * ════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
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
const REPS = Number(arg('--reps', '400'));
const BLOCK = 5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NODES = ['ECGDex', 'PpgDex', 'OxyDex'];

function alignedNight(dir) {
  const per = {};
  for (const n of NODES) {
    const f = fs.readdirSync(dir).find((x) => x.startsWith(`${n}_`) && x.endsWith('.json'));
    if (!f) return null;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const t0 = d?.recording?.startEpochMs;
    const ep = d?.timeseries?.epochs;
    if (!Number.isFinite(t0) || !Array.isArray(ep)) return null;
    per[n] = ep.filter((e) => Number.isFinite(e?.hr) && Number.isFinite(e?.tMin)).map((e) => ({ t: t0 + e.tMin * 60000, hr: e.hr }));
  }
  const ref = per[NODES[0]];
  const A = [];
  const B = [];
  const C = [];
  for (const e of ref) {
    const b = per[NODES[1]].find((x) => Math.abs(x.t - e.t) < 150000);
    const c = per[NODES[2]].find((x) => Math.abs(x.t - e.t) < 150000);
    if (!b || !c) continue;
    A.push(e.hr);
    B.push(b.hr);
    C.push(c.hr);
  }
  return A.length >= 24 ? { A, B, C } : null;
}

/* One triple -> { negative, minRho }. minRho is null when NO common rho up to
   the solver's own 0.95 ceiling yields a physical solution — a distinct and
   worse outcome than "needs a large rho", and reported separately. */
function probe(A, B, C) {
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

function movingBlock(n, L, rnd) {
  const idx = [];
  while (idx.length < n) {
    const s = Math.floor(rnd() * Math.max(1, n - L + 1));
    for (let k = 0; k < L && idx.length < n; k++) idx.push(s + k);
  }
  return idx;
}
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

const nights = fs
  .readdirSync(TRIO)
  .filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
  .sort();

console.log('Three-cornered hat — how much shared error does the data REQUIRE?');
console.log(`  minRho = smallest common correlation making the solve physical (0 = classic works)\n`);
console.log('  night        classic   minRho     bootstrap minRho  [2.5%, 97.5%]   unsolvable%');

const rows = [];
for (const night of nights) {
  const al = alignedNight(path.join(TRIO, night));
  if (!al) continue;
  const p = probe(al.A, al.B, al.C);
  if (!p) continue;

  const rnd = mulberry32(31337);
  const boots = [];
  let unsolvable = 0;
  for (let r = 0; r < REPS; r++) {
    const idx = movingBlock(al.A.length, BLOCK, rnd);
    const q = probe(
      idx.map((i) => al.A[i]),
      idx.map((i) => al.B[i]),
      idx.map((i) => al.C[i])
    );
    if (!q) continue;
    if (q.minRho == null) unsolvable++;
    else boots.push(q.minRho);
  }
  const uPct = (100 * unsolvable) / REPS;
  rows.push({ night, ...p, boots, uPct });
  const ci = boots.length ? `[${pct(boots, 0.025).toFixed(2)}, ${pct(boots, 0.975).toFixed(2)}]` : '—';
  console.log(
    `  ${night}  ${(p.negative ? 'NEG' : 'ok ').padEnd(8)} ${(p.minRho == null ? 'none' : p.minRho.toFixed(2)).padStart(6)}     ` +
      `${(boots.length ? pct(boots, 0.5).toFixed(2) : '—').padStart(6)}  ${ci.padEnd(16)} ${uPct.toFixed(0)}%`
  );
}

if (!rows.length) {
  console.log('\n⊘ no nights with three aligned series.');
  process.exit(0);
}

const negNights = rows.filter((r) => r.negative);
const solved = negNights.filter((r) => r.minRho != null);
const unsolved = negNights.filter((r) => r.minRho == null);
const allBoots = rows.flatMap((r) => r.boots);

console.log(`\n  ${rows.length} nights`);
console.log(`    classic solve is PHYSICAL on the full night : ${rows.length - negNights.length}`);
console.log(`    classic goes NEGATIVE                       : ${negNights.length}`);
console.log(`      …of those, a common rho rescues it        : ${solved.length}`);
console.log(`      …no rho <= 0.95 works at all              : ${unsolved.length}`);
if (solved.length) {
  const m = solved.map((r) => r.minRho);
  console.log(`    minRho on rescued nights: median ${pct(m, 0.5).toFixed(2)} · range ${Math.min(...m).toFixed(2)}–${Math.max(...m).toFixed(2)}`);
}
if (allBoots.length) {
  console.log(`\n  Pooled over ${allBoots.length} bootstrap replicates:`);
  console.log(`    minRho  median ${pct(allBoots, 0.5).toFixed(3)} · 95 % range [${pct(allBoots, 0.025).toFixed(3)}, ${pct(allBoots, 0.975).toFixed(3)}]`);
  const zero = allBoots.filter((v) => v === 0).length;
  console.log(`    replicates needing NO correlation (rho=0): ${((100 * zero) / allBoots.length).toFixed(1)} %`);
}
console.log('\n  ⚠️ minRho is the minimum EQUICORRELATION — one scalar standing in for three pair');
console.log('     covariances. It is not a bound on any individual pair (see header).');
