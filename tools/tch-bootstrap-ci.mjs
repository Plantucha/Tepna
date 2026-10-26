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
import { NIGHT_RE, populationVerdict, ruleLine, snapshotNights } from './corpus-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const TCH = require(path.join(ROOT, 'integrator-tch.js'));

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TRIO = path.resolve(ROOT, arg('--trio', 'uploads/trio'));
const TOOL = 'tools/tch-bootstrap-ci.mjs';
const REPS = Number(arg('--reps', '2000'));
const BLOCK = Number(arg('--block', '5'));

/* Declared below and called here, so the sample exits before the first corpus read at `popBefore`. */
if (argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample(), null, 2));
  process.exit(0);
}

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

/* ── --selftest ─────────────────────────────────────────────────────────────
   Corpus-free, seeded, and it exercises the four pure parts a wrong interval
   would come out of: the generator, the moving-block resampler, the percentile
   and the TCH split. The ordering case injects three KNOWN noise levels and
   asks the split to recover their order and their scale; the control feeds it
   three identical series, where a classic split has no physical answer. */
if (argv.includes('--selftest')) {
  let ran = 0;
  let failed = 0;
  const ok = (cond, name) => {
    ran += 1;
    if (!cond) failed += 1;
    console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  };

  const r1 = mulberry32(7);
  const r2 = mulberry32(7);
  const r3 = mulberry32(8);
  const draw = (r, n) => Array.from({ length: n }, () => r());
  const d1 = draw(r1, 8);
  const d2 = draw(r2, 8);
  const d3 = draw(r3, 8);
  ok(
    d1.every((v, i) => v === d2[i]),
    'one seed gives one sequence — an interval that moves between runs is not an interval'
  );
  ok(
    d1.some((v, i) => v !== d3[i]),
    'ANTI-VACUITY · a different seed gives a different sequence'
  );
  ok(
    d1.every((v) => v >= 0 && v < 1),
    'every draw lies in [0, 1)'
  );

  const rb = mulberry32(31);
  const n = 120;
  const idxL5 = movingBlock(n, 5, rb);
  ok(idxL5.length === n && idxL5.every((i) => i >= 0 && i < n), 'the resample has exactly n indices, all in range');
  const runs = (idx) => idx.reduce((acc, v, i) => acc + (i > 0 && v === idx[i - 1] + 1 ? 1 : 0), 0);
  const runs5 = runs(idxL5);
  const runs1 = runs(movingBlock(n, 1, mulberry32(31)));
  ok(runs5 >= n / 2, `L=5 preserves within-block dependence — ${runs5} consecutive pairs of ${n - 1}`);
  ok(runs1 < runs5, `CONTROL · L=1 destroys it — ${runs1} consecutive pairs against ${runs5}`);

  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  ok(pct(hundred, 0.025) < median(hundred) && median(hundred) < pct(hundred, 0.975), 'the percentile brackets the median');
  ok(Number.isNaN(pct([], 0.5)), '∅ · a percentile over no samples is NaN, never 0');

  /* Three series over one truth, with pre-stated noise 0.3 / 0.6 / 1.2 bpm. */
  const rn = mulberry32(20261025);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rn())) * Math.cos(2 * Math.PI * rn());
  const INJECTED = [0.3, 0.6, 1.2];
  const truth = Array.from({ length: 600 }, (_, i) => 60 + 8 * Math.sin(i / 23));
  const series = INJECTED.map((sd) => truth.map((v) => v + sd * gauss()));
  const rec = sigmasOf(series[0], series[1], series[2]);
  ok(rec != null, 'the split returns three sigmas over independent noise');
  ok(rec != null && rec.s[0] < rec.s[1] && rec.s[1] < rec.s[2], `the recovered order matches the injected order — ${rec ? rec.s.map((v) => v.toFixed(2)).join(' < ') : 'no estimate'}`);
  ok(
    rec != null && rec.s.every((v, k) => v > INJECTED[k] / 2 && v < INJECTED[k] * 2),
    `every recovered sigma sits within a factor of two of its injected level — ${rec ? rec.s.map((v) => v.toFixed(2)).join(' / ') : 'no estimate'}`
  );

  /* Known answer: three copies of one series carry no independent noise at all,
     so the classic split must return exactly zero for each node. Measured
     2026-10-25 — it does, and it does not raise the negative alarm either. */
  const same = sigmasOf(truth, truth, truth);
  ok(
    same != null && same.s.every((v) => v === 0) && same.negative === false,
    `CONTROL · three identical series recover zero noise, never a manufactured one — ${same ? same.s.join(' / ') : 'no estimate'}`
  );

  console.log(failed ? `✗ ${failed} failed of ${ran}` : `✓ all ${ran} selftests passed`);
  process.exit(failed ? 1 : 0);
}

/* ── load ─────────────────────────────────────────────────────────────────── */
/* ONE walk, and the walk is the population
   (RESIDUE 2026-10-21-forty-one-corpus-enumerators-report-no-population). */
const popBefore = snapshotNights(TRIO);
const nights = popBefore.nights;
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

/* The replicates above resample the nights this run loaded, so the population closes here rather
   than where it opened. */
const population = populationVerdict(popBefore, snapshotNights(TRIO), { tool: TOOL, evidence: [TOOL] });
console.log(`\n  population: ${population.status} — ${population.population.checked} night(s) covered of ${population.population.eligible}${population.reason ? ` · ${population.reason}` : ''}`);
const rl = ruleLine(population);
if (rl) console.log('  ' + rl);
/* §🧾 THE OBJECT IS THE API, THE PROSE IS THE EXPLANATION. The interval above reports the scope it
   was taken over, and until this line that scope existed only as a sentence: a reader could not
   validate the population under `verdict.js`, and the `producedBy` identity reached nobody. */
console.log('POPULATION ' + JSON.stringify(population));

/* THE CORPUS-FREE SAMPLE THE ADOPTION GATE RUNS. Two identical fabricated snapshots, so the object
   is complete, the movement criterion is met, and no corpus is touched — CI mounts none
   (`docs/VERDICT-CONTRACT.md`: an `emits.cmd` must be cheap and corpus-free). The rule below is the
   rule this tool really walks with, so the sample cannot claim a population shape the run does not
   use. */
function verdictSample() {
  const at = '2026-10-26T00:00:00Z';
  const nights = ['2026-08-03', '2026-08-04'];
  const snap = {
    ok: true,
    root: 'uploads/trio',
    reason: null,
    n: nights.length,
    nights,
    digest: null,
    maxCtimeMs: null,
    at,
    rule: String(NIGHT_RE),
    ruleIsDefault: true,
    rejectedNightShaped: [],
    admittedNonNight: []
  };
  return populationVerdict(snap, snap, { tool: TOOL, at, evidence: [TOOL] });
}
