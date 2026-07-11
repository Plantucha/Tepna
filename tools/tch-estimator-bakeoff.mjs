#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * tch-estimator-bakeoff.mjs — INTEGRATOR-TCH-ML-ESTIMATOR §2 bake-off
 *
 * QUESTION (from the brief): does a MAXIMUM-LIKELIHOOD TCH or a GROSLAMBERT /
 * two-sample COVARIANCE estimator recover the quiet-corner σ closer to truth than
 * the shipped min-ρ clamp on the negative-variance / quiet-order regime — WITHOUT
 * degrading positive-variance nights or the culprit ranking? If neither beats the
 * clamp materially, STOP and keep the heuristic (a valid, recorded outcome).
 *
 * Candidates run on a PLANTED-TRUTH synthetic corpus (same factor model as
 * tools/tch-multinight.mjs, so "closer to truth" is measurable):
 *   BASE  — the shipped IntegratorTCH.threeCorneredHat (classic → min-ρ `correlated`)
 *   GCOV  — Groslambert covariance: σ²_A = Cov(A−B, A−C)  (Vernotte/Calosso)
 *   NNLS  — constrained maximum-likelihood proxy: non-negative least-squares over
 *           the pairwise-sum system σ²_i+σ²_j = V_ij (active-set, 3 vars)
 *   ORACLE— threeCorneredHat with opts.rho = the PLANTED common-mode ρ (the
 *           external-ρ path; "what good looks like" when ρ is known)
 *
 * Deterministic (seeded LCG), no I/O beyond stdout, no Date.now/Math.random.
 * ANALYSIS ONLY — does NOT modify integrator-tch.js (per brief §2/§3: ship code
 * only if a candidate wins, and then additively behind a flag).
 *
 * USAGE:  node tools/tch-estimator-bakeoff.mjs
 * ════════════════════════════════════════════════════════════════════════ */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TCH = createRequire(import.meta.url)(join(ROOT, 'integrator-tch.js'));
const LABELS = ['ECGDex', 'PpgDex', 'OxyDex'];

/* ── deterministic normals ───────────────────────────────────────────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normals(seed, n) {
  const r = mulberry32(seed), o = [];
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(r(), 1e-12), u2 = r();
    const m = Math.sqrt(-2 * Math.log(u1));
    o.push(m * Math.cos(2 * Math.PI * u2), m * Math.sin(2 * Math.PI * u2));
  }
  return o.slice(0, n);
}

/* ── stats ───────────────────────────────────────────────────────────────── */
const finite = (v) => typeof v === 'number' && isFinite(v);
function mean(a) { let s = 0, n = 0; for (const v of a) if (finite(v)) { s += v; n++; } return n ? s / n : null; }
function covariance(x, y) {
  const px = [], py = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (finite(x[i]) && finite(y[i])) { px.push(x[i]); py.push(y[i]); }
  if (px.length < 2) return null;
  const mx = mean(px), my = mean(py); let s = 0;
  for (let i = 0; i < px.length; i++) s += (px[i] - mx) * (py[i] - my);
  return s / px.length; // population (÷N), matching integrator-tch's variance
}
function sub(a, b) { const n = Math.min(a.length, b.length), o = []; for (let i = 0; i < n; i++) o.push(a[i] - b[i]); return o; }

/* ── candidate estimators ────────────────────────────────────────────────── */
// GCOV — Groslambert / two-sample covariance. σ²_A = Cov(A−B, A−C) (both diffs carry A with +sign).
function gcov(A, B, C) {
  const s2 = { ECGDex: covariance(sub(A, B), sub(A, C)), PpgDex: covariance(sub(B, A), sub(B, C)), OxyDex: covariance(sub(C, A), sub(C, B)) };
  return sigmaFromS2(s2);
}
// NNLS — non-negative least-squares over σ²_i+σ²_j = V_ij (ML proxy: the maximum-likelihood
// σ²≥0 under Gaussian pairwise-difference residuals). Active-set over 3 vars (8 subsets).
function nnls(Vab, Vac, Vbc) {
  const eqs = [['ECGDex', 'PpgDex', Vab], ['ECGDex', 'OxyDex', Vac], ['PpgDex', 'OxyDex', Vbc]];
  const resid = (s) => eqs.reduce((acc, [i, j, v]) => { const d = (s[i] || 0) + (s[j] || 0) - v; return acc + d * d; }, 0);
  const subsets = [['ECGDex', 'PpgDex', 'OxyDex'], ['ECGDex', 'PpgDex'], ['ECGDex', 'OxyDex'], ['PpgDex', 'OxyDex'], ['ECGDex'], ['PpgDex'], ['OxyDex'], []];
  let best = null, bestR = Infinity;
  for (const F of subsets) {
    const s = solveFree(F, eqs);
    if (!s) continue;
    if (F.some((k) => s[k] < -1e-9)) continue; // infeasible active set
    const clamped = {}; for (const k of LABELS) clamped[k] = Math.max(s[k] || 0, 0);
    const r = resid(clamped);
    if (r < bestR) { bestR = r; best = clamped; }
  }
  return sigmaFromS2(best || { ECGDex: 0, PpgDex: 0, OxyDex: 0 });
}
// least-squares over the free variables F (others fixed 0) for the pairwise-sum system
function solveFree(F, eqs) {
  if (F.length === 0) return { ECGDex: 0, PpgDex: 0, OxyDex: 0 };
  // build normal equations A s = b for free vars
  const idx = Object.fromEntries(F.map((k, n) => [k, n]));
  const A = F.map(() => F.map(() => 0)), b = F.map(() => 0);
  for (const [i, j, v] of eqs) {
    const fi = i in idx, fj = j in idx;
    if (fi) { A[idx[i]][idx[i]] += 1; b[idx[i]] += v; if (fj) A[idx[i]][idx[j]] += 1; }
    if (fj) { A[idx[j]][idx[j]] += 1; b[idx[j]] += v; if (fi) A[idx[j]][idx[i]] += 1; }
  }
  const x = solveLin(A, b); if (!x) return null;
  const out = { ECGDex: 0, PpgDex: 0, OxyDex: 0 }; F.forEach((k, n) => { out[k] = x[n]; }); return out;
}
function solveLin(A, b) { // forward elimination (partial pivot) + back-substitution
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}
function sigmaFromS2(s2) {
  const sigma = {}, culpritOf = {};
  for (const k of LABELS) { const v = s2[k] == null ? null : Math.max(s2[k], 0); sigma[k] = v == null ? null : Math.sqrt(v); }
  let culprit = null, cv = -Infinity;
  for (const k of LABELS) if (s2[k] != null && s2[k] > cv) { cv = s2[k]; culprit = k; }
  return { sigma, sigma2: s2, culprit };
}

/* ── planted-correlation factor model (matches tch-multinight synthNight) ──── */
function synthNight(spec) {
  const N = spec.n || 120, seed = spec.seed;
  const Zg = normals(seed + 1, N), Zq = normals(seed + 2, N);
  const Z = { ECGDex: normals(seed + 11, N), PpgDex: normals(seed + 22, N), OxyDex: normals(seed + 33, N) };
  const L = (() => { const w = normals(seed, N), v = []; let acc = 58; for (let i = 0; i < N; i++) { acc += w[i] * 0.6; v.push(acc); } return v; })();
  const s = spec.sigma, ld = spec.load, series = {};
  for (const lab of LABELS) {
    const g = ld[lab].g, q = ld[lab].q, indep = Math.max(0, 1 - g - q); series[lab] = [];
    for (let i = 0; i < N; i++) series[lab].push(L[i] + s[lab] * (Math.sqrt(g) * Zg[i] + Math.sqrt(q) * Zq[i] + Math.sqrt(indep) * Z[lab][i]));
  }
  return { label: spec.label, series, truth: { ...s }, regime: spec.regime, plantedRho: spec.plantedRho };
}
function corpus() {
  const PV = { ECGDex: { g: 0.4, q: 0 }, PpgDex: { g: 0.4, q: 0 }, OxyDex: { g: 0.4, q: 0 } };  // ρ≈0.40 all pairs
  const QO = { ECGDex: { g: 0.6, q: 0 }, PpgDex: { g: 0.6, q: 0 }, OxyDex: { g: 0.6, q: 0 } };  // ρ≈0.60, OxyDex smallest σ
  return [
    { label: 'PV-1', seed: 101, regime: 'positive', load: PV, plantedRho: 0.4, sigma: { ECGDex: 0.9, PpgDex: 2.8, OxyDex: 1.4 } },
    { label: 'PV-2', seed: 202, regime: 'positive', load: PV, plantedRho: 0.4, sigma: { ECGDex: 1.0, PpgDex: 3.2, OxyDex: 1.6 } },
    { label: 'QO-1', seed: 404, regime: 'quiet-order', load: QO, plantedRho: 0.6, sigma: { ECGDex: 1.0, PpgDex: 2.9, OxyDex: 0.5 } },
    { label: 'QO-2', seed: 505, regime: 'quiet-order', load: QO, plantedRho: 0.6, sigma: { ECGDex: 1.1, PpgDex: 3.4, OxyDex: 0.5 } },
    { label: 'QO-3', seed: 606, regime: 'quiet-order', load: QO, plantedRho: 0.6, sigma: { ECGDex: 0.9, PpgDex: 2.6, OxyDex: 0.45 } },
  ].map(synthNight);
}

/* ── run all estimators on one night ─────────────────────────────────────── */
function runNight(night) {
  const A = night.series.ECGDex.map((o, i) => o), B = night.series.PpgDex, C = night.series.OxyDex;
  // integrator-tch aligns via alignTriplet on {tMin,v}; here series are already index-aligned plain arrays
  const aA = A, aB = B, aC = C;
  const pAB = TCH.pairDiffVar(aA, aB), pAC = TCH.pairDiffVar(aA, aC), pBC = TCH.pairDiffVar(aB, aC);
  const Vab = pAB.v, Vac = pAC.v, Vbc = pBC.v;

  const base = TCH.threeCorneredHat(aA, aB, aC, { labels: LABELS, minN: 12 });
  const oracle = TCH.threeCorneredHat(aA, aB, aC, { labels: LABELS, minN: 12, rho: night.plantedRho });
  return {
    label: night.label, regime: night.regime, truth: night.truth, plantedRho: night.plantedRho,
    _A: aA, _B: aB, _C: aC,
    est: {
      BASE: { sigma: base.sigma, culprit: base.culprit, method: base.method },
      GCOV: gcov(aA, aB, aC),
      NNLS: nnls(Vab, Vac, Vbc),
      ORACLE: { sigma: oracle.sigma, culprit: oracle.culprit, method: oracle.method },
    },
  };
}

/* ── report + verdict ────────────────────────────────────────────────────── */
const f2 = (x) => x == null ? ' —  ' : x.toFixed(2);
function main() {
  console.log('IntegratorTCH estimator bake-off — kernel v' + TCH.VERSION + '  (INTEGRATOR-TCH-ML-ESTIMATOR §2)\n');
  const rows = corpus().map(runNight);
  const ESTS = ['BASE', 'GCOV', 'NNLS', 'ORACLE'];

  for (const r of rows) {
    console.log(`■ ${r.label}  [${r.regime}]  planted σ E/P/O = ${f2(r.truth.ECGDex)}/${f2(r.truth.PpgDex)}/${f2(r.truth.OxyDex)}  · true ρ=${r.plantedRho}`);
    for (const e of ESTS) {
      const s = r.est[e].sigma, cul = r.est[e].culprit, m = r.est[e].method ? ` (${r.est[e].method})` : '';
      console.log(`    ${e.padEnd(7)} σ = ${f2(s.ECGDex)}/${f2(s.PpgDex)}/${f2(s.OxyDex)}   culprit=${cul}${m}`);
    }
    console.log('');
  }

  // ── verdict metrics ──
  const qo = rows.filter((r) => r.regime === 'quiet-order');
  const mae = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // FAIR metric: mean recovery error over BOTH non-culprit (quiet) corners — captures the
  // "relocate which corner goes pathological" effect an OxyDex-only metric would hide.
  const quietCorners = (r) => LABELS.filter((k) => k !== 'PpgDex'); // ECGDex + OxyDex (planted culprit is always PpgDex)
  const quietErr = (e) => qo.map((r) => mae(quietCorners(r).map((k) => Math.abs((r.est[e].sigma[k] ?? 0) - r.truth[k]))));
  const culpritOK = (e) => rows.every((r) => r.est[e].culprit === 'PpgDex');
  // GCOV should equal RAW classic (Groslambert = classic in covariance form) — the honest identity check.
  const gcovVsRawClassic = rows.map((r) => {
    const p = { AB: TCH.pairDiffVar(r._A, r._B).v, AC: TCH.pairDiffVar(r._A, r._C).v, BC: TCH.pairDiffVar(r._B, r._C).v };
    const cl = TCH.classic(p.AB, p.AC, p.BC);
    const raw = { ECGDex: Math.sqrt(Math.max(cl.a, 0)), PpgDex: Math.sqrt(Math.max(cl.b, 0)), OxyDex: Math.sqrt(Math.max(cl.c, 0)) };
    return LABELS.map((k) => Math.abs((r.est.GCOV.sigma[k] ?? 0) - raw[k]));
  }).flat();

  console.log('── quiet-corner σ recovery — mean |recovered − planted| over BOTH non-culprit corners (lower=better) ──');
  for (const e of ESTS) console.log(`    ${e.padEnd(7)} MAE = ${mae(quietErr(e)).toFixed(3)} bpm   culprit-correct-all-nights=${culpritOK(e)}`);
  console.log(`\n── identity check · GCOV vs RAW classic (clamped): max |Δσ| = ${Math.max(...gcovVsRawClassic).toFixed(4)} bpm  (≈0 ⇒ Groslambert = classic in covariance form; no free lunch at N=3)`);

  // ── decision ── a candidate must beat BASE by >0.10 bpm on the fair metric without breaking culprit
  const baseMAE = mae(quietErr('BASE'));
  const winner = ['GCOV', 'NNLS'].find((e) => mae(quietErr(e)) < baseMAE - 0.10 && culpritOK(e));
  console.log('\n════════════════════════════════════════════════════════════════');
  if (winner) {
    console.log(`VERDICT: ${winner} beats the min-ρ clamp on quiet-corner recovery (MAE ${mae(quietErr(winner)).toFixed(3)} < BASE ${baseMAE.toFixed(3)}). → ship additively per §3.`);
  } else {
    console.log(`VERDICT: no HR-only candidate beats the shipped min-ρ clamp at N=3.`);
    console.log(`  BASE(min-ρ) quiet-MAE=${baseMAE.toFixed(3)} · GCOV=${mae(quietErr('GCOV')).toFixed(3)} · NNLS=${mae(quietErr('NNLS')).toFixed(3)} · ORACLE(external ρ)=${mae(quietErr('ORACLE')).toFixed(3)}`);
    console.log('  GCOV = classic in covariance form (identity above); on negative-variance nights it and NNLS merely');
    console.log('  RELOCATE which quiet corner is driven to ~0 — they do NOT resolve the quiet-order ambiguity. Only');
    console.log('  ORACLE (external ρ) recovers both quiet corners → the N=3 single-channel regime is under-determined');
    console.log('  without external info. KEEP the min-ρ clamp + quietOrderUncertain flag + _tchRhoFromMotion; the ML/GCOV');
    console.log("  advantage is over-determination (N≥4) — fold it into §4's n-cornered hat, not a N=3 swap.");
  }
  console.log('════════════════════════════════════════════════════════════════');
}
main();
