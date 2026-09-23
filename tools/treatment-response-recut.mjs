#!/usr/bin/env node
/*
 * tools/treatment-response-recut.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * `papers/treatment-response.html` TABLE 1, RE-CUT AT WHAT THE GENERATOR YIELDS — a committed record.
 *
 * Owner ruling 2026-09-21 (OWNER-DECISION-QUEUE D9.2): the paper's Table 1 states 912 intervention +
 * 918 flat-control patients at ≥ 10 nights, and that configuration is not recoverable from the
 * repository (three artifacts, three cohort sizes — residues 2026-09-16-treatment-response-config-
 * unreproducible · 2026-09-17-…-gap-is-not-the-generator · 2026-09-17-…-three-cohort-sizes). Driving the
 * page at its stated `nSubj: 900, minN: 10` yields 269 / 317, identically under cohort-gen 1.9 and 2.0.
 * The ruling: re-cut at that n, restate the headline "with the CI it actually supports", not
 * reconfigured toward ~900/arm.
 *
 * WHAT THIS ADDS TO THE PAGE'S OUTPUT. `window.TREATMENT_RESPONSE` publishes, per detector, exact %,
 * within ±1 %, median |err|, AUC and the two median R² — POINT values, no intervals. At n = 269 the
 * interval is the number that matters, and it is computable exactly from what the page does publish:
 *   proportions   Wilson 95 % score interval on (round(pct·n/100), n)   — never a Wald interval, which
 *                 misbehaves near 100 %, where the fused exact rate sits
 *   AUC           Hanley & McNeil (1982) 95 % interval from AUC, n_pos, n_neg
 *   medians       carried as published; no interval (the page does not expose the per-patient arrays)
 * Nothing here re-scores a patient; it reads the captured result global from `tools/analysis-rerun.mjs`
 * and writes a tepna.published-number-record/1 whose `claims` are at the paper's precision (integers
 * for %, 2 dp for AUC and R², CI bounds at 1 dp for % and 3 dp for AUC).
 *
 *   node tools/treatment-response-recut.mjs --rerun <analysis-rerun-results.json> [--out <record.json>]
 *   node tools/treatment-response-recut.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const Z = 1.959964;

/* Wilson score interval for k successes of n — the standard for a proportion near its bounds. */
export function wilson(k, n) {
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n;
  const z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
/* Hanley & McNeil 1982: SE of the AUC from the AUC alone and the two group sizes. */
export function hanleyMcNeil(auc, nPos, nNeg) {
  if (!(nPos > 0 && nNeg > 0) || !(auc >= 0 && auc <= 1)) return null;
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const se = Math.sqrt((auc * (1 - auc) + (nPos - 1) * (q1 - auc * auc) + (nNeg - 1) * (q2 - auc * auc)) / (nPos * nNeg));
  return [Math.max(0, auc - Z * se), Math.min(1, auc + Z * se), se];
}

export const DETECTORS = ['odi', 'rmssd', 'fused']; // the page's keys (odi = ODI-4 / OxyDex)

/* The re-cut over the page's result global. Pure. */
export function recut(R) {
  const nTx = R.nIntervention;
  const nFlat = R.nFlatControl;
  const out = { nIntervention: nTx, nFlatControl: nFlat, minNights: R.minNights, detectors: {} };
  for (const d of DETECTORS) {
    const L = (R.localization || {})[d] || {};
    const D = (R.detection || {})[d] || {};
    const n = L.n;
    const kExact = L.exactPct != null && n ? Math.round((L.exactPct * n) / 100) : null;
    const kW1 = L.within1Pct != null && n ? Math.round((L.within1Pct * n) / 100) : null;
    const hm = D.auc != null ? hanleyMcNeil(D.auc, nTx, nFlat) : null;
    out.detectors[d] = {
      n,
      exactPct: L.exactPct != null ? L.exactPct : null,
      exactCi95Pct: kExact != null ? wilson(kExact, n).map((v) => 100 * v) : null,
      within1Pct: L.within1Pct != null ? L.within1Pct : null,
      within1Ci95Pct: kW1 != null ? wilson(kW1, n).map((v) => 100 * v) : null,
      medAbsErrNights: L.medAbsErr != null ? L.medAbsErr : null,
      auc: D.auc != null ? D.auc : null,
      aucCi95: hm ? [hm[0], hm[1]] : null,
      aucSe: hm ? hm[2] : null,
      txMedR2: D.txMedR2 != null ? D.txMedR2 : null,
      flatMedR2: D.flatMedR2 != null ? D.flatMedR2 : null
    };
  }
  return out;
}

export function claimsOf(S) {
  const f = (v, d) => (v == null ? null : +v.toFixed(d));
  const c = { nIntervention: S.nIntervention, nFlatControl: S.nFlatControl, minNights: S.minNights };
  for (const d of DETECTORS) {
    const x = S.detectors[d];
    const k = d[0].toUpperCase() + d.slice(1);
    c['n' + k] = x.n;
    c['exact' + k] = f(x.exactPct, 0);
    c['exactLo' + k] = x.exactCi95Pct ? f(x.exactCi95Pct[0], 1) : null;
    c['exactHi' + k] = x.exactCi95Pct ? f(x.exactCi95Pct[1], 1) : null;
    c['within1' + k] = f(x.within1Pct, 0);
    c['within1Lo' + k] = x.within1Ci95Pct ? f(x.within1Ci95Pct[0], 1) : null;
    c['within1Hi' + k] = x.within1Ci95Pct ? f(x.within1Ci95Pct[1], 1) : null;
    c['medErr' + k] = f(x.medAbsErrNights, 1);
    c['auc' + k] = f(x.auc, 2);
    c['aucLo' + k] = x.aucCi95 ? f(x.aucCi95[0], 3) : null;
    c['aucHi' + k] = x.aucCi95 ? f(x.aucCi95[1], 3) : null;
    c['txR2' + k] = f(x.txMedR2, 2);
    c['flatR2' + k] = f(x.flatMedR2, 2);
  }
  return c;
}

const sha12 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);
function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (!c && d != null ? '  — ' + d : ''));
    if (!c) fail++;
  };
  // Wilson: textbook values — 0/10 → [0, 0.278]; 10/10 → [0.722, 1]; 50/100 → [0.404, 0.596]
  const w0 = wilson(0, 10);
  ok('Wilson 0/10 → [0, 0.278] (a Wald interval would be [0, 0])', w0[0] === 0 && Math.abs(w0[1] - 0.2775) < 0.001, JSON.stringify(w0));
  const w10 = wilson(10, 10);
  ok('Wilson 10/10 → [0.722, 1]', Math.abs(w10[0] - 0.7225) < 0.001 && Math.abs(w10[1] - 1) < 1e-12, JSON.stringify(w10));
  const w50 = wilson(50, 100);
  ok('Wilson 50/100 → [0.404, 0.596]', Math.abs(w50[0] - 0.4038) < 0.001 && Math.abs(w50[1] - 0.5962) < 0.001, JSON.stringify(w50));
  ok('Wilson refuses k > n and n = 0', wilson(5, 4) === null && wilson(0, 0) === null);
  // Hanley–McNeil: AUC 0.5 with n=n gives se = sqrt(0.25/n + …); sanity — se shrinks with n, AUC 1 → se 0
  const h1 = hanleyMcNeil(1, 269, 317);
  ok('Hanley–McNeil: AUC 1 → SE 0, interval [1, 1]', h1[2] === 0 && h1[0] === 1 && h1[1] === 1, JSON.stringify(h1));
  const hSmall = hanleyMcNeil(0.9, 27, 32);
  const hBig = hanleyMcNeil(0.9, 269, 317);
  ok('Hanley–McNeil: the interval narrows with n (27/32 vs 269/317)', hSmall[1] - hSmall[0] > hBig[1] - hBig[0], JSON.stringify([hSmall, hBig]));
  ok('Hanley–McNeil 0.99 at 269/317 is a few thousandths wide', hBig && hanleyMcNeil(0.99, 269, 317)[2] < 0.01, String(hanleyMcNeil(0.99, 269, 317)[2]));
  const R = {
    minNights: 10,
    nIntervention: 269,
    nFlatControl: 317,
    localization: {
      odi: { n: 269, exactPct: 73.23, within1Pct: 85.13, medAbsErr: 0 },
      rmssd: { n: 269, exactPct: 87.36, within1Pct: 96.28, medAbsErr: 0 },
      fused: { n: 269, exactPct: 91.08, within1Pct: 97.4, medAbsErr: 0 }
    },
    detection: { odi: { auc: 0.94, txMedR2: 0.79, flatMedR2: 0.27 }, rmssd: { auc: 0.97, txMedR2: 0.76, flatMedR2: 0.24 }, fused: { auc: 0.99, txMedR2: 0.85, flatMedR2: 0.27 } }
  };
  const S = recut(R);
  ok('recut: three detectors, n carried', Object.keys(S.detectors).length === 3 && S.detectors.fused.n === 269);
  ok(
    'recut: the fused exact 91.08 % of 269 → k 245 → Wilson [87.0, 93.9]',
    S.detectors.fused.exactCi95Pct && Math.abs(S.detectors.fused.exactCi95Pct[0] - 87.0) < 0.2 && Math.abs(S.detectors.fused.exactCi95Pct[1] - 93.9) < 0.2,
    JSON.stringify(S.detectors.fused.exactCi95Pct)
  );
  ok('recut: AUC interval present and inside [0, 1]', S.detectors.odi.aucCi95 && S.detectors.odi.aucCi95[0] > 0.9 && S.detectors.odi.aucCi95[1] <= 1, JSON.stringify(S.detectors.odi.aucCi95));
  const C = claimsOf(S);
  ok(
    'claims: published precision (exact integer %, CI 1 dp, AUC 2 dp, AUC CI 3 dp)',
    C.exactFused === 91 && C.exactLoFused === 87.1 && C.aucFused === 0.99 && String(C.aucLoFused).split('.')[1].length <= 3,
    JSON.stringify({ e: C.exactFused, lo: C.exactLoFused, a: C.aucFused, alo: C.aucLoFused })
  );
  ok(
    'claims: every value a number or null, never NaN',
    Object.values(C).every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)))
  );
  const E = recut({ minNights: 10, nIntervention: 0, nFlatControl: 0, localization: {}, detection: {} });
  ok('an empty run yields nulls, never zeros standing in for absence', E.detectors.fused.exactPct === null && E.detectors.fused.auc === null && E.detectors.fused.exactCi95Pct === null);
  console.log(fail ? fail + ' failed of 13' : 'all 13 selftests passed');
  return fail ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const rerunPath = arg('--rerun', null);
  if (!rerunPath) {
    console.error('usage: node tools/treatment-response-recut.mjs --rerun <analysis-rerun-results.json> [--out <record.json>] | --selftest');
    return 2;
  }
  const raw = readFileSync(rerunPath);
  const rerun = JSON.parse(raw.toString('utf8'));
  const tools = rerun.tools || {};
  const tool = Array.isArray(tools) ? tools.find((t) => t.page === 'treatment-response-analysis.html') : tools['treatment-response-analysis.html'] || rerun;
  const R = tool.result || tool.captured || tool;
  if (!R || R.nIntervention == null) {
    console.error('no treatment-response result global in ' + rerunPath);
    return 2;
  }
  const S = recut(R);
  const record = {
    schema: 'tepna.published-number-record/1',
    producer: 'tools/treatment-response-recut.mjs',
    producerCommit: headCommit(),
    invocation: 'node tools/analysis-rerun.mjs --only treatment-response-analysis.html --paper-scale --out <rerun.json> · node tools/treatment-response-recut.mjs --rerun <rerun.json>',
    generated: new Date().toISOString().slice(0, 10),
    inputs: {
      path: 'treatment-response-analysis.html at nSubj 900 / minN 10 (synthetic cohort, cohort-gen ' + (tool.cohortGen || 'as inlined') + '; deterministic seed)',
      committed: true,
      files: 1,
      digest: sha12(raw),
      note: 'digest = sha256[0:12] over the captured rerun results file; the page and the generator it inlines are committed, so the run is reproducible from producerCommit'
    },
    publishedIn: 'papers/treatment-response.html Table 1 (re-cut correction block, 2026-09-22)',
    claims: { note: 'values EXACTLY as the prose states them, so CLAIM … FROM … #claims/<key> compares equal; intervals: Wilson 95 % for proportions, Hanley–McNeil 95 % for AUC', ...claimsOf(S) },
    result: { recut: S, pageResult: R, rerunMeta: { ms: tool.ms, tier: tool.tier, inputs: tool.inputs } }
  };
  const out = arg('--out', null);
  if (out) {
    writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
    console.error('wrote ' + out);
  } else console.log(JSON.stringify(record, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
