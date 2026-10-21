#!/usr/bin/env node
/*
 * tools/nsrr-ahi-refit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Refits the shipped AHI surrogates against each of the four harmonized NSRR AHI definitions, and
 * scores every refit under the band the owner ratified on 2026-10-13
 * (`briefs/AHI-SURROGATE-REFIT-PAPER-2026-10-13-BRIEF.md` §4.4):
 *
 *   A refit supersedes the shipped coefficients for one definition only if, on records held out of
 *   its own fit, it improves rank correlation with that definition's scored index — Spearman rho,
 *   not absolute error — by a margin whose 95 % CI excludes 0 under a subject-clustered bootstrap.
 *
 * Rank, because the residue finding is that the bigger estimate wins on absolute error alone.
 * Subject-clustered, because the harmonized table repeats 2293 subjects and a bootstrap over rows
 * would understate the interval.
 *
 * THE SPLIT is the owner's ruling of 2026-10-12: subject-disjoint, SHHS1 subjects absent from SHHS2
 * fit, every SHHS2 subject holds out, no subject in both roles.
 *
 * WHAT THE VERDICT JUDGES, pre-stated here before any rho was computed: the multi-predictor
 * (Kulkas-form) refit against the shipped multi-predictor estimator. It is the only shipped form
 * whose coefficient vector has more than one free parameter, so it is the only one whose refit can
 * move a rank at all: `ahiODI4 = 1.1 * ODI4` is a positive monotone transform of ODI4, and any
 * refit `a0 + a1 * ODI4` with `a1 > 0` ranks the records identically. The ODI4 form's numbers
 * travel in `result.odi4Form` as a measured companion, never as the decision. Two further
 * companions ride beside it, also never the decision: `result.singlePredictorRho` (how each
 * predictor ranks the reference alone — ODI3 by itself outranks the shipped multi-predictor
 * estimator) and `result.shippedClamp` (what the shipped `max(0, ...)` costs in tied zeros).
 *
 * ABSENCE (§∅): a record whose reference column holds no value leaves THAT definition's fit and
 * stays in the others; a record with an absent predictor is excluded and counted, never zero-filled.
 * Four definitions therefore carry four separate population counts.
 *
 * The output file carries AGGREGATES ONLY — no record identifier reaches it, because this repository
 * is public and the NSRR DAUA §5 forbids any excerpt of the Data.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ── pre-stated constants ───────────────────────────────────────────────────────────────────────
// The four harmonized columns, each paired with the native variable it was measured to agree with
// to within 0.005 events/h on 100.00 % of 5804 SHHS1 subjects (2026-10-13, `nsrr-adapter.js`).
const AHI_DEFS = [
  { col: 'nsrr_ahi_hp3u', native: 'ahi_a0h3', rule: 'apneas + hypopneas with >= 3 % desaturation', arousals: false },
  { col: 'nsrr_ahi_hp3r_aasm15', native: 'ahi_a0h3a', rule: 'apneas + hypopneas with >= 3 % desaturation OR an arousal', arousals: true },
  { col: 'nsrr_ahi_hp4u_aasm15', native: 'ahi_a0h4', rule: 'apneas + hypopneas with >= 4 % desaturation', arousals: false },
  { col: 'nsrr_ahi_hp4r', native: 'ahi_a0h4a', rule: 'apneas + hypopneas with >= 4 % desaturation OR an arousal', arousals: true }
];

/* The hold-out floor, pre-stated in this unit BEFORE the first reference value was read, and not
   derived from the data it judges (§🧾: a threshold derived from its own data is UNKNOWN). 300
   subjects: at the rho these surrogates reach (0.6–0.8 in the 2026-09-22 full-corpus run), the
   standard error of a difference of dependent rhos is about 0.03–0.05 at n = 300, so a true gain of
   0.05 is detectable and "the CI excludes 0" is a measurement rather than luck. Under it, the band
   cannot be applied and the verdict is UNDERPOWERED. */
const MIN_HOLDOUT_SUBJECTS = Number(opt('min-holdout', '300'));
const BOOT_REPS = Number(opt('boot', '2000'));
const BOOT_SEED = opt('seed', 'ahi-refit-2026-10-13');
const BAND = 'spearman rho gain over the shipped estimator on held-out records, 95 % CI excludes 0 under a subject-clustered bootstrap';

const HARMONIZED = opt('harmonized', '/mnt/nas/nsrr/shhs/datasets/shhs-harmonized-dataset-0.21.0.csv');
const SCORED = opt('scored', '');
const OUT = opt('out', '');

// ── statistics ─────────────────────────────────────────────────────────────────────────────────
/** Average ranks, ties shared — the tie rule Spearman's rho is defined under. */
export function rankAvg(xs) {
  const ix = xs.map((v, i) => i).sort((a, b) => xs[a] - xs[b]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < ix.length) {
    let j = i;
    while (j + 1 < ix.length && xs[ix[j + 1]] === xs[ix[i]]) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[ix[k]] = shared;
    i = j + 1;
  }
  return r;
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  let mx = 0,
    my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx,
      dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null; // a constant vector has no correlation, it has no variance
  return sxy / Math.sqrt(sxx * syy);
}

export function spearman(xs, ys) {
  if (!xs || !ys || xs.length !== ys.length) return null;
  return pearson(rankAvg(xs), rankAvg(ys));
}

/** OLS by normal equations with partial pivoting. Returns coefficients, or null when singular. */
export function ols(X, y) {
  const n = X.length;
  if (!n || y.length !== n) return null;
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Float64Array(p + 1));
  for (let r = 0; r < n; r++) {
    const row = X[r];
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) A[i][j] += row[i] * row[j];
      A[i][p] += row[i] * y[r];
    }
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-10) return null;
    if (piv !== c) {
      const t = A[piv];
      A[piv] = A[c];
      A[c] = t;
    }
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let j = c; j <= p; j++) A[r][j] -= f * A[c][j];
    }
  }
  const out = [];
  for (let i = 0; i < p; i++) out.push(A[i][p] / A[i][i]);
  return out.every(Number.isFinite) ? out : null;
}

/** Deterministic RNG: the bootstrap is a measurement, so it reproduces from the seed alone. */
export function mulberry32(seedStr) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seedStr)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos),
    hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* The CLUSTER is the subject: a resample draws subjects with replacement and takes every row the
   drawn subject contributed, so a subject reached by two visits enters or leaves together. */
export function clusterBootstrapDeltaCI(clusters, reps, seedStr) {
  const rand = mulberry32(seedStr);
  const m = clusters.length;
  const deltas = [];
  for (let b = 0; b < reps; b++) {
    const ref = [],
      shipped = [],
      refit = [];
    for (let k = 0; k < m; k++) {
      const c = clusters[(rand() * m) | 0];
      for (let i = 0; i < c.ref.length; i++) {
        ref.push(c.ref[i]);
        shipped.push(c.shipped[i]);
        refit.push(c.refit[i]);
      }
    }
    const a = spearman(refit, ref),
      s = spearman(shipped, ref);
    if (a != null && s != null) deltas.push(a - s);
  }
  deltas.sort((x, y) => x - y);
  return {
    reps: deltas.length,
    lo: percentile(deltas, 0.025),
    hi: percentile(deltas, 0.975),
    median: percentile(deltas, 0.5)
  };
}

// ── the shipped estimators (oxydex-dsp.js computeAHIestimates — NOT changed by this unit) ───────
export const SHIPPED_KULKAS = [-1.2, 0.8, 0.6, 0.15]; // intercept, ODI3, DesSev, T95
export const SHIPPED_ODI4 = [0, 1.1]; // intercept, ODI4
export const kulkasOf = (c, r) => Math.max(0, c[0] + c[1] * r.odi3 + c[2] * r.desSev + c[3] * r.t95);
export const odi4Of = (c, r) => Math.max(0, c[0] + c[1] * r.odi4);

// ── inputs ─────────────────────────────────────────────────────────────────────────────────────
export function loadAdapter() {
  const sandbox = { console, document: { documentElement: { outerHTML: '' } } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'nsrr-adapter.js'), 'utf8'), sandbox, { filename: 'nsrr-adapter.js' });
  if (!sandbox.NSRR || typeof sandbox.NSRR.parseAhiCsv !== 'function') throw new Error('nsrr-adapter.js did not define NSRR.parseAhiCsv');
  return sandbox.NSRR;
}

const PREDICTORS = ['odi3', 'odi4', 'desSev', 't95'];

/** Pool result rows → the fields a refit needs, with the absent ones kept absent. */
export function rowsFromPool(json, stemVisit) {
  const out = [];
  for (const r of json && Array.isArray(json.records) ? json.records : []) {
    if (!r || r.ok === false || !r.id) continue;
    const subject = (String(r.id).match(/(\d{3,})\s*$/) || [])[1] || null;
    const visit = stemVisit(r.id);
    if (!subject || !visit) continue;
    const row = { stem: String(r.id), subject, visit: String(visit) };
    for (const k of PREDICTORS) row[k] = Number.isFinite(r[k]) ? +r[k] : null;
    row.shippedKulkas = Number.isFinite(r.ahiKulkas) ? +r.ahiKulkas : null;
    row.shippedOdi4 = Number.isFinite(r.ahiOxyEst) ? +r.ahiOxyEst : null;
    out.push(row);
  }
  return out;
}

/** The owner's subject-disjoint split: visit-2 subjects hold out, visit-1-only subjects fit. */
export function splitCohorts(rows) {
  const holdSubjects = new Set();
  for (const r of rows) if (r.visit !== '1') holdSubjects.add(r.subject);
  const fit = rows.filter((r) => r.visit === '1' && !holdSubjects.has(r.subject));
  const hold = rows.filter((r) => r.visit !== '1');
  return { fit, hold, holdSubjects };
}

const subjectsOf = (rows) => new Set(rows.map((r) => r.subject)).size;
const predictorsPresent = (r) => r.odi3 != null && r.odi4 != null && r.desSev != null && r.t95 != null;

// ── one definition ─────────────────────────────────────────────────────────────────────────────
export function fitDefinition(def, fitRows, holdRows, refOf, cfg) {
  const minHold = cfg && cfg.minHoldout != null ? cfg.minHoldout : MIN_HOLDOUT_SUBJECTS;
  const reps = cfg && cfg.reps != null ? cfg.reps : BOOT_REPS;
  const seed = (cfg && cfg.seed) || BOOT_SEED;

  const usable = (rows) => {
    const keep = [];
    let noRef = 0,
      noPred = 0;
    for (const r of rows) {
      const ref = refOf(r);
      if (!predictorsPresent(r)) {
        noPred++;
        continue;
      }
      if (ref == null || !Number.isFinite(ref)) {
        noRef++;
        continue;
      }
      keep.push({ r, ref });
    }
    return { keep, noRef, noPred };
  };

  const F = usable(fitRows);
  const H = usable(holdRows);
  const res = {
    column: def.col,
    nativeTwin: def.native,
    rule: def.rule,
    countsArousals: def.arousals,
    fit: {
      rowsOffered: fitRows.length,
      subjectsOffered: subjectsOf(fitRows),
      rowsUsed: F.keep.length,
      subjectsUsed: subjectsOf(F.keep.map((k) => k.r)),
      excludedNoReference: F.noRef,
      excludedNoPredictor: F.noPred
    },
    holdout: {
      rowsOffered: holdRows.length,
      subjectsOffered: subjectsOf(holdRows),
      rowsUsed: H.keep.length,
      subjectsUsed: subjectsOf(H.keep.map((k) => k.r)),
      excludedNoReference: H.noRef,
      excludedNoPredictor: H.noPred
    },
    coefficients: { shippedKulkas: SHIPPED_KULKAS.slice(), refitKulkas: null, shippedOdi4: SHIPPED_ODI4.slice(), refitOdi4: null },
    rho: { shipped: null, refit: null, delta: null, ci: null },
    odi4Form: null,
    singlePredictorRho: null,
    shippedClamp: null,
    reference: { median: null, n: H.keep.length }
  };

  if (!F.keep.length) {
    res.error = 'no fit record carries this column together with every predictor';
    return res;
  }
  const yF = F.keep.map((k) => k.ref);
  const cK = ols(
    F.keep.map((k) => [1, k.r.odi3, k.r.desSev, k.r.t95]),
    yF
  );
  const cO = ols(
    F.keep.map((k) => [1, k.r.odi4]),
    yF
  );
  res.coefficients.refitKulkas = cK;
  res.coefficients.refitOdi4 = cO;
  if (!cK) {
    res.error = 'the fit design matrix is singular — no refit exists';
    return res;
  }

  const ref = H.keep.map((k) => k.ref);
  const shipped = H.keep.map((k) => (k.r.shippedKulkas != null ? k.r.shippedKulkas : kulkasOf(SHIPPED_KULKAS, k.r)));
  const refit = H.keep.map((k) => kulkasOf(cK, k.r));
  res.rho.shipped = spearman(shipped, ref);
  res.rho.refit = spearman(refit, ref);
  res.rho.delta = res.rho.shipped != null && res.rho.refit != null ? res.rho.refit - res.rho.shipped : null;
  const sortedRef = ref.slice().sort((a, b) => a - b);
  res.reference.median = percentile(sortedRef, 0.5);

  /* The companion, never the decision: the single-multiplier form. Its UNCLAMPED refit ranks the
     records exactly as ODI4 does, which is why a one-parameter refit cannot move rho; any delta
     reported here comes from the max(0, ...) clamp creating ties the shipped form does not have. */
  if (cO) {
    const shippedO = H.keep.map((k) => (k.r.shippedOdi4 != null ? k.r.shippedOdi4 : odi4Of(SHIPPED_ODI4, k.r)));
    const refitO = H.keep.map((k) => odi4Of(cO, k.r));
    const unclamped = H.keep.map((k) => cO[0] + cO[1] * k.r.odi4);
    const rhoUnclampedVsOdi4 = spearman(
      unclamped,
      H.keep.map((k) => k.r.odi4)
    );
    res.odi4Form = {
      rhoShipped: spearman(shippedO, ref),
      rhoRefit: spearman(refitO, ref),
      rankIdenticalToOdi4Unclamped: rhoUnclampedVsOdi4 != null && Math.abs(rhoUnclampedVsOdi4 - 1) < 1e-9,
      note: 'a positive-slope refit of a single predictor is a monotone transform of it, so its rank — and therefore its Spearman rho — is invariant by construction'
    };
    res.odi4Form.delta = res.odi4Form.rhoRefit != null && res.odi4Form.rhoShipped != null ? res.odi4Form.rhoRefit - res.odi4Form.rhoShipped : null;
  }

  /* Two more companions, never the decision. The band was pre-stated against the SHIPPED
     estimator and is scored against it alone; these exist because a reader will ask both
     questions and should not have to re-derive either.

     1. How each predictor ranks the reference BY ITSELF. On the 2026-10-13 hold-out, ODI3 alone
        ranks every definition better than the shipped multi-predictor estimator does, so most of
        the refit's gain is the refit learning to stop mixing in the weaker predictors rather than
        new information.
     2. What the shipped `max(0, ...)` clamp costs. A clamped estimate of exactly 0 ties records
        the reference separates, so the share of clamped records bounds how much of the shipped
        form's rho loss the clamp can explain. */
  res.singlePredictorRho = {
    odi3: spearman(
      H.keep.map((k) => k.r.odi3),
      ref
    ),
    odi4: spearman(
      H.keep.map((k) => k.r.odi4),
      ref
    ),
    desSev: spearman(
      H.keep.map((k) => k.r.desSev),
      ref
    ),
    t95: spearman(
      H.keep.map((k) => k.r.t95),
      ref
    )
  };
  const unclampedShipped = H.keep.map((k) => SHIPPED_KULKAS[0] + SHIPPED_KULKAS[1] * k.r.odi3 + SHIPPED_KULKAS[2] * k.r.desSev + SHIPPED_KULKAS[3] * k.r.t95);
  const zeroEstimates = shipped.filter((v) => v === 0).length;
  res.shippedClamp = {
    zeroEstimates,
    share: H.keep.length ? zeroEstimates / H.keep.length : null,
    rhoUnclamped: spearman(unclampedShipped, ref)
  };

  if (res.holdout.subjectsUsed >= minHold && res.rho.delta != null) {
    const bySubject = new Map();
    H.keep.forEach((k, i) => {
      let c = bySubject.get(k.r.subject);
      if (!c) {
        c = { ref: [], shipped: [], refit: [] };
        bySubject.set(k.r.subject, c);
      }
      c.ref.push(ref[i]);
      c.shipped.push(shipped[i]);
      c.refit.push(refit[i]);
    });
    res.rho.ci = clusterBootstrapDeltaCI([...bySubject.values()], reps, `${seed}:${def.col}`);
  }
  return res;
}

// ── the verdict ────────────────────────────────────────────────────────────────────────────────
export function refitVerdict(res, prov, Verdict, cfg) {
  const minHold = cfg && cfg.minHoldout != null ? cfg.minHoldout : MIN_HOLDOUT_SUBJECTS;
  const population = {
    checked: res.holdout.rowsUsed,
    excluded: res.holdout.excludedNoReference + res.holdout.excludedNoPredictor,
    eligible: res.holdout.rowsOffered
  };
  const criterion = {
    /* The quantity the band tests is the LOWER END of the interval, not the point estimate: the
       refit supersedes only when the whole 95 % CI sits above 0. `direction` is the contract's
       closed enum (lte|gte|eq|within), so the strictness travels in `strict`. */
    name: `spearman_rho_gain_ci95_low_${res.column}`,
    threshold: 0,
    unit: 'rho',
    direction: 'gte',
    strict: true,
    band: BAND,
    prestatedIn: 'briefs/AHI-SURROGATE-REFIT-PAPER-2026-10-13-BRIEF.md §4.4',
    holdoutFloorSubjects: minHold
  };
  const evidence = ['tools/nsrr-ahi-refit.mjs', 'briefs/AHI-SURROGATE-REFIT-PAPER-2026-10-13-BRIEF.md', `harmonized column ${res.column} (native twin ${res.nativeTwin})`];
  const base = { gate: `ahi-refit-${res.column}`, scope: 'internal', population, criterion, evidence, producedBy: prov };

  if (res.error || res.rho.delta == null) {
    return Verdict.make({
      ...base,
      status: 'NOT_RUN',
      result: null,
      reason: res.error || 'no held-out record carries this column together with every predictor, so no rank correlation exists to compare'
    });
  }
  const result = {
    rhoShipped: round(res.rho.shipped),
    rhoRefit: round(res.rho.refit),
    rhoDelta: round(res.rho.delta),
    ci95: res.rho.ci ? [round(res.rho.ci.lo), round(res.rho.ci.hi)] : null,
    holdoutSubjects: res.holdout.subjectsUsed,
    fitSubjects: res.fit.subjectsUsed,
    refitKulkas: res.coefficients.refitKulkas.map(round),
    shippedKulkas: SHIPPED_KULKAS.slice(),
    odi4Form: res.odi4Form ? { rhoShipped: round(res.odi4Form.rhoShipped), rhoRefit: round(res.odi4Form.rhoRefit), rankIdenticalToOdi4Unclamped: res.odi4Form.rankIdenticalToOdi4Unclamped } : null,
    singlePredictorRho: res.singlePredictorRho
      ? { odi3: round(res.singlePredictorRho.odi3), odi4: round(res.singlePredictorRho.odi4), desSev: round(res.singlePredictorRho.desSev), t95: round(res.singlePredictorRho.t95) }
      : null,
    shippedClamp: res.shippedClamp ? { zeroEstimates: res.shippedClamp.zeroEstimates, share: round(res.shippedClamp.share), rhoUnclamped: round(res.shippedClamp.rhoUnclamped) } : null
  };
  if (res.holdout.subjectsUsed < minHold) {
    return Verdict.make({
      ...base,
      status: 'UNDERPOWERED',
      result,
      reason: `the hold-out carries ${res.holdout.subjectsUsed} subjects for this column, under the pre-stated floor of ${minHold}, so the 95 % CI cannot decide the band`
    });
  }
  if (res.rho.ci && res.rho.ci.lo > 0) {
    return Verdict.make({ ...base, status: 'PASS', result, reason: null });
  }
  const ciTxt = res.rho.ci ? `[${round(res.rho.ci.lo)}, ${round(res.rho.ci.hi)}]` : 'absent';
  return Verdict.make({
    ...base,
    status: 'SHORTFALL',
    result,
    reason: `the rank-correlation gain is ${round(res.rho.delta)} with a 95 % CI of ${ciTxt}, which does not exclude 0, so the refit does not supersede the shipped coefficients for this definition`
  });
}

const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e6);

function headCommit() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function loadVerdict() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'verdict.js'), 'utf8'), sandbox, { filename: 'verdict.js' });
  return sandbox.Verdict;
}

// ── sample (for --verdict-sample: the object ALONE on stdout) ──────────────────────────────────
function sampleVerdict(Verdict) {
  const res = {
    column: 'nsrr_ahi_hp3r_aasm15',
    nativeTwin: 'ahi_a0h3a',
    holdout: { rowsOffered: 10, rowsUsed: 8, subjectsUsed: 8, excludedNoReference: 1, excludedNoPredictor: 1 },
    fit: { subjectsUsed: 12 },
    coefficients: { refitKulkas: [-1, 0.9, 0.5, 0.2] },
    rho: { shipped: 0.7, refit: 0.72, delta: 0.02, ci: { lo: -0.01, hi: 0.05, median: 0.02, reps: 2000 } },
    odi4Form: { rhoShipped: 0.68, rhoRefit: 0.68, rankIdenticalToOdi4Unclamped: true }
  };
  return refitVerdict(res, { tool: 'tools/nsrr-ahi-refit.mjs', commit: headCommit() || null, commitReason: 'not a checkout' }, Verdict, { minHoldout: 4 });
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!SCORED) {
    console.error('usage: node tools/nsrr-ahi-refit.mjs --scored=a.json[,b.json] [--harmonized=<csv>] [--out=<json>] [--boot=N] [--seed=S] [--min-holdout=N]');
    return 2;
  }
  const NSRR = loadAdapter();
  const Verdict = loadVerdict();
  const paths = SCORED.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let rows = [];
  for (const p of paths) {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const got = rowsFromPool(j, NSRR.stemVisit);
    console.log(`  read ${String(got.length).padStart(5)} scored records from ${path.basename(p)}`);
    rows = rows.concat(got);
  }
  if (!rows.length) {
    console.error('no scored record read — nothing to fit');
    return 1;
  }
  const { fit, hold } = splitCohorts(rows);
  console.log(`  split (owner 2026-10-12, subject-disjoint): fit ${fit.length} rows / ${subjectsOf(fit)} subjects · hold-out ${hold.length} rows / ${subjectsOf(hold)} subjects`);

  const csv = fs.readFileSync(HARMONIZED, 'utf8');
  const summary = {
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    harmonized: path.basename(HARMONIZED),
    scored: paths.map((p) => path.basename(p)),
    split: { fitRows: fit.length, fitSubjects: subjectsOf(fit), holdoutRows: hold.length, holdoutSubjects: subjectsOf(hold) },
    band: BAND,
    minHoldoutSubjects: MIN_HOLDOUT_SUBJECTS,
    bootstrap: { reps: BOOT_REPS, seed: BOOT_SEED, cluster: 'subject' },
    definitions: [],
    verdicts: []
  };
  const prov = { tool: 'tools/nsrr-ahi-refit.mjs', commit: headCommit() };
  if (!prov.commit) {
    prov.commit = null;
    prov.commitReason = 'not run inside a git checkout';
  }

  for (const def of AHI_DEFS) {
    const table = NSRR.parseAhiCsv(csv, { ahiVar: def.col });
    if (table.error) {
      console.log(`  ${def.col}: ${table.error}`);
      const v = Verdict.make({
        gate: `ahi-refit-${def.col}`,
        status: 'NOT_RUN',
        scope: 'internal',
        population: { checked: 0, excluded: 0, eligible: 0 },
        criterion: { name: `spearman_rho_gain_ci95_low_${def.col}`, threshold: 0, unit: 'rho', direction: 'gte', strict: true, band: BAND },
        result: null,
        reason: `the harmonized file does not carry this column: ${table.error}`,
        evidence: ['tools/nsrr-ahi-refit.mjs'],
        producedBy: prov
      });
      summary.verdicts.push(v);
      continue;
    }
    const refOf = (r) => {
      const hit = NSRR.lookupAhi(table, r.stem);
      return hit ? hit.ahi : null;
    };
    const res = fitDefinition(def, fit, hold, refOf);
    res.referenceTable = { rows: table.rows, subjects: table.subjects, visits: table.visits, ambiguous: table.ambiguous, countsArousals: table.arousals };
    summary.definitions.push(res);
    const v = refitVerdict(res, prov, Verdict);
    const chk = Verdict.validate(v);
    if (!chk.ok) throw new Error(`verdict for ${def.col} is invalid: ${chk.errors.join('; ')}`);
    summary.verdicts.push(v);
    const ci = res.rho.ci ? `[${round(res.rho.ci.lo)}, ${round(res.rho.ci.hi)}]` : 'no CI';
    console.log(
      `  ${def.col.padEnd(22)} ${v.status.padEnd(13)} rho shipped ${fmt(res.rho.shipped)} → refit ${fmt(res.rho.refit)}  delta ${fmt(res.rho.delta)} CI ${ci}  hold-out ${res.holdout.subjectsUsed} subj`
    );
  }

  if (OUT) {
    /* The tracked shape is `tepna.published-number-record/1`, the same record every other number
       in `analysis/published-numbers/` carries: producer, commit, the invocation that reproduces
       it, a digest over the inputs that are NOT in the tree, and a `claims` block holding the
       values at the precision the prose states them. The corpus is under the NSRR DAUA, so the
       inputs are recorded-only and the record carries aggregates alone. */
    const digest = crypto
      .createHash('sha256')
      .update(Buffer.concat(paths.map((p) => fs.readFileSync(p))))
      .digest('hex')
      .slice(0, 12);
    const record = {
      schema: 'tepna.published-number-record/1',
      producer: 'tools/nsrr-ahi-refit.mjs',
      producerCommit: prov.commit ? prov.commit.slice(0, 8) : null,
      producerCommitNote:
        'the branch commit HEAD sat at when the tool ran; a squash merge replaces it, so resolve the record through publishedIn and the pull request that carried it rather than expecting this sha on main',
      invocation: `node tools/nsrr-score-pool.mjs --scorer ./nsrr-oxydex-odi.mjs --out <scored-visitN.json> (per visit) · node tools/nsrr-ahi-refit.mjs --scored=<v1>,<v2> --boot=${BOOT_REPS} --seed=${BOOT_SEED} --min-holdout=${MIN_HOLDOUT_SUBJECTS} --out=<this file>`,
      generated: summary.generated.slice(0, 10),
      inputs: {
        path: 'NSRR SHHS visits 1 and 2 (EDF + annotations-events-nsrr XML) scored to a pool, joined to shhs-harmonized-dataset-0.21.0.csv — data-use agreement, NOT committed, never fetched by the suite',
        committed: false,
        files: summary.split.fitRows + summary.split.holdoutRows,
        digest,
        note: 'digest = sha256[0:12] over the bytes of the scored pool files this refit reads; the corpus itself is not in the tree, so the record is recorded-only and reproducible from the same corpus + producerCommit'
      },
      publishedIn: 'briefs/AHI-SURROGATE-REFIT-PAPER-2026-10-13-BRIEF.md §4.4',
      claims: claimsOf(summary),
      verdicts: summary.verdicts,
      result: summary
    };
    fs.writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`  wrote ${OUT} (tepna.published-number-record/1 — aggregates only, no record identifier)`);
  }
  const statuses = summary.verdicts.map((v) => v.status);
  console.log(`  verdicts: ${statuses.join(' · ')}`);
  return statuses.some((s) => s === 'FAIL') ? 1 : 0;
}

/** The values EXACTLY as the prose states them, so a `CLAIM … FROM … #claims/<key>` compares equal.
    Full precision stays under `result`. */
export function claimsOf(summary) {
  const c = {
    note: 'values at published precision; full precision is under result',
    fitSubjects: summary.split.fitSubjects,
    holdoutSubjects: summary.split.holdoutSubjects,
    bootstrapReps: summary.bootstrap.reps,
    minHoldoutSubjects: summary.minHoldoutSubjects
  };
  for (const d of summary.definitions) {
    const k = d.column.replace(/^nsrr_ahi_/, '');
    const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
    c[`${k}RhoShipped`] = r3(d.rho.shipped);
    c[`${k}RhoRefit`] = r3(d.rho.refit);
    c[`${k}RhoDelta`] = r3(d.rho.delta);
    c[`${k}CiLo`] = d.rho.ci ? r3(d.rho.ci.lo) : null;
    c[`${k}CiHi`] = d.rho.ci ? r3(d.rho.ci.hi) : null;
    c[`${k}RhoOdi3Alone`] = d.singlePredictorRho ? r3(d.singlePredictorRho.odi3) : null;
  }
  const v = summary.verdicts.map((x) => x.status);
  c.verdicts = v.join(' · ');
  return c;
}

const fmt = (v) => (v == null ? '  null' : v.toFixed(4).padStart(7));

// ── selftest ───────────────────────────────────────────────────────────────────────────────────
function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (cond, what) => {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.log(`  FAIL ${what}`);
    }
  };
  const near = (a, b, tol, what) => ok(a != null && Math.abs(a - b) <= tol, `${what} (got ${a}, want ${b}±${tol})`);

  // ranks
  ok(JSON.stringify(rankAvg([10, 20, 30])) === JSON.stringify([1, 2, 3]), 'rankAvg orders');
  ok(JSON.stringify(rankAvg([5, 5, 9])) === JSON.stringify([1.5, 1.5, 3]), 'rankAvg shares a tie');
  ok(JSON.stringify(rankAvg([7, 7, 7])) === JSON.stringify([2, 2, 2]), 'rankAvg of a constant is the mid rank');

  // spearman
  near(spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1, 1e-12, 'spearman of a monotone pair is 1');
  near(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-12, 'spearman of a reversed pair is -1');
  near(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1, 1e-12, 'spearman is scale-invariant');
  near(
    spearman(
      [1, 2, 3, 4],
      [1, 2, 3, 4].map((v) => 2 * v + 5)
    ),
    1,
    1e-12,
    'spearman is invariant under a positive affine transform'
  );
  ok(spearman([1, 1, 1], [1, 2, 3]) === null, 'spearman of a constant vector is null, not 0');
  ok(spearman([1, 2], [1, 2]) === null, 'spearman under three points is null');

  // ols
  const X = [
    [1, 1, 2, 10],
    [1, 2, 1, 23],
    [1, 3, 5, 31],
    [1, 4, 2, 47],
    [1, 5, 7, 52],
    [1, 2, 6, 38]
  ];
  const trueC = [-1.5, 0.75, 0.5, 0.1];
  const y = X.map((r) => r.reduce((a, v, i) => a + v * trueC[i], 0));
  const got = ols(X, y);
  ok(!!got, 'ols solves a well-posed system');
  if (got) for (let i = 0; i < 4; i++) near(got[i], trueC[i], 1e-6, `ols recovers coefficient ${i}`);
  ok(
    ols(
      [
        [1, 1],
        [1, 1]
      ],
      [1, 1]
    ) === null,
    'ols refuses a singular design'
  );
  ok(ols([], []) === null, 'ols refuses an empty design');

  // rng + percentile
  const r1 = mulberry32('seed-a'),
    r2 = mulberry32('seed-a'),
    r3 = mulberry32('seed-b');
  ok(r1() === r2(), 'the same seed reproduces the draw');
  ok(mulberry32('seed-a')() !== r3(), 'a different seed draws differently');
  near(percentile([1, 2, 3, 4, 5], 0.5), 3, 1e-12, 'percentile 0.5 of five points');
  near(percentile([0, 10], 0.25), 2.5, 1e-12, 'percentile interpolates');

  // cluster bootstrap
  const mk = (n, gain) =>
    Array.from({ length: n }, (_, i) => ({
      ref: [i],
      shipped: [i % 7],
      refit: [i + gain * (i % 3)]
    }));
  const ciZero = clusterBootstrapDeltaCI(
    Array.from({ length: 80 }, (_, i) => ({ ref: [i], shipped: [i], refit: [i] })),
    200,
    'z'
  );
  ok(ciZero.lo <= 0 && ciZero.hi >= 0, 'a refit identical to the shipped estimator gives a CI containing 0');
  const ciGain = clusterBootstrapDeltaCI(mk(120, 0.001), 300, 'g');
  ok(ciGain.lo > 0, 'a refit that recovers the reference ordering gives a CI above 0');
  const ciA = clusterBootstrapDeltaCI(mk(60, 0.001), 150, 'same');
  const ciB = clusterBootstrapDeltaCI(mk(60, 0.001), 150, 'same');
  ok(ciA.lo === ciB.lo && ciA.hi === ciB.hi, 'the bootstrap reproduces from its seed');
  const ciC = clusterBootstrapDeltaCI(mk(60, 0.001), 150, 'other');
  ok(ciC.lo !== ciA.lo || ciC.hi !== ciA.hi, 'a different seed gives a different interval');
  const twoRow = clusterBootstrapDeltaCI([{ ref: [1, 2], shipped: [1, 2], refit: [1, 2] }], 5, 's');
  ok(twoRow.reps === 0, 'one cluster of two tied rows decides nothing — no finite rho, no reps');

  // the split
  const rows = [
    { subject: 'a', visit: '1' },
    { subject: 'a', visit: '2' },
    { subject: 'b', visit: '1' },
    { subject: 'c', visit: '2' }
  ];
  const sp = splitCohorts(rows);
  ok(sp.fit.length === 1 && sp.fit[0].subject === 'b', 'the split keeps only visit-1 subjects absent from visit 2');
  ok(sp.hold.length === 2, 'every visit-2 row holds out');
  ok(!sp.fit.some((f) => sp.holdSubjects.has(f.subject)), 'no subject is in both roles');

  // rowsFromPool keeps absence absent
  const stemVisit = (s) => (String(s).match(/shhs(\d)/) || [])[1] || null;
  const pr = rowsFromPool(
    {
      records: [
        { id: 'shhs1-200001', odi3: 5, odi4: 2, desSev: null, t95: 70, ahiKulkas: 11, ahiOxyEst: 2.2 },
        { id: 'shhs2-200002', odi3: 1, odi4: 1, desSev: 3, t95: 80, ahiKulkas: 12, ahiOxyEst: 1.1 },
        { ok: false, id: 'shhs1-200003' },
        { id: 'no-digits' }
      ]
    },
    stemVisit
  );
  ok(pr.length === 2, 'rowsFromPool drops a failed record and an id with no subject');
  ok(pr[0].desSev === null, 'an absent predictor stays null, never 0');
  ok(pr[0].subject === '200001' && pr[0].visit === '1', 'subject and visit come off the stem');

  // one definition, synthetic: the reference IS the Kulkas form with different coefficients
  const synth = [];
  for (let i = 0; i < 900; i++) {
    const odi3 = (i % 37) + 1,
      desSev = (i % 11) + 1,
      t95 = 40 + (i % 50),
      odi4 = odi3 * 0.6;
    synth.push({
      stem: `shhs${i % 3 === 0 ? 2 : 1}-${300000 + i}`,
      subject: String(300000 + i),
      visit: i % 3 === 0 ? '2' : '1',
      odi3,
      odi4,
      desSev,
      t95,
      shippedKulkas: kulkasOf(SHIPPED_KULKAS, { odi3, desSev, t95 }),
      shippedOdi4: odi4Of(SHIPPED_ODI4, { odi4 })
    });
  }
  const refTrue = (r) => Math.max(0, 2 + 0.2 * r.odi3 + 2.5 * r.desSev + 0.01 * r.t95);
  const sSplit = splitCohorts(synth);
  const res = fitDefinition(AHI_DEFS[1], sSplit.fit, sSplit.hold, refTrue, { minHoldout: 10, reps: 200, seed: 'st' });
  ok(res.coefficients.refitKulkas != null, 'a definition fit returns refit coefficients');
  near(res.coefficients.refitKulkas[2], 2.5, 0.01, 'the refit recovers the DesSev weight');
  ok(res.rho.refit > res.rho.shipped, 'the refit ranks the synthetic reference better than the shipped weights');
  ok(res.rho.ci && res.rho.ci.lo > 0, 'the synthetic gain survives the subject-clustered CI');
  ok(res.odi4Form && res.odi4Form.rankIdenticalToOdi4Unclamped, 'the single-multiplier refit is rank-identical to ODI4 unclamped');
  ok(res.holdout.rowsUsed + res.holdout.excludedNoReference + res.holdout.excludedNoPredictor === res.holdout.rowsOffered, 'the hold-out population accounts for every offered row');
  ok(
    res.singlePredictorRho != null && Number.isFinite(res.singlePredictorRho.odi3) && Number.isFinite(res.singlePredictorRho.t95),
    'every predictor gets a rank correlation of its own on the hold-out'
  );
  ok(res.shippedClamp != null && res.shippedClamp.zeroEstimates >= 0 && res.shippedClamp.share <= 1, 'the clamp companion counts the estimates the shipped form pins to zero');
  ok(res.shippedClamp.zeroEstimates === 0 ? res.shippedClamp.rhoUnclamped === res.rho.shipped : true, 'with nothing clamped the unclamped shipped rho is the shipped rho');

  // verdicts
  const Verdict = loadVerdict();
  const prov = { tool: 'tools/nsrr-ahi-refit.mjs', commit: 'abcdef1' };
  const vPass = refitVerdict(res, prov, Verdict, { minHoldout: 10 });
  ok(vPass.status === 'PASS', 'a gain whose CI excludes 0 is a PASS');
  ok(Verdict.validate(vPass).ok, `the PASS verdict validates: ${Verdict.validate(vPass).errors.join('; ')}`);
  const vUnder = refitVerdict(res, prov, Verdict, { minHoldout: 1e9 });
  ok(vUnder.status === 'UNDERPOWERED', 'a hold-out under the floor is UNDERPOWERED');
  ok(/\d/.test(vUnder.reason) && vUnder.reason.includes(String(res.holdout.subjectsUsed)), 'the UNDERPOWERED reason names the count and the floor as numbers');
  ok(Verdict.validate(vUnder).ok, `the UNDERPOWERED verdict validates: ${Verdict.validate(vUnder).errors.join('; ')}`);
  const flatRes = JSON.parse(JSON.stringify(res));
  flatRes.rho.delta = -0.01;
  flatRes.rho.ci = { lo: -0.05, hi: 0.03, median: -0.01, reps: 200 };
  flatRes.coefficients.refitKulkas = res.coefficients.refitKulkas;
  const vShort = refitVerdict(flatRes, prov, Verdict, { minHoldout: 10 });
  ok(vShort.status === 'SHORTFALL', 'a CI containing 0 is a SHORTFALL, never a PASS');
  ok(Verdict.validate(vShort).ok, `the SHORTFALL verdict validates: ${Verdict.validate(vShort).errors.join('; ')}`);
  const vNot = refitVerdict({ ...res, error: 'no record', rho: { shipped: null, refit: null, delta: null, ci: null } }, prov, Verdict, { minHoldout: 10 });
  ok(vNot.status === 'NOT_RUN' && vNot.result === null, 'a definition with nothing to compare is NOT_RUN with a null result');
  ok(Verdict.validate(vNot).ok, `the NOT_RUN verdict validates: ${Verdict.validate(vNot).errors.join('; ')}`);
  ok(Verdict.validate(sampleVerdict(Verdict)).ok, 'the --verdict-sample object validates');

  // the published-number record's claims block
  const cl = claimsOf({
    split: { fitSubjects: 12, holdoutSubjects: 8 },
    bootstrap: { reps: 200 },
    minHoldoutSubjects: 10,
    definitions: [res],
    verdicts: [vPass]
  });
  ok(cl.fitSubjects === 12 && cl.holdoutSubjects === 8 && cl.verdicts === 'PASS', 'the claims block carries the split and the verdict statuses');
  ok(cl.hp3r_aasm15RhoShipped != null && cl.hp3r_aasm15RhoOdi3Alone != null, 'each definition contributes its own claim keys, the single-predictor companion among them');
  ok(String(cl.hp3r_aasm15RhoDelta).replace(/^-?\d*\.?/, '').length <= 4, 'a claim is rounded to published precision, not full precision');

  // the four columns and the named-column reader
  ok(new Set(AHI_DEFS.map((d) => d.col)).size === 4 && new Set(AHI_DEFS.map((d) => d.native)).size === 4, 'four distinct columns, each with its own native twin');
  const NSRR = loadAdapter();
  const csv = 'nsrrid,visitnumber,nsrr_ahi_hp3u,nsrr_ahi_hp4r\n1,1,11.5,4.5\n1,2,12.5,5.5\n2,1,21.5,6.5\n';
  const t3 = NSRR.parseAhiCsv(csv, { ahiVar: 'nsrr_ahi_hp3u' });
  const t4 = NSRR.parseAhiCsv(csv, { ahiVar: 'nsrr_ahi_hp4r' });
  ok(t3.ahiVar === 'nsrr_ahi_hp3u' && t4.ahiVar === 'nsrr_ahi_hp4r', 'the reader honours the named column');
  ok(NSRR.lookupAhi(t3, 'shhs1-1').ahi === 11.5 && NSRR.lookupAhi(t4, 'shhs1-1').ahi === 4.5, 'two definitions read two values for one recording');
  ok(NSRR.parseAhiCsv(csv, { ahiVar: 'nsrr_ahi_nope' }).error != null, 'an absent named column is an error, not another column');
  ok(NSRR.parseAhiCsv('1,5\n2,6\n', { ahiVar: 'nsrr_ahi_hp3u' }).error != null, 'a bare pair list cannot answer for a named column');
  ok(NSRR.parseAhiCsv(csv).ahiVar === 'nsrr_ahi_hp4r', 'a caller that names nothing reads the default search order, which reaches nsrr_ahi_hp4r first');

  // Phrased for tools/selftest-all.mjs's summary parser, which reads an assertion COUNT.
  console.log(fail === 0 ? `\n  all ${pass} selftests passed` : `\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// The literal `argv.includes('--selftest')` form is load-bearing: tools/selftest-all.mjs and
// tools/verdict-adoption.mjs discover a tool's selftest by that call form, not by behaviour.
// Guarded so a reader can `import` the pure functions without the CLI running and exiting.
const RAN_DIRECTLY = isCliEntry(import.meta.url);
if (RAN_DIRECTLY) {
  if (argv.includes('--selftest')) {
    process.exit(selftest());
  } else if (argv.includes('--verdict-sample')) {
    // The object ALONE on stdout — tools/verdict-adoption.mjs parses this.
    console.log(JSON.stringify(sampleVerdict(loadVerdict()), null, 2));
  } else {
    process.exit(await main());
  }
}
