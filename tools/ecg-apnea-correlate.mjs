#!/usr/bin/env node
/*
 * tools/ecg-apnea-correlate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE STANDING APNEA-CORRELATE HARNESS (ECGDEX-CARDIOPULMONARY-COUPLING §9 / -FOLLOWUPS §4).
 *
 * Correlates every candidate in ECGDex's `apnea` block against the CPAP's OWN device-scored
 * `residualAHI`, across the nights where both exist. That label is the whole reason this line of
 * work can conclude anything: every earlier attempt was scored against an OxyDex desaturation, which
 * is a delayed, threshold-gated CONSEQUENCE of apnea (DEEP-STAGE-DESAT-CONFOUND §9.6).
 *
 * WHY THIS EXISTS AS A COMMITTED TOOL. §9 published `cpcHfc` r = −0.408 and `cvhrIndex` r = −0.151
 * from a script that was not committed — the same failure §11/§12 hit, where a quoted result could
 * not be re-run without rebuilding the harness from prose. So §9's numbers are now a **CONTROL** this
 * tool reproduces on every run: if the `hfcPct` row does not come back at −0.408, either the corpus
 * moved or this harness is wrong, and both are things you want to know BEFORE reading a new row.
 *
 * WHY NOT A DSP CHANGE. Reads two already-emitted export sets and computes no new signal — no bundle,
 * no manifestHash. Read-only: writes nothing.
 *
 * INPUTS
 *   --dir <trio>    `uploads/trio/<night>/ECGDex_<night>.node-export.json` (tools/trio-batch.mjs output)
 *   --cpap <json>   output of `node tools/cpap-corpus.mjs --root <SD>/DATALOG --out <file>`
 *
 * WHAT POPULATION A ROW IS ABOUT. The trio root is re-tiered and re-folded between runs, so a
 * correlation that moved because a night arrived reads exactly like one that moved because a
 * candidate changed. Every run now snapshots the root before the walk and again after it, publishes
 * that comparison as a `tepna.verdict/1` under the gate `corpus-population`, and names the offered
 * nights the read could not pair (row 2026-10-21-forty-one-corpus-enumerators-report-no-population).
 *
 * USAGE
 *   node tools/ecg-apnea-correlate.mjs --cpap /tmp/cpap-exports.json [--dir uploads/trio] [--json]
 *     --selftest         known-answer checks for the correlation math (no corpus, no I/O)
 *     --verdict-sample   the population verdict alone, for `verify:verdict-adoption`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { populationVerdict, ruleLine, snapshotNights } from './corpus-scope.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const AS_JSON = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');
const DIR = opt('--dir', join(ROOT, 'uploads', 'trio'));
const CPAP = opt('--cpap', null);

/* ── stats ────────────────────────────────────────────────────────────────── */
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx,
      dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/* Fisher z transform → CI. The r distribution is skewed, so a ±1.96·SE band on r itself would be
   wrong at the tails; Fisher's z is the standard fix and is what §9's published intervals used. */
function fisherCI(r, n) {
  if (r == null || n < 4) return null;
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  const se = 1 / Math.sqrt(n - 3);
  const lo = z - 1.96 * se,
    hi = z + 1.96 * se;
  const back = (v) => (Math.exp(2 * v) - 1) / (Math.exp(2 * v) + 1);
  return { lo: back(lo), hi: back(hi) };
}

// two-sided p for Pearson r via the t statistic, normal-approximated tail
function pValue(r, n) {
  if (r == null || n < 3) return null;
  const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  // Abramowitz & Stegun 7.1.26 erf, applied to the normal approximation of t at these n
  const erf = (v) => {
    const s = v < 0 ? -1 : 1,
      a = Math.abs(v);
    const q = 1 / (1 + 0.3275911 * a);
    const y = 1 - ((((1.061405429 * q - 1.453152027) * q + 1.421413741) * q - 0.284496736) * q + 0.254829592) * q * Math.exp(-a * a);
    return s * y;
  };
  return 1 - erf(t / Math.SQRT2);
}

const rank = (a) => {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = mid;
    i = j + 1;
  }
  return r;
};
const spearman = (x, y) => pearson(rank(x), rank(y));

/* ── selftest ─────────────────────────────────────────────────────────────── */
if (SELFTEST) {
  let bad = 0;
  const near = (l, got, want, tol) => {
    const ok = got != null && Math.abs(got - want) <= tol;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${l}: got ${got}, want ${want} ±${tol}`);
  };
  near('pearson perfect +1', pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12);
  near('pearson perfect −1', pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1, 1e-12);
  near('pearson zero on symmetric', pearson([1, 2, 3, 4, 5], [2, 1, 3, 1, 2]), 0, 0.35);
  // spearman is rank-based → a MONOTONE-but-curved relation is 1 where pearson is not
  near('spearman 1 on a monotone curve', spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1, 1e-12);
  near('pearson < 1 on that same curve', pearson([1, 2, 3, 4], [1, 4, 9, 16]), 0.984, 0.01);
  // Fisher CI must be ASYMMETRIC about r — the whole reason to use it
  const ci = fisherCI(-0.408, 39);
  near('§9 cpcHfc CI lo (published −0.641)', Math.round(ci.lo * 1000) / 1000, -0.641, 1e-9);
  near('§9 cpcHfc CI hi (published −0.106)', Math.round(ci.hi * 1000) / 1000, -0.106, 1e-9);
  near('§9 cvhrIndex CI lo (published −0.445)', Math.round(fisherCI(-0.151, 39).lo * 1000) / 1000, -0.445, 1e-9);
  console.log(bad ? `\n${bad} FAILED` : '\nall selftests pass');
  process.exit(bad ? 1 : 0);
}

/* ── the population statement ─────────────────────────────────────────────── */
/* A planted pair of snapshots, printed ALONE because `verify:verdict-adoption` parses stdout as
   JSON. The sample population MOVED on purpose: a sample showing only the stable case would not
   show the reader the one shape they have to act on. */
const snapshotOf = (nights) => ({
  ok: true,
  root: '/corpus/trio',
  reason: null,
  n: nights.length,
  nights,
  digest: null,
  maxCtimeMs: null,
  at: '2026-10-22T00:00:00Z',
  rule: '/^\\d{4}-\\d{2}-\\d{2}$/',
  ruleIsDefault: true,
  rejectedNightShaped: [],
  admittedNonNight: []
});
if (argv.includes('--verdict-sample')) {
  console.log(
    JSON.stringify(
      populationVerdict(snapshotOf(['2026-06-10', '2026-06-11', '2026-06-12']), snapshotOf(['2026-06-10', '2026-06-11']), {
        commit: null,
        at: '2026-10-22T00:00:00Z',
        tool: 'tools/ecg-apnea-correlate.mjs',
        evidence: ['tools/ecg-apnea-correlate.mjs']
      }),
      null,
      2
    )
  );
  process.exit(0);
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    /* not a checkout → commit null, and the verdict's own commitReason is then the true one */
    return null;
  }
}

/* ── corpus ───────────────────────────────────────────────────────────────── */
if (!CPAP || !existsSync(CPAP)) {
  console.error(`ecg-apnea-correlate: --cpap <exports.json> is required and must exist.\n  Generate it with:\n    node tools/cpap-corpus.mjs --root <SD-card>/DATALOG --out /tmp/cpap-exports.json\n`);
  process.exit(2);
}
if (!existsSync(DIR)) {
  console.error(`ecg-apnea-correlate: ${DIR} does not exist (run tools/trio-batch.mjs first).\n`);
  process.exit(2);
}

// device-scored residual AHI per night. cpap-corpus stamps the source day folder as `_day` (YYYYMMDD).
const cpapRaw = JSON.parse(readFileSync(CPAP, 'utf8'));
const cpapNights = Array.isArray(cpapRaw) ? cpapRaw : cpapRaw.nights || cpapRaw.exports || [];
const ahiByDate = new Map();
for (const n of cpapNights) {
  const day = n._day || (n.recording && n.recording._day);
  const m = n.metrics || {};
  const ahi = m.residualAHI != null ? m.residualAHI : n.residualAHI;
  if (!day || ahi == null) continue;
  ahiByDate.set(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, ahi);
}

/* Candidates. `hfcPct` and `cvhrIndex` are CONTROLS with published values (§9); the rest are the
   open questions. Everything in the apnea block that carries a number is included on purpose —
   testing only the favourite is how a fishing expedition looks respectable. */
const CANDIDATES = [
  { key: 'cpc.hfcPct', of: (a) => a.cpc && a.cpc.hfcPct, control: -0.408 },
  { key: 'cpc.lfcPct', of: (a) => a.cpc && a.cpc.lfcPct, control: -0.045 },
  { key: 'cpc.vlfcPct', of: (a) => a.cpc && a.cpc.vlfcPct, control: 0.356 },
  { key: 'cvhrIndex', of: (a) => a.cvhrIndex, control: -0.151 },
  { key: 'cvhrEvents', of: (a) => a.cvhrEvents },
  { key: 'surgeEscalationPct', of: (a) => a.surgeEscalationPct }
];

/* THE OFFER, UNDER THE DEFAULT NIGHT RULE. `trio-batch.mjs` writes `YYYY-MM-DD` folders, so the
   default rule is the one this tool wants and it declares none of its own. A directory the rule
   refuses could only have been dropped one line below by the ECGDex-export test anyway, so the
   scored set does not move — measured on the real root, where the rule and the hand walk offered
   the same nights. */
const snap = snapshotNights(DIR);
/* 🔴 STAMP THE CODE THAT RAN, NOT THE CODE AT THE END OF THE RUN. Reading 147 exports takes long
   enough for a commit to land in this worktree, and Node loaded this module at the start. */
const commit = gitCommit();
const paired = [];
const skipped = [];
for (const night of snap.nights) {
  const f = join(DIR, night, `ECGDex_${night}.node-export.json`);
  if (!existsSync(f)) {
    skipped.push(`${night}: no ECGDex export`);
    continue;
  }
  if (!ahiByDate.has(night)) {
    skipped.push(`${night}: no paired CPAP night`);
    continue;
  }
  let j;
  try {
    j = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    skipped.push(`${night}: unparseable (${e.message})`);
    continue;
  }
  if (!j.apnea) {
    skipped.push(`${night}: no apnea block (short/ambulatory, or folded before the rich export)`);
    continue;
  }
  paired.push({ night, ahi: ahiByDate.get(night), apnea: j.apnea });
}

const rows = CANDIDATES.map((c) => {
  const xs = [],
    ys = [];
  for (const p of paired) {
    const v = c.of(p.apnea);
    if (v == null || !isFinite(v)) continue;
    xs.push(v);
    ys.push(p.ahi);
  }
  const r = pearson(xs, ys);
  return { key: c.key, n: xs.length, r, ci: fisherCI(r, xs.length), p: pValue(r, xs.length), rho: spearman(xs, ys), control: c.control };
});

/* THE SET MAY HAVE MOVED WHILE THIS RAN, and the closing walk is what says so. Without it a
   correlation that moved because the corpus gained a night is indistinguishable from one that moved
   because a candidate changed. */
const population = populationVerdict(snap, snapshotNights(DIR), {
  commit,
  tool: 'tools/ecg-apnea-correlate.mjs',
  evidence: ['tools/ecg-apnea-correlate.mjs', 'tools/corpus-scope.mjs']
});

/* THE OTHER HALF OF THE POPULATION. The verdict above is about MOVEMENT — what arrived or left
   while the run read. It says nothing about the offered nights this run could not pair, and a count
   of them names nothing to chase, so the removals go out by name with the reason each one carries.
   The cap keeps a 147-night root readable; the `--json` form carries every one. */
function printPopulation() {
  console.log(
    `\n  population: ${population.status} — ${population.population.checked} offered night(s) the run can report over, of ${population.population.eligible} it saw${population.reason ? ` · ${population.reason}` : ''}`
  );
  const rl = ruleLine(population);
  if (rl) console.log(rl);
  console.log(`  the read paired ${paired.length} of the ${snap.n} offered under ${DIR}${snap.ok ? '' : ` · ${snap.reason}`}`);
  if (skipped.length) console.log(`  it removed ${skipped.length}, by name: ${skipped.slice(0, 8).join(' · ')}${skipped.length > 8 ? ` · … (+${skipped.length - 8})` : ''}`);
}

if (AS_JSON) {
  console.log(JSON.stringify({ dir: DIR, cpap: CPAP, nights: paired.length, skipped, rows, corpusPopulation: population }, null, 2));
  /* A RUN THAT PAIRED NOTHING IS NOT A SUCCESSFUL RUN, and the exit code is the only thing an
     unattended caller reads. 2 keeps a refusal distinct from a computed row. */
  process.exit(paired.length ? 0 : 2);
}

const f3 = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3));
if (!paired.length) {
  /* `Math.min(...[])` is `Infinity`, so the heading below used to publish `AHI Infinity–-Infinity`
     over an empty set and exit 0 — a range printed about nothing examined
     (row 2026-10-22-the-apnea-correlate-empty-run-publishes-an-infinite-ahi-range). */
  printPopulation();
  console.error(`\necg-apnea-correlate: not one of the ${snap.n} offered night(s) paired with a device-scored CPAP night, so no correlation was computed.`);
  console.log(JSON.stringify(population, null, 2));
  process.exit(2);
}
console.log(`\necg-apnea-correlate — ${paired.length} paired night(s), AHI ${Math.min(...paired.map((p) => p.ahi)).toFixed(1)}–${Math.max(...paired.map((p) => p.ahi)).toFixed(1)}`);
printPopulation();
console.log('\n  predictor'.padEnd(24) + 'n'.padEnd(5) + 'Pearson r'.padEnd(12) + '95% CI'.padEnd(22) + 'p'.padEnd(9) + 'Spearman'.padEnd(11) + 'vs §9');
for (const row of rows) {
  const ci = row.ci ? `[${f3(row.ci.lo)}, ${f3(row.ci.hi)}]` : '—';
  let ctl = '';
  if (row.control != null && row.r != null) {
    const d = Math.abs(row.r - row.control);
    ctl = d <= 0.02 ? `✓ ${row.control}` : `✕ drifted (was ${row.control})`;
  }
  console.log(`  ${row.key}`.padEnd(24) + String(row.n).padEnd(5) + f3(row.r).padEnd(12) + ci.padEnd(22) + (row.p == null ? '—' : row.p.toFixed(3)).padEnd(9) + f3(row.rho).padEnd(11) + ctl);
}
/* Bonferroni over the candidates actually tested — stated, not left for the reader to apply, because
   an unadjusted p on the best of six rows is exactly how a null result gets published as a finding. */
const k = rows.filter((r) => r.r != null).length;
console.log(`\n  Bonferroni over ${k} predictors: α = ${(0.05 / k).toFixed(4)}`);
for (const row of rows) {
  if (row.p != null && row.p < 0.05 / k) console.log(`    ${row.key} SURVIVES (p = ${row.p.toFixed(4)})`);
}
console.log('');
console.log(JSON.stringify(population, null, 2));
