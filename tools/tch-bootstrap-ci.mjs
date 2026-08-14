#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * tch-bootstrap-ci.mjs — error bars for the three-cornered-hat sigmas.
 *
 * THE GAP. This suite quotes TCH sigmas as bare numbers — ECGDex 0.30,
 * PpgDex 0.33, OxyDex 1.10 bpm — in briefs, changesets and PR bodies, with no
 * statement of how far to trust them. CROSS-DOMAIN-METHODS-FOLLOWUPS §2 lists
 * this under "Confidence intervals, which we do not have at all", and the
 * metrology literature has had them since Ekstrom & Koppang (2002).
 *
 * That matters more than it sounds, because decisions have already been made on
 * differences between these numbers. "PpgDex 0.33 vs ECGDex 0.30" reads as a
 * near-tie; "0.33 [0.21, 0.55] vs 0.30 [0.19, 0.48]" says the same thing far
 * more honestly. And §4's own history in this brief — a 2-night result that did
 * not survive 14 nights — is what an interval would have shown up front.
 *
 * WHY BOOTSTRAP AND NOT KLTS. Lantz et al. (2019) give a Bayesian CDF that is
 * exact to one degree of freedom; it is also a substantially larger build. The
 * geoscience triple-collocation literature hit the same need and answered it
 * with a MOVING-BLOCK BOOTSTRAP designed to preserve temporal persistence in
 * unevenly-sampled series (Chen et al. 2018, Rem. Sens. Env.) — which is exactly
 * the epoch structure here. An i.i.d. bootstrap would be wrong for the usual
 * reason: consecutive epochs share posture, perfusion and wander, so resampling
 * single epochs destroys the dependence and returns intervals that are too
 * narrow. This is the same autocorrelation that made naive OLS underestimate the
 * closure noise 10x (§5).
 *
 * TWO LEVELS, ANSWERING TWO DIFFERENT QUESTIONS:
 *   within-night : moving-block resample of epochs -> how precise is THIS
 *                  night's sigma?
 *   across-night : resample NIGHTS with replacement -> how precise is the CORPUS
 *                  MEDIAN, which is the number actually quoted?
 *
 * ⚠️ THE NEGATIVE-VARIANCE PATH IS A DIAGNOSTIC AND IS COUNTED, NOT HIDDEN.
 * A classic TCH split going negative is the independence alarm (DA-V F6). This
 * reports how often it fires across bootstrap replicates, because an estimate
 * whose replicates are frequently non-physical is telling you the model is
 * wrong, and an interval computed only over the physical ones would conceal it.
 *
 * USAGE
 *   node tools/tch-bootstrap-ci.mjs [--trio uploads/trio] [--reps 2000] [--block 5]
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
const REPS = Number(arg('--reps', '2000'));
const BLOCK = Number(arg('--block', '5'));

/* Seeded. An interval that moves between runs is not an interval. */
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

/* Three index-aligned HR arrays for one night, matched on ABSOLUTE floating
   wall-clock ms (Clock Contract §1) — the nodes have different t0, so matching
   on tMin alone would silently shear them. */
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

/* Returns the three sigmas AND the module's own `negative` flag — the classic
   split going negative is the independence alarm (DA-V F6), and a replicate that
   fired it is counted rather than silently dropped. */
function sigmasOf(A, B, C) {
  const r = TCH.threeCorneredHat(A, B, C, { labels: NODES, minN: 12 });
  if (!r || !r.ok || !r.sigma) return null;
  const out = NODES.map((n) => (Number.isFinite(r.sigma[n]) ? r.sigma[n] : null));
  return out.every((v) => v != null) ? { s: out, negative: !!r.negative, method: r.method } : null;
}

/* Moving-block resample: draw ceil(n/L) blocks of L consecutive indices,
   preserving within-block dependence. */
function movingBlock(n, L, rnd) {
  const idx = [];
  while (idx.length < n) {
    const s = Math.floor(rnd() * Math.max(1, n - L + 1));
    for (let k = 0; k < L && idx.length < n; k++) idx.push(s + k);
  }
  return idx;
}

const pct = (arr, p) => {
  const s = [...arr].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const median = (a) => pct(a, 0.5);

/* ── load ─────────────────────────────────────────────────────────────────── */
const nights = fs
  .readdirSync(TRIO)
  .filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
  .sort();
const data = [];
for (const n of nights) {
  const al = alignedNight(path.join(TRIO, n));
  if (!al) continue;
  const s = sigmasOf(al.A, al.B, al.C);
  if (!s) continue;
  data.push({ night: n, ...al, sigmas: s.s, negative: s.negative, method: s.method });
}

console.log('Three-cornered hat — bootstrap confidence intervals');
console.log(`  ${data.length} nights · ${REPS} replicates · moving block L=${BLOCK} epochs\n`);
if (data.length < 4) {
  console.log('⊘ too few nights with three aligned series.');
  process.exit(0);
}

/* ── within-night intervals ───────────────────────────────────────────────── */
console.log('  Per-night sigma (bpm) with 95 % moving-block interval:');
console.log('    night        ECGDex               PpgDex               OxyDex          neg%');
let negTotal = 0;
let repTotal = 0;
for (const d of data.slice(0, 12)) {
  const rnd = mulberry32(4242);
  const reps = [[], [], []];
  let neg = 0;
  for (let r = 0; r < Math.min(REPS, 600); r++) {
    const idx = movingBlock(d.A.length, BLOCK, rnd);
    const s = sigmasOf(
      idx.map((i) => d.A[i]),
      idx.map((i) => d.B[i]),
      idx.map((i) => d.C[i])
    );
    if (!s) {
      neg++;
      continue;
    }
    if (s.negative) neg++;
    s.s.forEach((v, k) => reps[k].push(v));
  }
  repTotal += Math.min(REPS, 600);
  negTotal += neg;
  const cell = (k) => `${d.sigmas[k].toFixed(2)} [${pct(reps[k], 0.025).toFixed(2)},${pct(reps[k], 0.975).toFixed(2)}]`;
  console.log(`    ${d.night}  ${cell(0).padEnd(20)} ${cell(1).padEnd(20)} ${cell(2).padEnd(18)} ${((100 * neg) / Math.min(REPS, 600)).toFixed(0)}%`);
}
if (data.length > 12) console.log(`    … ${data.length - 12} more nights`);

/* ── the number actually quoted: the corpus MEDIAN ────────────────────────── */
console.log('\n  Corpus median sigma (bpm) — the figure quoted in briefs — with 95 % CI');
console.log('  by resampling NIGHTS with replacement:');
const rnd2 = mulberry32(99991);
const medReps = [[], [], []];
for (let r = 0; r < REPS; r++) {
  const pick = Array.from({ length: data.length }, () => data[Math.floor(rnd2() * data.length)]);
  for (let k = 0; k < 3; k++) medReps[k].push(median(pick.map((d) => d.sigmas[k])));
}
for (let k = 0; k < 3; k++) {
  const point = median(data.map((d) => d.sigmas[k]));
  console.log(`    ${NODES[k].padEnd(8)} ${point.toFixed(3)}   95 % CI [${pct(medReps[k], 0.025).toFixed(3)}, ${pct(medReps[k], 0.975).toFixed(3)}]`);
}

console.log(`\n  non-physical (negative-split) replicates: ${negTotal}/${repTotal} = ${((100 * negTotal) / Math.max(1, repTotal)).toFixed(1)} %`);
console.log('  (that path is the independence alarm — counted, never hidden)');

/* Do the intervals actually SEPARATE the three sensors, or is the ordering
   noise? This is the question every bare-number comparison has implicitly
   assumed the answer to. */
console.log('\n  Do the corpus medians separate?');
for (const [i, j] of [
  [0, 1],
  [0, 2],
  [1, 2]
]) {
  const diff = medReps[i].map((v, r) => v - medReps[j][r]);
  const lo = pct(diff, 0.025);
  const hi = pct(diff, 0.975);
  const sep = lo > 0 || hi < 0 ? 'SEPARATED' : 'overlapping — the ordering is not resolved';
  console.log(`    ${NODES[i]} − ${NODES[j]}: [${lo.toFixed(3)}, ${hi.toFixed(3)}]  ${sep}`);
}
