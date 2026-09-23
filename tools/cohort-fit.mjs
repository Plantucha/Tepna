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
 * ── THE VERDICT (tepna.verdict/1, VERDICT-CONTRACT §1; `verdict.js` is the authority) ────────
 * ONE object per run, and its criterion is the finding that survives every definitional argument:
 * COVERAGE, not resemblance. KS "different" is EXPECTED (the header above says why) and is reported
 * in `result`, never in `status`. Pre-stated bands, in `BANDS`, before any run under this header:
 *   headline   unreachable_real_share — real records above the generator's max AHI — ≤ 0 %:
 *              a region the generator cannot emit is a hole exactly where a detector saturates
 *   tail       every real severity stratum has a defined post-stratification weight (a null weight
 *              is a stratum the generator never emits — the same hole, one level up)
 *   PASS       headline met and every stratum weighted · SHORTFALL headline met, a stratum unweighted ·
 *   FAIL       records above the ceiling (the reason names how many, the ceiling and the real max) ·
 *   UNDERPOWERED fewer than BANDS.minReal scored real records (the KS critical value scales with n
 *              and a share over a handful of records is a number, not a share) · NOT_RUN no scored
 *              real record at all. Population = real records: eligible = parsed, checked = carrying
 *              scoredAHI, excluded = the rest. scope: internal — the reference is SHHS1 under a DUA
 *              and P5 gates every number here from quotation.
 *
 * USAGE
 *   node tools/cohort-fit.mjs --selftest
 *   node tools/cohort-fit.mjs --real <scored.json> [--n 50000] [--json]
 *   node tools/cohort-fit.mjs --verdict-sample     # the object over a SYNTHETIC reference (no file,
 *                                                  # no corpus) — what verdict-adoption reads in CI
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/* ── the verdict ══════════════════════════════════════════════════════════════════════════════
   Pure: `fit` = { nParsed, nReal, nSyn, ks, weights, unreachable }, `meta` = { real, commit, at }.
   The selftest pins every status without a reference file. */
export const BANDS = Object.freeze({ minReal: 100, unreachablePct: 0 });
export function verdictObject(fit, meta) {
  meta = meta || {};
  const un = fit.unreachable || null;
  const w = fit.weights || {};
  const unweighted = SEVERITY_BANDS.filter((b) => w[b] && w[b].realShare > 0 && w[b].weight == null);
  const result =
    fit.nReal > 0
      ? {
          unreachablePct: un ? un.pctAbove : null,
          above: un ? un.above : null,
          synMaxAhi: un ? un.synMax : null,
          realMaxAhi: un ? un.realMax : null,
          ksD: fit.ks ? fit.ks.D : null,
          ksCrit: fit.ks ? fit.ks.crit : null,
          ksDifferent: fit.ks ? fit.ks.different : null,
          weights: w,
          nSyn: fit.nSyn
        }
      : null;
  let status;
  let reason = null;
  if (!fit.nReal) {
    status = 'NOT_RUN';
    reason = 'no real record carries scoredAHI (' + fit.nParsed + ' parsed) — nothing to compare against';
  } else if (fit.nReal < BANDS.minReal) {
    status = 'UNDERPOWERED';
    reason = fit.nReal + ' scored real record(s) < the pre-stated minimum of ' + BANDS.minReal;
  } else if (un.pctAbove > BANDS.unreachablePct) {
    status = 'FAIL';
    reason = un.above + ' real record(s) (' + un.pctAbove + ' %) lie above the generator ceiling of AHI ' + un.synMax + ' (real max ' + un.realMax + ') — unreachable, not under-sampled';
  } else if (unweighted.length) {
    status = 'SHORTFALL';
    reason = 'no real record above the ceiling, but the generator never emits stratum ' + unweighted.join(', ') + ' (weight null) — a hole one level up';
  } else status = 'PASS';
  const producedBy = { tool: 'tools/cohort-fit.mjs', commit: meta.commit == null ? null : meta.commit };
  if (meta.commit == null) producedBy.commitReason = meta.commitReason || 'not run inside a git checkout';
  return {
    schema: 'tepna.verdict/1',
    gate: 'cohort-fit',
    scope: 'internal',
    status,
    population: { checked: fit.nReal, eligible: fit.nParsed, excluded: fit.nParsed - fit.nReal },
    criterion: { name: 'unreachable_real_share', threshold: BANDS.unreachablePct, unit: '%', direction: 'lte' },
    result,
    evidence: ['tools/cohort-fit.mjs', 'cohort-gen.js', ...(meta.real ? [meta.real] : [])],
    reason,
    producedBy,
    at: (meta.at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z')
  };
}
/* The comparison itself, shared by main() and --verdict-sample: real = [{ scoredAHI }] already filtered. */
export function fitCohort(cg, N, real) {
  const syn = [];
  for (let i = 0; i < N; i++) syn.push(cg.sampleProfile(i));
  const sAhi = syn.map((p) => p.baseAHI);
  const rAhi = real.map((r) => r.scoredAHI);
  return {
    syn,
    sAhi,
    rAhi,
    ks: ksTest(sAhi, rAhi),
    weights: postStratWeights(
      syn.map((p) => p.osaSeverity),
      rAhi.map(ahiBand)
    ),
    unreachable: unreachableShare(sAhi, rAhi)
  };
}
/* --verdict-sample: a synthetic REFERENCE drawn from the generator itself (seeds disjoint from the
   synthetic side), so the object's shape is exercised with no file and no corpus. It asserts the
   SHAPE the tool emits, never a number about SHHS1. */
export function verdictSample(root) {
  const cg = loadCohortGen(root || ROOT);
  const real = Array.from({ length: 400 }, (_, i) => ({ scoredAHI: cg.sampleProfile(1000000 + i).baseAHI }));
  const f = fitCohort(cg, 2000, real);
  return verdictObject(
    { nParsed: 400, nReal: 400, nSyn: 2000, ks: f.ks, weights: f.weights, unreachable: f.unreachable },
    { commit: null, commitReason: '--verdict-sample: synthetic reference, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}
function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
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

  /* The importability of this module cannot be observed from INSIDE it — by the time this runs, the
     entry-point decision has already been made. A subprocess is the only instrument that can see it,
     which is why this assertion spawns rather than inspecting a flag. It reds on removing the IS_CLI
     guard, verified by putting the bare `process.exit(main(...))` back. */
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('" + import.meta.url + "').then(m=>{if(typeof m.loadCohortGen!=='function')process.exit(3)})"], {
      encoding: 'utf8',
      timeout: 30000
    });
    A(
      'importing this module does NOT run its CLI or exit the importer',
      r.status === 0,
      'exit ' +
        r.status +
        ' — ' +
        String(r.stdout || r.stderr)
          .trim()
          .slice(0, 80)
    );
  } catch (e) {
    A('importing this module does NOT run its CLI or exit the importer', false, e.message);
  }

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

  /* the verdict — every status, pinned against verdict.js, no reference file */
  {
    const V = createRequire(import.meta.url)('../verdict.js');
    const val = (v) => V.validate(v).ok || V.validate(v).errors.join(' | ');
    const w4 = (over) => ({
      none: { synShare: 0.25, realShare: 0.05, weight: 0.2 },
      mild: { synShare: 0.25, realShare: 0.15, weight: 0.6 },
      mod: { synShare: 0.25, realShare: 0.3, weight: 1.2 },
      severe: { synShare: 0.25, realShare: 0.5, weight: 2 },
      ...over
    });
    const fit = (over) => ({
      nParsed: 520,
      nReal: 500,
      nSyn: 2000,
      ks: { D: 0.3, crit: 0.06, different: true },
      weights: w4(),
      unreachable: { synMin: 0.5, synMax: 290, realMax: 286.9, above: 0, below: 0, pctAbove: 0 },
      ...over
    });
    const meta = { real: '/ref/scored.json', commit: 'ec4e2d93', at: '2026-09-22T00:00:00Z' };
    const p = verdictObject(fit(), meta);
    A('verdict: coverage met, every stratum weighted → PASS with reason null', p.status === 'PASS' && p.reason === null, JSON.stringify(p));
    A('verdict: …valid under verdict.js', val(p) === true, String(val(p)));
    A('verdict: KS "different" is in result, never in status', p.result.ksDifferent === true && p.status === 'PASS');
    A('verdict: population is real records, checked + excluded = eligible', p.population.checked === 500 && p.population.excluded === 20 && p.population.eligible === 520);
    A('verdict: scope internal (SHHS1 under a DUA; P5)', p.scope === 'internal');
    const f = verdictObject(fit({ unreachable: { synMin: 0.5, synMax: 80, realMax: 286.9, above: 406, below: 0, pctAbove: 7.9 } }), meta);
    A('verdict: records above the ceiling → FAIL naming count, ceiling and real max', f.status === 'FAIL' && /406/.test(f.reason) && /AHI 80/.test(f.reason) && /286.9/.test(f.reason), f.reason);
    A('verdict: …valid', val(f) === true, String(val(f)));
    const sf = verdictObject(fit({ weights: w4({ mod: { synShare: 0, realShare: 0.3, weight: null } }) }), meta);
    A('verdict: ceiling met but a real stratum unweighted → SHORTFALL naming it', sf.status === 'SHORTFALL' && /stratum mod/.test(sf.reason), sf.reason);
    A('verdict: …valid', val(sf) === true, String(val(sf)));
    const up = verdictObject(fit({ nParsed: 60, nReal: 40 }), meta);
    A('verdict: 40 real records → UNDERPOWERED naming both numbers', up.status === 'UNDERPOWERED' && /40/.test(up.reason) && /100/.test(up.reason), up.reason);
    A('verdict: …valid', val(up) === true, String(val(up)));
    const nr = verdictObject(fit({ nParsed: 12, nReal: 0, ks: null, unreachable: null }), meta);
    A('verdict: no scored record → NOT_RUN, result null', nr.status === 'NOT_RUN' && nr.result === null && /12 parsed/.test(nr.reason), nr.reason);
    A('verdict: …valid', val(nr) === true, String(val(nr)));
    const smp = verdictSample(ROOT);
    A(
      'verdict: --verdict-sample builds from the generator alone, claims no commit, validates',
      smp.producedBy.commit === null && /synthetic/.test(smp.producedBy.commitReason) && val(smp) === true,
      String(val(smp))
    );
    A('verdict: …a null status is impossible (the sample landed on a real enum value)', ['PASS', 'SHORTFALL', 'FAIL'].includes(smp.status), smp.status);
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
  const parsed = JSON.parse(readFileSync(realPath, 'utf8'));
  const records = parsed.records || parsed;
  const real = records.filter((r) => !r.err && r.scoredAHI != null);
  const AS_JSON = argv.includes('--json');
  const verdictFor = (f) =>
    verdictObject(
      { nParsed: records.length, nReal: real.length, nSyn: N, ks: f ? f.ks : null, weights: f ? f.weights : null, unreachable: f ? f.unreachable : null },
      { real: realPath, commit: headCommit() }
    );
  if (!real.length) {
    // NOT_RUN, said as an object too — an empty reference is not a comparison and never reads as one
    const v = verdictFor(null);
    console.error('✕ no records with scoredAHI in ' + realPath);
    console.log(AS_JSON ? JSON.stringify(v, null, 1) : 'VERDICT (tepna.verdict/1): ' + JSON.stringify(v));
    return 2;
  }
  const fit = fitCohort(cg, N, real);
  const { sAhi, rAhi, ks, unreachable: un } = fit;
  const w = fit.weights;
  const verdict = verdictFor(fit);
  if (AS_JSON) {
    // VERDICT-CONTRACT §1: the object IS the API; the report's detail rides under `detail`.
    console.log(
      JSON.stringify(
        {
          ...verdict,
          detail: { bands: BANDS, quantiles: { synthetic: [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => quantile(sAhi, q)), real: [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => quantile(rAhi, q)) } }
        },
        null,
        1
      )
    );
    return 0;
  }

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
  console.log('');
  console.log('VERDICT (tepna.verdict/1): ' + JSON.stringify({ status: verdict.status, population: verdict.population, reason: verdict.reason }));
  return 0;
}

/* ── entry point ══════════════════════════════════════════════════════════════════════════════
   These two lines used to run UNCONDITIONALLY, so `import`ing this module for `loadCohortGen` —
   the one reusable thing in it — printed the usage banner and called `process.exit`, killing the
   importer. Measured 2026-09-15: a 1.9-vs-2.0 comparison that imported `loadCohortGen` died with
   the tool's own usage text and no other sign, which reads as the CALLER being wrong. A library
   function is not importable if reaching it runs a CLI. */
const IS_CLI = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_CLI) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  else if (process.argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(ROOT), null, 1));
    process.exit(0);
  } else process.exit(main(process.argv.slice(2)));
}
