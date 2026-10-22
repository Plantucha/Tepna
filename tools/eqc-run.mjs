#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * eqc-run.mjs — Extended Quadruple Collocation on the real 4-stream corpus.
 *
 * WHAT IT ANSWERS. CROSS-DOMAIN-METHODS-FOLLOWUPS §1 proves the TCH correlation
 * rho is NOT identifiable from three sources (3 pairwise variances, 4 unknowns),
 * so it must come from outside the triplet. A fourth stream is that outside
 * information. This runs Pierdicca et al.'s quadruple collocation over
 * OxyDex + ECGDex + PpgDex + the CPAP `Pulse.1s` channel.
 *
 * 🔒 PRE-REGISTERED, AND THE RULE IS NOT NEGOTIABLE AFTER SEEING THE DATA:
 *   1. REPORT THE CLASS, NEVER THE EXACT PAIR. §3.1(a) measured a structural
 *      2-fold ambiguity — exact-pair accuracy plateaus at 51.7 % at N=5000 while
 *      pair-or-complement reaches 98.3 %, because in K4 every consistency
 *      identity containing edge (a,b) also contains its disjoint edge (c,d).
 *      No sample size fixes it.
 *   2. The tie inside a class is NOT broken by "the other member is
 *      implausible": ring and ResMed SA2 are both pulse oximeters, so
 *      {ECG-Ppg, Oxy-CPAP} has two live members (§3.1b).
 *   3. A night whose CPAP clock needs a large shift to align is REJECTED, not
 *      shifted. The ResMed ran 42 min behind on 2026-07-26 and the Integrator
 *      vetoed it; a silent realignment would convert a clock fault into a
 *      correlation finding.
 *
 * METHOD. Per night, epochs are matched on ABSOLUTE floating wall-clock ms
 * (Clock Contract §1). Pairwise differences are centred PER NIGHT before pooling
 * — a constant inter-device bias is calibration, not error, and pooling it would
 * inflate every variance containing that device.
 *
 * USAGE
 *   node tools/eqc-run.mjs [--trio <dir>] [--cpap <dir>] [--maxlag 20]
 *     --selftest         known-answer checks for the collocation solver (no corpus, no I/O)
 *     --verdict-sample   the population verdict alone, for `verify:verdict-adoption`
 * ════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

import { notANight, populationVerdict, snapshotNights } from './corpus-scope.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TRIO = arg('--trio', 'uploads/trio');
const CPAP = arg('--cpap', '/run/media/michal/647A504F7A50205A/Ecg nightly/CPAP');
const MAXLAG = Number(arg('--maxlag', '4')); // in 5-min epochs => +/- 20 min

/* ── minimal EDF reader. Only what is needed: one named signal, physical units.
      Written here rather than reusing cpapdex-dsp.js because that module is a
      browser DSP with a much larger surface; this reads three fields. ──────── */
function readEdfSignal(file, wantLabel) {
  const b = fs.readFileSync(file);
  const s = (o, n) => b.toString('ascii', o, o + n).trim();
  const nRec = parseInt(s(236, 8), 10);
  const recDur = parseFloat(s(244, 8));
  const ns = parseInt(s(252, 4), 10);
  if (!(ns > 0) || !(nRec > 0)) return null;
  const labels = [];
  for (let i = 0; i < ns; i++) labels.push(s(256 + i * 16, 16));
  const idx = labels.findIndex((l) => l.toLowerCase().startsWith(wantLabel.toLowerCase()));
  if (idx < 0) return null;
  const off = 256 + ns * 16;
  const num = (base, i, w) => parseFloat(s(base + i * w, w));
  const physMin = num(off + ns * 88, idx, 8);
  const physMax = num(off + ns * 96, idx, 8);
  const digMin = num(off + ns * 104, idx, 8);
  const digMax = num(off + ns * 112, idx, 8);
  const spr = [];
  for (let i = 0; i < ns; i++) spr.push(parseInt(s(off + ns * 200 + i * 8, 8), 10));
  const hdrBytes = parseInt(s(184, 8), 10);
  const perRec = spr.reduce((a, c) => a + c, 0);
  const scale = (physMax - physMin) / (digMax - digMin);
  const before = spr.slice(0, idx).reduce((a, c) => a + c, 0);
  const out = [];
  for (let r = 0; r < nRec; r++) {
    const base = hdrBytes + r * perRec * 2 + before * 2;
    for (let k = 0; k < spr[idx]; k++) {
      const d = b.readInt16LE(base + k * 2);
      out.push((d - digMin) * scale + physMin);
    }
  }
  return { values: out, hz: spr[idx] / recDur, nRec, recDur };
}

/* Start instant from the FILENAME, by explicit regex (Clock Contract §2.4 — never
   `new Date(str)` on a vendor string). The EDF header carries dd.mm.yy, whose
   2-digit year is ambiguous; the filename carries YYYYMMDD_HHMMSS and the parent
   directory repeats the date, so the filename is both explicit and cross-checked. */
function edfStartMs(file) {
  const m = /(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)_/.exec(path.basename(file));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function variance(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
}

const PAIRS = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3]
];
const NAMES = ['ECGDex', 'PpgDex', 'OxyDex', 'CPAP'];
const pname = (p) => `${NAMES[p[0]]}–${NAMES[p[1]]}`;

function fitGivenPair(V, hypIdx) {
  const rows = [];
  const rhs = [];
  PAIRS.forEach((p, k) => {
    if (k === hypIdx) return;
    const r = [0, 0, 0, 0];
    r[p[0]] = 1;
    r[p[1]] = 1;
    rows.push(r);
    rhs.push(V[k]);
  });
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];
  for (let i = 0; i < rows.length; i++)
    for (let r = 0; r < 4; r++) {
      b[r] += rows[i][r] * rhs[i];
      for (let c = 0; c < 4; c++) A[r][c] += rows[i][r] * rows[i][c];
    }
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const s2 = [0, 1, 2, 3].map((i) => M[i][4] / M[i][i]);
  if (s2.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  let resid = 0;
  for (let i = 0; i < rows.length; i++) resid += (rows[i].reduce((s, w, j) => s + w * s2[j], 0) - rhs[i]) ** 2;
  return { s2, resid };
}

/* ── load one night ───────────────────────────────────────────────────────── */
function loadTrio(dir) {
  const out = {};
  for (const [key, pre] of [
    ['ECGDex', 'ECGDex_'],
    ['PpgDex', 'PpgDex_'],
    ['OxyDex', 'OxyDex_']
  ]) {
    const f = fs.readdirSync(dir).find((x) => x.startsWith(pre) && x.endsWith('.json'));
    if (!f) return null;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const ep = d?.timeseries?.epochs;
    const t0 = d?.recording?.startEpochMs;
    if (!Array.isArray(ep) || !Number.isFinite(t0)) return null;
    out[key] = ep.filter((e) => Number.isFinite(e?.hr) && Number.isFinite(e?.tMin)).map((e) => ({ t: t0 + e.tMin * 60000, hr: e.hr }));
  }
  return out;
}

function loadCpapEpochs(dateDir) {
  const f = fs.readdirSync(dateDir).find((x) => /SA2\.edf$/i.test(x));
  if (!f) return null;
  const full = path.join(dateDir, f);
  const sig = readEdfSignal(full, 'Pulse');
  const t0 = edfStartMs(full);
  if (!sig || !Number.isFinite(t0)) return null;
  // 1 Hz -> 5-minute means on an absolute grid, matching the trio epoch cadence
  const per = Math.round(300 * sig.hz);
  const out = [];
  for (let i = 0; i + per <= sig.values.length; i += per) {
    const w = sig.values.slice(i, i + per).filter((v) => v > 20 && v < 220);
    if (w.length > per * 0.5) out.push({ t: t0 + (i / sig.hz) * 1000, hr: mean(w) });
  }
  return out;
}

/* ── the two corpus-free entry points, AND THEY SIT ABOVE THE INPUT-PATH REFUSAL ────────────────
   Both are read where the captures are absent: `verify:verdict-adoption` parses the sample object
   from stdout and `tools/selftest-all.mjs` runs the known-answer checks, neither on a box with the
   CPAP volume mounted. The refusal below is the guard for the RUN, so it comes after them — above
   them it would refuse the two callers that have no corpus to refuse over. */
if (argv.includes('--selftest')) process.exit(selftest());

if (argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample(), null, 2));
  process.exit(0);
}

/* AN ABSENT INPUT PATH IS NOT A MEASUREMENT. The default points at a removable volume that is not
   always mounted (and is no longer where the primary checkout lives), so the common failure is that
   the directory simply is not there. Without this, this run printed "⊘ INSUFFICIENT: 0 pooled
   epoch-pairs" and exited 0 — a caller reading the exit code sees success, and the output reads as
   a finding about the data rather than about the path. Refuse with exit 2, the convention
   `tools/hostaxis-estimator-bakeoff.mjs` already uses. This is §∅ one layer out: absence must stay
   visible, never be reported as a value. */
if (!fs.existsSync(CPAP)) {
  console.error(`✗ input path does not exist: ${CPAP}\n  Pass --cpap <dir>, or mount the volume.`);
  process.exit(2);
}

/* ── main ─────────────────────────────────────────────────────────────────── */
/* THE SCORED SET IS THE SNAPSHOT THIS RUN REPORTS, never a second walk. `popBefore.nights` is the
   offer; the CPAP-existence filter below is a COVERAGE rule over that offer, not a night rule, so
   it rides `notANight` at the end rather than `snapshotNights`'s `re` — a night with no CPAP
   directory is a night this run could not score, and the triple must keep saying what MOVED. */
const popBefore = snapshotNights(TRIO);
const nights = popBefore.nights.filter((d) => fs.existsSync(path.join(CPAP, d.replace(/-/g, ''))));

console.log('Extended Quadruple Collocation — real corpus');
console.log(`  trio ${TRIO} · cpap ${CPAP}`);
console.log(`  ${popBefore.n} nights offered${popBefore.ok ? '' : ` — ${popBefore.reason}`} · ${nights.length} with both\n`);

const pooled = PAIRS.map(() => []);
const covered = [];
let used = 0;
let rejected = 0;
const rejectLog = [];

for (const night of nights) {
  const trio = loadTrio(path.join(TRIO, night));
  const cp = loadCpapEpochs(path.join(CPAP, night.replace(/-/g, '')));
  if (!trio || !cp || !cp.length) {
    rejected++;
    covered.push({ night, ok: false });
    rejectLog.push(`${night}: missing stream — trio=${trio ? 'ok' : 'NULL'} cpap=${cp ? `${cp.length} epochs` : 'NULL'}`);
    continue;
  }
  const series = [trio.ECGDex, trio.PpgDex, trio.OxyDex, cp];

  /* Align CPAP by integer epoch lag against ECG, then REFUSE a large shift.
     A big lag is a clock fault (the 2026-07-26 ResMed ran 42 min behind), and
     silently applying it would convert a clock fault into a correlation. */
  const ref = series[0];
  let bestLag = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let lag = -MAXLAG; lag <= MAXLAG; lag++) {
    const diffs = [];
    for (const e of ref) {
      const target = e.t + lag * 300000;
      const c = cp.find((x) => Math.abs(x.t - target) < 150000);
      if (c) diffs.push(e.hr - c.hr);
    }
    if (diffs.length < 20) continue;
    const v = variance(diffs);
    if (v < bestScore) {
      bestScore = v;
      bestLag = lag;
    }
  }
  if (!Number.isFinite(bestScore)) {
    rejected++;
    covered.push({ night, ok: false });
    rejectLog.push(`${night}: no overlap`);
    continue;
  }
  if (Math.abs(bestLag) >= MAXLAG) {
    rejected++;
    covered.push({ night, ok: false });
    rejectLog.push(`${night}: CPAP lag ${bestLag * 5} min hit the ±${MAXLAG * 5} min bound — clock fault, not shifted`);
    continue;
  }
  const cpAligned = cp.map((x) => ({ t: x.t - bestLag * 300000, hr: x.hr }));
  series[3] = cpAligned;

  // matched quadruples on the ECG grid
  const rows = [];
  for (const e of ref) {
    const vals = series.map((s) => {
      const c = s.find((x) => Math.abs(x.t - e.t) < 150000);
      return c ? c.hr : null;
    });
    if (vals.every((v) => Number.isFinite(v))) rows.push(vals);
  }
  if (rows.length < 20) {
    rejected++;
    covered.push({ night, ok: false });
    rejectLog.push(`${night}: only ${rows.length} matched epochs`);
    continue;
  }
  // per-night centred differences — a constant inter-device bias is calibration
  PAIRS.forEach((p, k) => {
    const d = rows.map((r) => r[p[0]] - r[p[1]]);
    const m = mean(d);
    for (const x of d) pooled[k].push(x - m);
  });
  used++;
  covered.push({ night, ok: true });
  console.log(`  ${night}  n=${String(rows.length).padStart(3)}  cpapLag=${bestLag * 5} min`);
}

console.log(`\n  used ${used} nights · rejected ${rejected}`);
for (const r of rejectLog) console.log(`    ✗ ${r}`);

/* THE POPULATION IS PUBLISHED HERE, ABOVE EVERY EXIT BELOW. The two insufficiency exits and the
   no-solution exit all leave with status 0, so a population reported after them would be reported
   on the one path that reaches the end — and the runs that need it most are the short ones. */
const population = populationVerdict(popBefore, snapshotNights(TRIO), { tool: 'tools/eqc-run.mjs' });
const unscored = notANight(popBefore, covered);
console.log(`  offered but not scored: ${unscored.length ? unscored.join(', ') : 'none'}`);
console.log(JSON.stringify(population));

const N = pooled[0].length;
if (used < 2 || N < 200) {
  console.log(`\n⊘ INSUFFICIENT: ${N} pooled epoch-pairs. Pre-registered floor is ~1000 for 86 % class accuracy.`);
  process.exit(0);
}

const V = pooled.map(variance);
console.log(`\n  pooled epoch-pairs: ${N}`);
console.log('  pairwise difference SD (bpm):');
PAIRS.forEach((p, k) => console.log(`    ${pname(p).padEnd(16)} ${Math.sqrt(V[k]).toFixed(3)}`));

const fits = PAIRS.map((p, k) => ({ k, p, f: fitGivenPair(V, k) })).filter((x) => x.f);
fits.sort((a, b) => a.f.resid - b.f.resid);
console.log('\n  hypothesis ranking (lower residual = better):');
for (const x of fits) console.log(`    ${pname(x.p).padEnd(16)} resid=${x.f.resid.toExponential(3)}`);

if (!fits.length) {
  console.log('\n⊘ no physically valid solution for any hypothesis — the single-correlated-pair model does not fit.');
  process.exit(0);
}
const best = fits[0];
const comp = [0, 1, 2, 3].filter((i) => i !== best.p[0] && i !== best.p[1]);
const compIdx = PAIRS.findIndex((q) => q[0] === comp[0] && q[1] === comp[1]);

console.log('\n🔒 PRE-REGISTERED REPORT — the CLASS, not the pair (§3.1a):');
console.log(`   correlated-error class = { ${pname(best.p)} , ${pname(PAIRS[compIdx])} }`);
console.log('   These two are NOT distinguishable by this method at any sample size.');
const s2 = best.f.s2;
console.log('\n  implied per-source SD (bpm), under the best-fitting hypothesis:');
NAMES.forEach((n, i) => console.log(`    ${n.padEnd(8)} ${Math.sqrt(Math.max(0, s2[i])).toFixed(3)}`));

/* One synthetic pair of snapshots, so the shape the gate parses needs no mounted volume. The two
   lists are identical: the sample states the STABLE case, which is the only one a sample can state
   without inventing a movement that never happened. */
function verdictSample() {
  const at = '2026-10-22T00:00:00Z';
  const snap = (nights) => ({
    ok: true,
    root: 'uploads/trio',
    reason: null,
    n: nights.length,
    nights,
    digest: null,
    maxCtimeMs: null,
    at,
    rule: String(/^\d{4}-\d{2}-\d{2}$/),
    ruleIsDefault: true,
    rejectedNightShaped: [],
    admittedNonNight: []
  });
  const sample = ['2026-06-10', '2026-06-11'];
  return populationVerdict(snap(sample), snap(sample), { tool: 'tools/eqc-run.mjs', at });
}

/* ── selftest: known answers for the solver ─────────────────────────────────────────────────────
   THE 2-FOLD AMBIGUITY IS THE TOOL'S LOAD-BEARING CLAIM, and nothing tested it. §3.1(a) of the
   brief pre-registers that an exact pair is not identifiable, so the tool reports the CLASS; the
   legs below construct a model with ONE correlated edge and measure that the edge and its disjoint
   complement fit equally well while disagreeing about the per-source variances. A tool whose
   refusal to name a pair is untested could have been refusing for a reason that stopped holding. */
function selftest() {
  let pass = 0;
  let fail = 0;
  const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;
  const ok = (name, cond, detail = '') => {
    if (cond) {
      pass++;
      console.log(`  ok   ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    }
  };

  const xs = [2, 4, 4, 4, 5, 5, 7, 9];
  ok('mean of a known list', near(mean(xs), 5));
  ok('variance is the SAMPLE form (n-1)', near(variance(xs), 32 / 7), String(variance(xs)));
  ok('variance of one sample is not a number', Number.isNaN(variance([3])));

  /* The uncorrelated model: every pairwise difference variance is the sum of the two source
     variances. Five of the six equations identify four unknowns exactly. */
  const s2 = [1, 2, 3, 4];
  const clean = PAIRS.map(([a, b]) => s2[a] + s2[b]);
  const fitClean = fitGivenPair(clean, 0);
  ok('a clean model recovers every source variance', fitClean && fitClean.s2.every((v, i) => near(v, s2[i])), JSON.stringify(fitClean));
  ok('and leaves no residual', fitClean && near(fitClean.resid, 0, 1e-18));

  /* One correlated edge, ECGDex–PpgDex, with covariance 0.5: its difference variance drops by 2c
     and every other equation is untouched. */
  const corr = PAIRS.map(([a, b]) => s2[a] + s2[b]);
  corr[0] -= 2 * 0.5;
  const fits = PAIRS.map((p, k) => fitGivenPair(corr, k));
  const compIdx = PAIRS.findIndex((q) => q[0] === 2 && q[1] === 3);
  ok('the correlated edge fits with no residual', fits[0] && near(fits[0].resid, 0, 1e-18));
  ok('and so does its disjoint complement — the 2-fold ambiguity, §3.1(a)', fits[compIdx] && near(fits[compIdx].resid, 0, 1e-18));
  ok(
    'every hypothesis outside that class carries a residual',
    PAIRS.every((p, k) => k === 0 || k === compIdx || (fits[k] && fits[k].resid > 1e-6)),
    fits.map((f) => (f ? f.resid.toExponential(2) : 'null')).join(' ')
  );
  ok(
    'the two class members disagree about the per-source variances',
    fits[0] && fits[compIdx] && fits[0].s2.some((v, i) => !near(v, fits[compIdx].s2[i], 1e-6)),
    'a method that cannot name the pair cannot publish one member\u2019s SDs as THE answer'
  );

  /* A fit whose solution is not strictly positive is not a variance. The refusal is the §∅ line:
     an impossible solution must come back absent, never as a number in range. */
  ok('a degenerate system refuses instead of returning a non-positive variance', fitGivenPair([0, 0, 0, 0, 0, 0], 0) === null);

  console.log(fail ? `\n${fail} of ${pass + fail} selftests FAILED` : `\nall ${pass} selftests passed`);
  return fail ? 1 : 0;
}
