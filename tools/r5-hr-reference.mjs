/*
 * tools/r5-hr-reference.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * R5 (TCH-REFERENCE-VALIDATION §7) on the HR triplet — and the answer is that IT CANNOT BE RUN.
 * This tool exists to PROVE that, and to salvage the one thing that can.
 *
 * TCH-REFERENCE-VALIDATION worked because CPAP is a genuine FOURTH device: its error is independent
 * of the two estimates it judges. That is what let it measure ρ(err_ECG, err_PPG) = 0.42 and expose the
 * violated independence assumption.
 *
 * The HR triplet is {ECGDex, PpgDex, OxyDex}, and its "closest thing to truth" — the chest-ECG
 * Pan–Tompkins leg — IS ONE OF THE THREE CORNERS. That is fatal, and not for the obvious reason.
 *
 *   The obvious problem: measuring the other two against E makes their errors share a term,
 *       e_P = err_P − err_E ,   e_O = err_O − err_E
 *   so even under perfect independence ρ(e_P, e_O) > 0. The apparent fix is to test the measured ρ
 *   against the ρ expected from the shared reference alone:
 *       ρ₀ = σ_E² / √( (σ_P²+σ_E²)(σ_O²+σ_E²) )
 *
 *   THAT FIX DOES NOT WORK — the null IS the measurement:
 *       var(P−O) = var(e_P − e_O) = var(e_P) + var(e_O) − 2·cov(e_P, e_O)
 *       σ_E²(TCH) = [var(E−P) + var(E−O) − var(P−O)] / 2  ≡  cov(e_P, e_O)      ← IDENTITY
 *   Substituting gives ρ₀ ≡ ρ_measured. Verified on the committed corpus to 6.7e-14. The excess is
 *   exactly zero BY ALGEBRA, NOT BY DATA, so the test has ZERO POWER: it cannot detect dependence even
 *   if the dependence is enormous. Reporting a "no excess correlation" result would be meaningless — and
 *   reporting a positive one would FABRICATE TCH-REFERENCE-VALIDATION's Finding B.
 *
 *   The same collapse makes the σ comparison vacuous: TCH reproduces the pairwise variances by
 *   construction, so σ_measured(X)² = σ_X² + σ_E² is an identity too.
 *
 * ⇒ RULE: a three-cornered hat CANNOT be validated using one of its OWN corners as the reference.
 *   Validation requires a genuinely external Nth device. (One is one cable away — CPAPDex's `_SA2.edf`
 *   already carries a `Pulse.1s` lane, currently all −1: the "no oximeter connected" sentinel.)
 *
 * WHAT THIS TOOL DOES SALVAGE — bias. The hat has NO bias term at all, so bias is information it does
 * not encode, and measuring it against the ECG is NOT circular. It finds one: OxyDex under-reads by
 * ≈0.36 bpm, and it survives artifact gating. Every σ the fleet publishes is blind to it.
 *
 * Read-only against uploads/trio/. No bundle, no ledger, no manifestHash move.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRIO = `${REPO}/uploads/trio`;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const pearson = (x, y) => {
  const n = x.length,
    mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx,
      dy = y[i] - my;
    sxy += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : null;
};
// TCH: σ_A² = [var(A−B) + var(A−C) − var(B−C)] / 2   (the classic ρ=0 solve the fleet ships)
const vr = (a) => {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};
function tch(E, P, O) {
  const d = (X, Y) => X.map((v, i) => v - Y[i]);
  const vEP = vr(d(E, P)),
    vEO = vr(d(E, O)),
    vPO = vr(d(P, O));
  const s = (a, b, c) => {
    const v = (a + b - c) / 2;
    return v > 0 ? Math.sqrt(v) : null;
  };
  return { ecg: s(vEP, vEO, vPO), ppg: s(vEP, vPO, vEO), oxy: s(vEO, vPO, vEP) };
}

/* ── load the committed corpus, aligned on the 5-min epoch grid ── */
const load = (n, node) => {
  const j = JSON.parse(readFileSync(`${TRIO}/${n}/${node}_${n}.node-export.json`, 'utf8'));
  const m = new Map();
  for (const e of (j.timeseries || {}).epochs || []) if (e.hr != null) m.set(e.tMin ?? Math.round(e.tMs / 300000) * 5, e.hr);
  return m;
};
const E = [],
  P = [],
  O = [],
  NIGHT = [];
for (const n of readdirSync(TRIO).sort()) {
  const e = load(n, 'ECGDex'),
    p = load(n, 'PpgDex'),
    o = load(n, 'OxyDex');
  for (const k of [...e.keys()].filter((k) => p.has(k) && o.has(k)).sort((a, b) => a - b)) {
    E.push(e.get(k));
    P.push(p.get(k));
    O.push(o.get(k));
    NIGHT.push(n);
  }
}
// the #36 artifact gate: drop an epoch where ONE corner disagrees with BOTH others by >10 bpm
const keep = E.map((_, i) => {
  const e = E[i],
    p = P[i],
    o = O[i];
  return !(e - Math.max(p, o) > 10 || p - Math.max(e, o) > 10 || o - Math.max(e, p) > 10);
});

function run(label, idx) {
  const e = idx.map((i) => E[i]),
    p = idx.map((i) => P[i]),
    o = idx.map((i) => O[i]);
  const errP = p.map((v, i) => v - e[i]); // PPG error vs the chest-ECG reference
  const errO = o.map((v, i) => v - e[i]); // OxyDex error vs the chest-ECG reference
  const t = tch(e, p, o);

  console.log(`\n════ ${label}  (n = ${idx.length} epochs, ${new Set(idx.map((i) => NIGHT[i])).size} nights) ════`);

  console.log('\n  A · BIAS vs the chest-ECG reference — TCH is BLIND to this by construction');
  console.log('     corner    bias (bpm)   |   TCH reports (σ only)');
  console.log(`     PpgDex   ${mean(errP) >= 0 ? '+' : ''}${mean(errP).toFixed(3)}        |   σ = ${t.ppg?.toFixed(2) ?? '—'}  (no bias term exists)`);
  console.log(`     OxyDex   ${mean(errO) >= 0 ? '+' : ''}${mean(errO).toFixed(3)}        |   σ = ${t.oxy?.toFixed(2) ?? '—'}`);

  console.log('\n  B · σ: measured-against-reference vs the reference-free TCH estimate');
  console.log('     corner    σ_measured = SD(X − ECG)      σ_TCH      note');
  const sP = sd(errP),
    sO = sd(errO);
  console.log(`     PpgDex        ${sP.toFixed(2)}                    ${t.ppg?.toFixed(2) ?? '—'}       σ_measured = √(σ_PPG² + σ_ECG²) → an UPPER BOUND`);
  console.log(`     OxyDex        ${sO.toFixed(2)}                    ${t.oxy?.toFixed(2) ?? '—'}       same`);
  console.log(`     ECGDex         —  (it IS the reference — CIRCULAR)   ${t.ecg?.toFixed(2) ?? '—'}       UNVALIDATABLE here`);

  console.log('\n  C · INDEPENDENCE — ⚠️ THIS TEST IS VACUOUS ON THIS TRIPLET. It is printed to PROVE that.');
  const rho = pearson(errP, errO);
  // The obvious correction: even under perfect independence, sharing −err_ECG induces
  //     ρ₀ = σ_E² / √((σ_P²+σ_E²)(σ_O²+σ_E²))
  // It does NOT work, because σ_E²(TCH) ≡ cov(e_P, e_O) — an ALGEBRAIC IDENTITY (see the header).
  // So ρ₀ ≡ ρ_measured, always, and the excess is exactly zero regardless of the data.
  const sE = t.ecg,
    sPt = t.ppg,
    sOt = t.oxy;
  let rho0 = null;
  if (sE != null && sPt != null && sOt != null) rho0 = (sE * sE) / Math.sqrt((sPt * sPt + sE * sE) * (sOt * sOt + sE * sE));
  console.log(`     measured  ρ(err_PPG, err_OXY)                        = ${rho?.toFixed(6) ?? '—'}`);
  console.log(`     null      ρ₀ from the shared reference alone         = ${rho0?.toFixed(6) ?? '—'}`);
  if (rho != null && rho0 != null) {
    console.log(`     excess    = ${(rho - rho0).toExponential(1)}  ← FLOATING-POINT ZERO, BY ALGEBRA, NOT BY DATA`);
    console.log(`     ⇒ the test has EXACTLY ZERO POWER: it cannot detect dependence even if it is enormous.`);
    console.log(`       A hat cannot be validated using one of its OWN corners as the reference. An external`);
    console.log(`       Nth device is required — see the brief §4 (connect the ResMed oximeter).`);
  }
  return { n: idx.length, biasP: mean(errP), biasO: mean(errO), sP, sO, tch: t, rho, rho0 };
}

const all = run(
  'UNGATED — every epoch',
  E.map((_, i) => i)
);
const gated = run(
  'ARTIFACT-GATED (#36 cross-corner gate)',
  E.map((_, i) => i).filter((i) => keep[i])
);

console.log(`\n\n════ R5 verdict ════`);
console.log(`  epochs: ${all.n} → ${gated.n} after the artifact gate (${all.n - gated.n} dropped, ${((100 * (all.n - gated.n)) / all.n).toFixed(1)}%)`);
console.log(`\n  THE ONE NON-VACUOUS RESULT — BIAS (TCH has no bias term, so this is information it does not encode)`);
console.log(`    PpgDex:  ${all.biasP >= 0 ? '+' : ''}${all.biasP.toFixed(3)} → ${gated.biasP >= 0 ? '+' : ''}${gated.biasP.toFixed(3)} bpm   (the artifact gate REMOVES it)`);
console.log(`    OxyDex:  ${all.biasO >= 0 ? '+' : ''}${all.biasO.toFixed(3)} → ${gated.biasO >= 0 ? '+' : ''}${gated.biasO.toFixed(3)} bpm   ← PERSISTS. OxyDex systematically UNDER-READS.`);
console.log(`    Every σ the fleet publishes is blind to this by construction.`);

console.log(`\n  ⚠️ The gate's effect on agreement is PARTLY CIRCULAR — do NOT cite it as validation:`);
console.log(`    σ_measured(PPG):  ${all.sP.toFixed(2)} → ${gated.sP.toFixed(2)}   (${(((gated.sP - all.sP) / all.sP) * 100).toFixed(0)}%)`);
console.log(`    σ_measured(OXY):  ${all.sO.toFixed(2)} → ${gated.sO.toFixed(2)}   (${(((gated.sO - all.sO) / all.sO) * 100).toFixed(0)}%)`);
console.log(`    The gate is DEFINED by cross-corner disagreement, so measuring cross-corner agreement after it`);
console.log(`    is close to tautological. The gate's real evidence is the SQI channel it does NOT use`);
console.log(`    (TRIO-ARTIFACT-GATE §1: burst epochs at SQI 0.37-0.45 vs a 0.52 baseline, beat count doubling).`);

console.log(`\n  σ_TCH vs σ_measured is ALSO an identity here (TCH reproduces the pairwise variances by`);
console.log(
  `  construction): sqrt(${gated.tch.ppg?.toFixed(2)}^2 + ${gated.tch.ecg?.toFixed(2)}^2) = ${Math.sqrt((gated.tch.ppg ?? 0) ** 2 + (gated.tch.ecg ?? 0) ** 2).toFixed(2)} = the measured ${gated.sP.toFixed(2)}. It validates NOTHING.`
);
