/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * See briefs/TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04-BRIEF.md §3
 * ════════════════════════════════════════════════════════════════════════════ */
/* Is ONE CONSTANT ρ PER PAIR the mis-specification?
 *
 * §8a solved the CPAP/ECG/PPG respiration triplet with a single ρ(ECG,PPG) estimated over the WHOLE
 * corpus, and σ(CPAP) collapsed to 0.19 bpm at ρ = 0.42 — within 0.5 % of ρ_crit ≈ 0.422, the
 * correlation at which σ(CPAP) hits zero and past which there is no solution.
 *
 * The open item asks the obvious question: if ρ varies BETWEEN nights, the pooled value can sit next
 * to the singularity while no individual night does. Then the model is wrong, not the triplet.
 *
 * METHOD NOTE — why "per night" and not literally "per epoch". ρ is a CORRELATION; a single epoch is
 * one sample pair and admits no correlation at all. The finest partition on which ρ is estimable here
 * is the night (5–6 epochs each). Reporting a "per-epoch ρ" would be reporting a number that cannot
 * exist — the same shape of error this brief family exists to prevent. Nights with n < 4 are refused,
 * not imputed.
 *
 * Input:  /tmp/p6.json  (written by tools/tch-reference-validation.mjs — run that first)
 * Usage:  node tools/tch-per-epoch-rho.mjs [--boot N]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── load the gated kernel; never re-implement the solver (the sibling lesson: a second
      implementation of the model is free to disagree with the σ it qualifies) ── */
const ctx = vm.createContext({ window: {}, self: {}, console, Math, JSON, Date });
ctx.window = ctx;
ctx.globalThis = ctx;
for (const f of ['analysis-stats.js']) {
  vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
}
const AS = ctx.AnalysisStats;
if (!AS || typeof AS.tchSigmasPairwiseFromVars !== 'function') {
  console.error('AnalysisStats.tchSigmasPairwiseFromVars unavailable — cannot proceed');
  process.exit(1);
}

const IN = process.env.IN || '/tmp/p6.json';
if (!fs.existsSync(IN)) {
  console.error(`missing ${IN} — run: node tools/tch-reference-validation.mjs`);
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(IN, 'utf8')).filter((r) => [r.cpap, r.ecg, r.ppg].every((v) => v != null && isFinite(v)));

/* ── stats ── */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const varr = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
};
const sd = (a) => Math.sqrt(varr(a));
function corr(a, b) {
  if (a.length < 3) return NaN;
  const ma = mean(a),
    mb = mean(b);
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma,
      y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

/* ── group epochs into NIGHTS: cluster on a >12 h gap in tMs (they are days apart) ── */
rows.sort((a, b) => a.tMs - b.tMs);
const nights = [];
let cur = null;
for (const r of rows) {
  if (!cur || r.tMs - cur.last > 12 * 3600 * 1000) {
    cur = { rows: [], last: r.tMs };
    nights.push(cur);
  }
  cur.rows.push(r);
  cur.last = r.tMs;
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ── the three difference variances + ρ of the residuals against CPAP-as-truth ── */
function legs(rs) {
  const dCE = rs.map((r) => r.cpap - r.ecg);
  const dCP = rs.map((r) => r.cpap - r.ppg);
  const dEP = rs.map((r) => r.ecg - r.ppg);
  return {
    n: rs.length,
    vCE: varr(dCE),
    vCP: varr(dCP),
    vEP: varr(dEP),
    // residual correlation ECG↔PPG, measured against CPAP as truth
    rho: corr(
      rs.map((r) => r.ecg - r.cpap),
      rs.map((r) => r.ppg - r.cpap)
    ),
    sdMeasECG: sd(dCE),
    sdMeasPPG: sd(dCP)
  };
}
function solve(L, rho) {
  return AS.tchSigmasPairwiseFromVars(L.vCE, L.vCP, L.vEP, { ab: 0, ac: 0, bc: rho });
}
/* `rhoCrit` is { pairs, nearest } — `nearest` is the smallest move in ANY single rho that breaks the
   solve. There is no `.value` field; reading one returns undefined and prints "n/a" forever, which is
   how a degeneracy metric silently stops being reported. */
function critMargin(s) {
  const c = s && s.rhoCrit;
  if (!c) return null;
  const v = c.nearest && typeof c.nearest === 'object' ? c.nearest.margin : c.nearest;
  return typeof v === 'number' && isFinite(v) ? v : null;
}

console.log('════ POOLED — reproduce §8a before trusting anything downstream ════');
const P = legs(rows);
console.log(`  epochs=${P.n}  nights=${nights.length}`);
console.log(`  variances  Var(CPAP−ECG)=${P.vCE.toFixed(3)}  Var(CPAP−PPG)=${P.vCP.toFixed(3)}  Var(ECG−PPG)=${P.vEP.toFixed(3)}`);
console.log(`  measured   sd(CPAP−ECG)=${P.sdMeasECG.toFixed(2)}  sd(CPAP−PPG)=${P.sdMeasPPG.toFixed(2)}  (CPAP is truth)`);
console.log(`  rho(ECG,PPG) residual-correlation = ${P.rho.toFixed(4)}`);
for (const r of [0, 0.3, P.rho, 0.5]) {
  const s = solve(P, r);
  const lab = Math.abs(r - P.rho) < 1e-9 ? `${r.toFixed(2)} (measured)` : r.toFixed(2);
  if (!s || !s.ok) {
    console.log(`   rho=${lab.padEnd(16)} NO SOLUTION`);
    continue;
  }
  console.log(
    `   rho=${lab.padEnd(16)} sigma CPAP=${s.a.toFixed(4)}  ECG=${s.b.toFixed(3)}  PPG=${s.c.toFixed(3)}` +
      (s.rhoCrit ? `   nearest-margin=${critMargin(s) != null ? critMargin(s).toFixed(4) : 'n/a'}` : '')
  );
}

console.log('\n════ PER NIGHT — is the pooled rho an artefact of pooling? ════');
console.log('  date        n   rho      Var(C−E) Var(C−P) Var(E−P)   sigma CPAP/ECG/PPG        rhoCrit  margin');
const per = [];
for (const nt of nights) {
  const d = iso(nt.rows[0].tMs);
  if (nt.rows.length < 4) {
    console.log(`  ${d}  ${String(nt.rows.length).padStart(2)}   REFUSED — n<4, rho is not estimable on this night`);
    per.push({ date: d, n: nt.rows.length, refused: true });
    continue;
  }
  const L = legs(nt.rows);
  const s = solve(L, L.rho);
  const s0 = solve(L, 0);
  const line =
    `  ${d}  ${String(L.n).padStart(2)}  ${L.rho >= 0 ? ' ' : ''}${L.rho.toFixed(3)}   ` + `${L.vCE.toFixed(2).padStart(7)} ${L.vCP.toFixed(2).padStart(8)} ${L.vEP.toFixed(2).padStart(8)}   `;
  if (!s || !s.ok) {
    console.log(line + 'NO SOLUTION at its own rho' + (s0 && s0.ok ? `   (rho=0 gives ${[s0.a, s0.b, s0.c].map((x) => x.toFixed(2)).join('/')})` : ''));
    per.push({ date: d, n: L.n, rho: L.rho, ok: false, s0: s0 && s0.ok ? [s0.a, s0.b, s0.c] : null });
    continue;
  }
  console.log(line + `${s.a.toFixed(4).padStart(7)} ${s.b.toFixed(2).padStart(5)} ${s.c.toFixed(2).padStart(5)}   ` + `${critMargin(s) != null ? critMargin(s).toFixed(4) : ' n/a  '}`);
  per.push({ date: d, n: L.n, rho: L.rho, ok: true, sigmas: [s.a, s.b, s.c], margin: critMargin(s), s0: s0 && s0.ok ? [s0.a, s0.b, s0.c] : null });
}

/* ── the actual question, answered with a spread and not a point estimate ── */
const solved = per.filter((p) => p.ok);
const refused = per.filter((p) => p.refused);
const nosol = per.filter((p) => p.ok === false && !p.refused);
console.log('\n════ VERDICT ════');
console.log(`  nights: ${per.length}   solved: ${solved.length}   no-solution: ${nosol.length}   refused (n<4): ${refused.length}`);
if (solved.length) {
  const rhos = solved.map((p) => p.rho).sort((a, b) => a - b);
  const med = rhos[rhos.length >> 1];
  console.log(`  per-night rho: min ${rhos[0].toFixed(3)}  median ${med.toFixed(3)}  max ${rhos[rhos.length - 1].toFixed(3)}   (pooled ${P.rho.toFixed(3)})`);
  const sc = solved.map((p) => p.sigmas[0]).sort((a, b) => a - b);
  console.log(`  per-night sigma(CPAP): min ${sc[0].toFixed(2)}  median ${sc[sc.length >> 1].toFixed(2)}  max ${sc[sc.length - 1].toFixed(2)}`);
  const marg = solved
    .filter((p) => typeof p.margin === 'number')
    .map((p) => p.margin)
    .sort((a, b) => a - b);
  if (marg.length) console.log(`  per-night margin to rhoCrit: min ${marg[0].toFixed(4)}  median ${marg[marg.length >> 1].toFixed(4)}  max ${marg[marg.length - 1].toFixed(4)}`);
  const near = solved.filter((p) => typeof p.margin === 'number' && p.margin < 0.05).length;
  console.log(`  nights within 0.05 of their OWN rhoCrit: ${near}/${solved.length}`);
}

/* ── bootstrap the POOLED rho over nights, so the headline carries an interval ── */
const B = Number(process.env.BOOT || 2000);
if (nights.length >= 4) {
  // deterministic LCG — Math.random() would make this unreproducible
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const boot = [];
  for (let b = 0; b < B; b++) {
    const pick = [];
    for (let i = 0; i < nights.length; i++) pick.push(...nights[Math.floor(rnd() * nights.length)].rows);
    const L = legs(pick);
    if (isFinite(L.rho)) boot.push(L.rho);
  }
  boot.sort((a, b) => a - b);
  const q = (p) => boot[Math.max(0, Math.min(boot.length - 1, Math.floor(p * boot.length)))];
  console.log(`\n  pooled rho ${P.rho.toFixed(4)}   95 % CI [${q(0.025).toFixed(4)}, ${q(0.975).toFixed(4)}]   (${boot.length} night-level bootstrap resamples)`);
  // bisect the REAL solver for the pooled singularity, rather than reading a field that may not exist
  let cv = null;
  {
    let lo = 0,
      hi = 1;
    if (solve(P, lo) && solve(P, lo).ok) {
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        const o = solve(P, m);
        o && o.ok ? (lo = m) : (hi = m);
      }
      cv = lo;
    }
  }
  if (cv != null) {
    const frac = boot.filter((r) => r >= cv).length / boot.length;
    console.log(`  rhoCrit ${cv.toFixed(5)} — the bootstrap puts ${(frac * 100).toFixed(1)} % of the mass AT OR PAST the singularity`);
  }
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════
   SELF-TEST — the identity, on data this tool did not measure.

   ρ̂ = corr(E−C, P−C) and "the ρ at which σ_C = 0" are the SAME EXPRESSION:

     Cov(E−C, P−C) = [Var(E−C) + Var(P−C) − Var(E−P)] / 2          (since (E−C)−(P−C) = E−P)
     ⟹  ρ̂ = [vCE + vCP − vEP] / (2·√vCE·√vCP)

     σ_C = 0  ⟹  vCE = σE², vCP = σP², vEP = σE² + σP² − 2ρ σE σP
     ⟹  ρ    = [vCE + vCP − vEP] / (2·√vCE·√vCP)                    ← identical

   So a ρ estimated as the residual correlation against one corner TREATED AS TRUTH forces that
   corner's σ to zero, for ANY data. Run on randoms so this cannot be read as a property of the
   corpus. A failure here means the derivation is wrong, not that the night was unusual. */
{
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  let worst = 0;
  for (let trial = 0; trial < 200; trial++) {
    const n = 6 + Math.floor(rnd() * 40);
    const rs = [];
    for (let i = 0; i < n; i++) {
      const truth = 15 + 3 * gauss();
      rs.push({ cpap: truth + 2 * gauss(), ecg: truth + 3 * gauss(), ppg: truth + 2.5 * gauss() });
    }
    const L = legs(rs);
    const atZero = (L.vCE + L.vCP - L.vEP) / (2 * Math.sqrt(L.vCE) * Math.sqrt(L.vCP));
    worst = Math.max(worst, Math.abs(L.rho - atZero));
  }
  const OK = worst < 1e-9;
  console.log(`\n  SELF-TEST · rho_measured === rho_at_sigmaC_zero over 200 random triples: ` + `${OK ? 'HOLDS' : 'FAILED'} (worst |diff| ${worst.toExponential(2)})`);
  if (!OK) process.exitCode = 1;
}
