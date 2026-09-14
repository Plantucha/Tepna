#!/usr/bin/env node
/*
 * tools/cohort-fit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DOES THE SYNTHETIC COHORT LOOK LIKE A REAL ONE? — and what would it take to project it onto one.
 *
 * `cohort-gen.js` samples synthetic patients; the SHHS1 corpus holds 5136 scored real ones. Nothing
 * had ever compared the two, so "the synthetic cohort is physiologically coherent" was an assertion
 * about a population nobody had put side by side with a measured one.
 *
 * ── THE ANSWER IS NO, AND THAT IS NOT A BUG ──────────────────────────────────────────────────
 * Measured 2026-09-13, 50 000 synthetic profiles against 5136 SHHS1 records:
 *
 *     AHI (events/h)      p5    p25    MED    p75    p95        KS D = 0.331
 *       synthetic        1.1    6.0   17.4   31.2   70.3        crit(0.05) = 0.020
 *       REAL             9.5   21.5   35.0   54.9   89.3        -> 16x over
 *
 *     severity          none    mild     mod  severe
 *       synthetic      22.8%   22.4%   29.2%   25.6%
 *       REAL            1.2%   11.9%   28.3%   58.6%
 *
 * `COHORT-VALIDATION-BRIEF.md` states the harness exists to EXPLORE THE STATE SPACE — "not the same
 * few patterns reseeded". A near-uniform severity draw is the CORRECT choice for that job: fit the
 * generator to SHHS1 and only 1.2 % of patients would be healthy, which would gut the none/mild path
 * the harness is there to exercise. So this tool does not report a defect. It reports that the
 * synthetic cohort is a COVERAGE sample, not an EPIDEMIOLOGICAL one, and that the two cannot be used
 * for each other's purpose without the correction below.
 *
 * ── WHAT IS ACTUALLY WRONG, AS OPPOSED TO MERELY DIFFERENT ───────────────────────────────────
 * Two findings survive the caveat below and are real coverage gaps:
 *
 * · AGE AND BMI ARE UNIFORM BY CONSTRUCTION — `20 + rng()*65`, `19 + rng()*29`. No cohort has a
 *   uniform age or BMI; both are unimodal and BMI is right-skewed. This holds under ANY scoring
 *   convention because no convention touches a covariate.
 * · THE SEVERE STRATUM CAPS AT AHI 80, and the real cohort does not. Real max is 286.9 and 406
 *   records (7.9 %) sit above 80 — a region the generator cannot emit at all, and the region where a
 *   detector is most likely to saturate. A harness whose purpose is coverage has a hole exactly where
 *   the hardest cases live.
 *
 * ⚠️ ── THE CAVEAT, AND IT IS THE SAME TRAP AS THE RETRACTED 37 % FIGURE ───────────────────────
 * SHHS scored hypopneas WITHOUT requiring a desaturation — 85.3 % of its respiratory events are
 * hypopneas — so the real `scoredAHI` is inflated relative to any stricter definition, and PART OF
 * THE GAP IS DEFINITIONAL RATHER THAN SAMPLING. The two findings above are immune to it (a covariate
 * has no scoring convention; a hard cap is a hard cap). The SIZE of the severity gap is not. Do not
 * quote the severity mix without naming the definition it was measured under — that error has
 * already been made once in this corpus and had to be retracted.
 *
 * ── THE USEFUL OUTPUT: POST-STRATIFICATION WEIGHTS ───────────────────────────────────────────
 * The two sampling schemes are reconcilable without changing either. Weight each synthetic patient
 * by `real_share(stratum) / synthetic_share(stratum)` and a coverage sample yields an unbiased
 * population estimate — uniform sampling for the state space, weights for the projection:
 *
 *     none x0.052   mild x0.531   mod x0.969   severe x2.290
 *
 * ⚠️ These project onto SHHS1 UNDER THIS DEFINITION, which is not "the general population": SHHS
 * oversampled snorers by design. A different target cohort is a different weight vector, so the
 * weights are COMPUTED here from whatever reference is supplied, never hardcoded into a caller.
 *
 * USAGE
 *   node tools/cohort-fit.mjs --selftest
 *   node tools/cohort-fit.mjs --real <scored.json> [--n 50000]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── the generator, loaded headlessly ─────────────────────────────────────────────────────────
   `cohort-gen.js` is a browser global script (`global.CohortGen = …`). A vm context gives it the
   `global` it expects without a DOM, so the REAL sampler is measured rather than a reimplementation
   of it — a reimplementation would be measuring this file's idea of the generator, which is exactly
   the kind of check that examines nothing. */
export function loadCohortGen(root) {
  const ctx = { console, Math, Date, JSON, Object, Array, Number, String, isNaN, parseFloat, parseInt };
  createContext(ctx);
  runInContext(readFileSync(join(root || ROOT, 'cohort-gen.js'), 'utf8'), ctx, { filename: 'cohort-gen.js' });
  if (!ctx.CohortGen || typeof ctx.CohortGen.sampleProfile !== 'function') throw new Error('cohort-gen.js loaded but exposed no sampleProfile — the surface moved');
  return ctx.CohortGen;
}

export const SEVERITY_BANDS = ['none', 'mild', 'mod', 'severe'];

/* The clinical AHI bands. Stated once so the synthetic side (which carries a label) and the real
   side (which carries only a number) are binned by the SAME rule — binning each by its own notion
   of "severe" would compare two different partitions and call the difference a finding. */
export function ahiBand(ahi) {
  if (ahi == null || !Number.isFinite(ahi)) return null;
  return ahi < 5 ? 'none' : ahi < 15 ? 'mild' : ahi < 30 ? 'mod' : 'severe';
}

export function quantile(values, f) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor(f * v.length))];
}

/* ── two-sample Kolmogorov–Smirnov ────────────────────────────────────────────────────────────
   D is the largest gap between the two empirical CDFs, so it answers "are these the same
   distribution" rather than "do they have the same median" — two distributions can share a median
   and differ everywhere else, and the severity mix here is exactly that case. Ties are advanced
   together; stepping one sample at a time past a shared value inflates D. */
export function ksTest(a, b) {
  const A = a.filter(Number.isFinite).sort((x, y) => x - y);
  const B = b.filter(Number.isFinite).sort((x, y) => x - y);
  if (!A.length || !B.length) return null;
  let i = 0,
    j = 0,
    d = 0;
  while (i < A.length && j < B.length) {
    const v = Math.min(A[i], B[j]);
    while (i < A.length && A[i] <= v) i++;
    while (j < B.length && B[j] <= v) j++;
    d = Math.max(d, Math.abs(i / A.length - j / B.length));
  }
  const crit = 1.36 * Math.sqrt((A.length + B.length) / (A.length * B.length));
  return { D: +d.toFixed(4), crit: +crit.toFixed(4), different: d > crit, nA: A.length, nB: B.length };
}

/* ── post-stratification ──────────────────────────────────────────────────────────────────────
   weight = real_share / synthetic_share, per stratum. A stratum the synthetic side never emits has
   NO weight — §∅: an undefined ratio is null, never 1 and never 0. Returning 1 would silently treat
   an unrepresented stratum as correctly represented; returning 0 would silently delete part of the
   reference population. Both are a fabricated answer to "how do I reweight something I do not have". */
export function postStratWeights(synBands, realBands) {
  const count = (arr) => {
    const m = {};
    for (const b of arr) if (b) m[b] = (m[b] || 0) + 1;
    return m;
  };
  const cs = count(synBands),
    cr = count(realBands);
  const ns = synBands.filter(Boolean).length,
    nr = realBands.filter(Boolean).length;
  const out = {};
  for (const b of SEVERITY_BANDS) {
    const ps = ns ? (cs[b] || 0) / ns : 0;
    const pr = nr ? (cr[b] || 0) / nr : 0;
    out[b] = { synShare: +ps.toFixed(5), realShare: +pr.toFixed(5), weight: ps > 0 ? +(pr / ps).toFixed(4) : null };
  }
  return out;
}

/* ── representable range ──────────────────────────────────────────────────────────────────────
   How much of the reference lies outside anything the generator can emit. This is the finding that
   survives every definitional argument: a value above the generator's ceiling is not under-sampled,
   it is unreachable. */
export function unreachableShare(synValues, realValues) {
  const hi = Math.max(...synValues.filter(Number.isFinite));
  const lo = Math.min(...synValues.filter(Number.isFinite));
  const real = realValues.filter(Number.isFinite);
  const above = real.filter((v) => v > hi).length;
  const below = real.filter((v) => v < lo).length;
  return { synMin: +lo.toFixed(2), synMax: +hi.toFixed(2), realMax: +Math.max(...real).toFixed(2), above, below, pctAbove: +((100 * above) / real.length).toFixed(2) };
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✕ ' + n + (d ? '  — ' + d : ''));
    }
  };
  console.log('▸ cohort-fit --selftest\n');

  A('bands: the clinical cuts', ahiBand(4.9) === 'none' && ahiBand(5) === 'mild' && ahiBand(14.9) === 'mild' && ahiBand(15) === 'mod' && ahiBand(29.9) === 'mod' && ahiBand(30) === 'severe');
  A('bands: §∅ — an absent AHI is null, not "none"', ahiBand(null) === null && ahiBand(NaN) === null);

  /* KS must SEPARATE known-different populations and NOT convict identical ones — a test that only
     ever says "different" would have produced tonight's headline with no information in it */
  const u1 = Array.from({ length: 2000 }, (_, i) => i / 2000);
  const u2 = Array.from({ length: 2000 }, (_, i) => i / 2000);
  const shifted = u1.map((x) => x + 0.5);
  A('ks: identical samples are not called different', ksTest(u1, u2).different === false, JSON.stringify(ksTest(u1, u2)));
  A('ks: a shifted sample IS called different', ksTest(u1, shifted).different === true);
  A('ks: D of a fully disjoint pair is 1', ksTest([1, 2, 3], [10, 11, 12]).D === 1);
  A('ks: ties do not inflate D', ksTest([1, 1, 1, 1], [1, 1, 1, 1]).D === 0);
  A('ks: an empty side refuses rather than scoring 0', ksTest([], [1, 2, 3]) === null);

  const syn = ['none', 'none', 'mild', 'severe'];
  const real = ['severe', 'severe', 'severe', 'mild'];
  const w = postStratWeights(syn, real);
  A('weights: an over-represented stratum weighs down', w.none.weight === 0, JSON.stringify(w.none));
  A('weights: an under-represented stratum weighs up', w.severe.weight === 3);
  A('weights: a stratum the synthetic side never emits is null, NOT 1 and NOT 0', w.mod.weight === null, JSON.stringify(w.mod));
  A('weights: shares are recorded beside the weight so a null is diagnosable', w.mod.realShare === 0 && w.mod.synShare === 0);

  const un = unreachableShare([1, 2, 80], [10, 50, 90, 100, 286.9]);
  A('unreachable: counts the reference above the generator ceiling', un.above === 3 && un.synMax === 80);
  A('unreachable: reports the reference max, so the size of the hole is visible', un.realMax === 286.9);

  /* the generator itself must load — a surface change here silently turns every number above into a
     measurement of nothing */
  let cg = null;
  try {
    cg = loadCohortGen(ROOT);
  } catch {
    /* reported by the assertion below */
  }
  A('generator: cohort-gen.js loads headlessly and exposes sampleProfile', !!cg);
  if (cg) {
    const p = cg.sampleProfile(1);
    A(
      'generator: a profile carries the fields this tool reads',
      p && p.age != null && p.bmi != null && p.baseAHI != null && !!p.osaSeverity,
      JSON.stringify(p && { a: p.age, b: p.bmi, s: p.osaSeverity })
    );
    /* two separately-taken draws, held in variables — comparing two textually identical call
       expressions is a self-compare a compiler may fold, so it can pass without the calls differing */
    const d1 = JSON.stringify(cg.sampleProfile(7));
    const d2 = JSON.stringify(cg.sampleProfile(7));
    const d3 = JSON.stringify(cg.sampleProfile(8));
    A('generator: sampleProfile is deterministic in its seed', d1 === d2);
    A('generator: …and a DIFFERENT seed gives a different profile (so the above is not vacuous)', d1 !== d3);
    /* the uniform-covariate finding, asserted against the real sampler rather than read off source:
       a uniform draw has its median at the midpoint of its range, a real cohort's does not */
    const n = 20000,
      ages = [],
      bmis = [];
    for (let i = 0; i < n; i++) {
      const q = cg.sampleProfile(i);
      ages.push(q.age);
      bmis.push(q.bmi);
    }
    A('generator: age is UNIFORM 20–85 (median at the midpoint, 52.5)', Math.abs(quantile(ages, 0.5) - 52.5) < 1.5, 'median ' + quantile(ages, 0.5).toFixed(1));
    A('generator: bmi is UNIFORM 19–48 (median at the midpoint, 33.5)', Math.abs(quantile(bmis, 0.5) - 33.5) < 1.0, 'median ' + quantile(bmis, 0.5).toFixed(1));
    /* ⚠️ THIS ASSERTION USED TO READ "the severe stratum caps at AHI 80", and it was RIGHT to fail
       when that changed. It documented a coverage gap — 13.5 % of real severe nights sat above a hard
       ceiling, unreachable rather than under-sampled — and `cohort-gen/2.0` closed it by drawing a
       shifted log-normal fitted to SHHS1 instead of a uniform. The assertion is replaced rather than
       deleted: a test weakened to let a change through stops being a test, so what it now pins is the
       property the change was FOR. */
    const sevAhi = Array.from({ length: 8000 }, (_, i) => cg.sampleProfile(i))
      .filter((p) => p.osaSeverity === 'severe')
      .map((p) => p.baseAHI);
    A('generator: the severe stratum now REACHES past the old 80 ceiling', Math.max(...sevAhi) > 80, 'max ' + Math.max(...sevAhi));
    A('generator: …but stays inside the refusal guard, so it cannot run away', Math.max(...sevAhi) <= 300);
    /* the shape, not just the range: a uniform draw puts its median at the midpoint of the band and
       has mean == median. A right-skewed one does neither, and that skew is the whole point. */
    const sevMed = quantile(sevAhi, 0.5);
    const sevMean = sevAhi.reduce((x, y) => x + y, 0) / sevAhi.length;
    A('generator: severe AHI is right-skewed (mean > median), not uniform', sevMean > sevMed, 'mean ' + sevMean.toFixed(1) + ' vs median ' + sevMed.toFixed(1));
    A('generator: its median tracks the real cohort (SHHS1 severe median 50.7)', Math.abs(sevMed - 50.7) < 6, 'median ' + sevMed.toFixed(1));
  }

  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

/* ── main ═════════════════════════════════════════════════════════════════════════════════════ */
function main(argv) {
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const realPath = arg('--real', null);
  const N = Number(arg('--n', '50000'));
  if (!realPath) {
    console.error('usage: node tools/cohort-fit.mjs --real <scored.json> [--n 50000]');
    console.error('  <scored.json> is a nsrr-score-pool / nsrr-oxydex-odi result carrying scoredAHI per record');
    return 2;
  }
  const cg = loadCohortGen(ROOT);
  const syn = [];
  for (let i = 0; i < N; i++) syn.push(cg.sampleProfile(i));
  const parsed = JSON.parse(readFileSync(realPath, 'utf8'));
  const real = (parsed.records || parsed).filter((r) => !r.err && r.scoredAHI != null);
  if (!real.length) {
    console.error('✕ no records with scoredAHI in ' + realPath);
    return 2;
  }

  const sAhi = syn.map((p) => p.baseAHI),
    rAhi = real.map((r) => r.scoredAHI);
  const ks = ksTest(sAhi, rAhi);
  const w = postStratWeights(
    syn.map((p) => p.osaSeverity),
    rAhi.map(ahiBand)
  );
  const un = unreachableShare(sAhi, rAhi);

  const row = (label, v) => '    ' + label.padEnd(12) + [0.05, 0.25, 0.5, 0.75, 0.95].map((f) => quantile(v, f).toFixed(1).padStart(7)).join('');
  console.log('▸ cohort-fit — synthetic (n=' + N + ') vs real (n=' + real.length + ')\n');
  console.log('  AHI (events/h)      p5    p25    MED    p75    p95');
  console.log(row('synthetic', sAhi));
  console.log(row('REAL', rAhi));
  console.log('    KS D=' + ks.D + '  crit(0.05)=' + ks.crit + '  → ' + (ks.different ? 'DIFFERENT distributions' : 'compatible'));
  console.log('');
  console.log('  SEVERITY MIX     synthetic      real     weight');
  for (const b of SEVERITY_BANDS)
    console.log(
      '    ' +
        b.padEnd(8) +
        (100 * w[b].synShare).toFixed(1).padStart(8) +
        '%' +
        (100 * w[b].realShare).toFixed(1).padStart(9) +
        '%' +
        (w[b].weight != null ? ('×' + w[b].weight).padStart(11) : '  (unrepresented)')
    );
  console.log('');
  console.log('  REPRESENTABLE RANGE');
  console.log('    generator emits AHI ' + un.synMin + ' … ' + un.synMax + ';  real max ' + un.realMax);
  console.log('    ' + un.above + ' real records (' + un.pctAbove + '%) lie ABOVE anything the generator can emit');
  console.log('');
  console.log('  ⚠️ Part of the AHI gap is DEFINITIONAL, not sampling: SHHS scored hypopneas without');
  console.log('     requiring a desaturation. The uniform covariates and the hard AHI ceiling are immune');
  console.log('     to that; the size of the severity gap is not. Quote it with its definition.');
  return 0;
}

if (process.argv.includes('--selftest')) process.exit(selftest());
else process.exit(main(process.argv.slice(2)));
