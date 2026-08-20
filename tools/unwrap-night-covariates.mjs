#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * unwrap-night-covariates.mjs — JOINT-UNWRAP-ATTEMPT-FOLLOWUPS §3's one open item
 * ------------------------------------------------------------------------------------------------
 * THE QUESTION, restated from the brief: *what distinguishes a lockable night from an un-lockable
 * one?* Its §2 is emphatic about what this must NOT be — the apparatus already sweeps, and sweeping
 * does not separate the populations. Four retractions in this brief family came from tuning a knob
 * and reading the best cell. So this starts from a **per-night covariate**, measured against the
 * existing per-night robust scatter, and never from another parameter grid.
 *
 * WHY THIS IS A DIFFERENT MEASUREMENT FROM ITS SIBLING. `integrator-block-precision.mjs` sweeps
 * blockMs and asks "can the estimator do better?". This holds the estimator FIXED at one block
 * length and asks "which nights does it work on, and do they have anything in common?". The scatter
 * is an input here, not the endpoint.
 *
 * ── THE COVARIATES ARE THE ONES THE BRIEF NAMED, NOT A FISHING SET ───────────────────────────────
 * §1 names four: slip rate, coverage, posture, and a period where one device was not on the body.
 * Each is read from a field the nodes ALREADY publish, so nothing here re-derives a signal:
 *
 *   slip rate     PpgDex `quality.correctionRatePct` · per-beat `corrected` fraction on both legs
 *   coverage      `quality.coveragePct` / `analyzablePct` on both legs, plus measured overlap
 *   posture       ECGDex `epochs[].position` — changes per hour, and the supine fraction
 *   off-body      PpgDex `quality.motionRejectedPct`, the largest inter-beat gap, and gap fraction
 *
 * Two more are included because they are free and they are the mechanism CLAUDE.md §7 warns about:
 * `axisQuantizedShare` and `ledAgreementPct`. A night whose PPG axis was DRAWN rather than measured
 * cannot carry an independent phase, which is a *predictive* property available before any fit.
 *
 * ── WHAT IS REPORTED, AND WHY IT IS NOT A CORRELATION ────────────────────────────────────────────
 * The brief demands "an error bar, on both populations, not a point estimate from the better half".
 * So every covariate gets THREE numbers, none of which can be read off the lockable half alone:
 *
 *   1. Spearman rho against the continuous scatter, with a PERCENTILE BOOTSTRAP CI. Rank-based
 *      because the scatter is bimodal and a Pearson r on two clusters reports the gap between the
 *      clusters, not an association within them.
 *   2. AUC (probability of superiority) between the lockable and un-lockable populations, with the
 *      same bootstrap. AUC is the direct form of the question "does this covariate SEPARATE them",
 *      and 0.5 is its null. A CI that spans 0.5 is a covariate that does not separate — which is a
 *      publishable answer here, per §3's second bullet.
 *   3. The per-population medians and n, printed side by side, so the reader sees both halves.
 *
 * ⚠️ MULTIPLICITY IS CORRECTED, because ten covariates against one endpoint will hand you a winner
 * by chance. Holm over the bootstrap two-sided p-values. An uncorrected "significant" covariate is
 * reported with its adjusted value beside it and is NOT called a separator.
 *
 * ⚠️ NO UNWRAP IS SHIPPED HERE, and none is proposed — §4 of the brief puts that out of scope until
 * a night can be classified BEFORE the fit. This tool only measures whether that is possible.
 *
 * DETERMINISM: the bootstrap uses a seeded mulberry32, never `Math.random`. A resampling CI that
 * moves between runs cannot be gated, and this repo's tool selftests are gates.
 *
 * USAGE
 *   node tools/unwrap-night-covariates.mjs --dir uploads/trio [--block 900] [--split 450]
 *   node tools/unwrap-night-covariates.mjs --dir uploads/trio --json /tmp/cov.json
 *   node tools/unwrap-night-covariates.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { median, quantile } from './ppi-match.mjs';
import { lineResiduals, robustSigma } from './block-scatter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const BLOCK_SEC = +opt('--block', 900);
const SPLIT_MS = +opt('--split', 450); // the brief's own bar, not a tuned cut
const BOOT = +opt('--boot', 4000);
const SEED = +opt('--seed', 20260820);
const JSON_OUT = opt('--json', null);

/* ══════════════════════════════════════════ STATISTICS ═════════════════════════════════════════ */

/* Seeded PRNG. A bootstrap CI that changes between runs is not a gateable number. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Fractional ranks, ties averaged. Ties matter here: several covariates are percentages that
   saturate at 100 on most nights, and giving them distinct ranks would fabricate an ordering. */
export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(x, y) {
  const n = x.length;
  if (n < 3 || y.length !== n) return null;
  const rx = ranks(x),
    ry = ranks(y);
  const mx = rx.reduce((a, b) => a + b, 0) / n,
    my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx,
      b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

/* Probability that a random member of `pos` exceeds a random member of `neg`, ties counted as half.
   This is the Mann-Whitney U statistic normalised — the direct "does it separate" measure, whose
   null is 0.5 rather than 0. */
export function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/* Percentile bootstrap CI for any statistic of paired samples. Resamples NIGHTS (the independent
   unit), never beats — beats within a night are not exchangeable. */
export function bootCI(stat, n, draw, { boot = 4000, seed = 1, alpha = 0.05 } = {}) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let b = 0; b < boot; b++) {
    const pick = new Array(n);
    for (let i = 0; i < n; i++) pick[i] = Math.floor(rnd() * n);
    const v = stat(draw(pick));
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  if (out.length < boot * 0.5) return null;
  out.sort((a, b) => a - b);
  return { lo: quantile(out, alpha / 2), hi: quantile(out, 1 - alpha / 2), n: out.length, dist: out };
}

/* Two-sided bootstrap p-value against a null value: twice the smaller tail mass. Floored at 1/boot
   because a bootstrap cannot resolve below its own resolution — reporting p=0 from 4000 resamples
   would be a precision this method does not have. */
export function bootP(dist, null0) {
  if (!dist || !dist.length) return null;
  const below = dist.filter((v) => v < null0).length;
  const above = dist.filter((v) => v > null0).length;
  return Math.max((2 * Math.min(below, above)) / dist.length, 1 / dist.length);
}

/* Holm-Bonferroni. Ten covariates against one endpoint WILL yield a winner by chance; this is the
   correction that decides whether the winner survives. Returns adjusted p in the input order. */
export function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(ps.length);
  let running = 0;
  for (let k = 0; k < order.length; k++) {
    const [p, i] = order[k];
    running = Math.max(running, Math.min(1, p * (ps.length - k)));
    adj[i] = running;
  }
  return adj;
}

/* ══════════════════════════════════════════ SELFTEST ═══════════════════════════════════════════ */
function selftest() {
  let fail = 0;
  let n = 0;
  /* The count is printed in the form `tools/selftest-all.mjs` parses (`all N selftests passed`), not
     a bare `all green`. That runner exists to make a tool silently dropping from 18 assertions to 3
     visible; a summary it cannot parse reports the tool as green with no count, which is the same
     blind spot one level up. */
  const ok = (c, m) => {
    n++;
    console.log((c ? '  ok   ' : '  FAIL ') + m);
    if (!c) fail++;
  };

  ok(Math.abs(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) - 1) < 1e-12, 'spearman is 1 on a monotone pair');
  ok(Math.abs(spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]) + 1) < 1e-12, '…and -1 when reversed');
  ok(Math.abs(spearman([1, 2, 3, 4], [1, 1, 1, 1])) === 0 || spearman([1, 2, 3, 4], [1, 1, 1, 1]) === null, 'a constant covariate yields no rho rather than a spurious one');
  /* Ties averaged, not broken: [1,1,2] must rank as [1.5,1.5,3]. Breaking ties by index would make a
     saturated percentage look like an ordering. */
  ok(JSON.stringify(ranks([1, 1, 2])) === JSON.stringify([1.5, 1.5, 3]), 'ranks average ties');
  ok(Math.abs(spearman([1, 2, 3, 4, 5, 6], [1, 3, 2, 5, 4, 6]) - 0.8857) < 1e-3, 'spearman matches a hand-computed value on a rank-swapped pair');

  ok(auc([3, 4, 5], [0, 1, 2]) === 1, 'AUC is 1 for perfectly separated populations');
  ok(auc([0, 1, 2], [3, 4, 5]) === 0, '…and 0 when reversed');
  ok(auc([1, 2, 3], [1, 2, 3]) === 0.5, '…and exactly 0.5 for identical populations');
  ok(auc([1, 1], [1, 1]) === 0.5, '…ties counted as half');

  /* The bootstrap must be REPRODUCIBLE and must bracket a planted association. */
  const x = [],
    y = [];
  for (let i = 0; i < 40; i++) {
    x.push(i);
    y.push(i * 2 + (i % 3)); // strongly monotone with a little wobble
  }
  const drawXY = (pick) => [pick.map((i) => x[i]), pick.map((i) => y[i])];
  const c1 = bootCI(([a, b]) => spearman(a, b), 40, drawXY, { boot: 500, seed: 7 });
  const c2 = bootCI(([a, b]) => spearman(a, b), 40, drawXY, { boot: 500, seed: 7 });
  ok(c1 && c2 && c1.lo === c2.lo && c1.hi === c2.hi, 'the same seed gives the identical CI (a resampling gate must be deterministic)');
  ok(c1 && c1.lo > 0, 'a planted monotone association has a CI excluding 0');

  /* …and a covariate with NO association must NOT be called a separator. This is the direction that
     matters: the brief's acceptable outcome is "none of the named candidates does". */
  const rnd = mulberry32(99);
  const noise = x.map(() => rnd());
  const drawN = (pick) => [pick.map((i) => noise[i]), pick.map((i) => y[i])];
  const c3 = bootCI(([a, b]) => spearman(a, b), 40, drawN, { boot: 800, seed: 11 });
  ok(c3 && c3.lo < 0 && c3.hi > 0, 'an unrelated covariate yields a CI spanning 0');
  ok(bootP(c3.dist, 0) > 0.05, '…and a non-significant bootstrap p');
  ok(bootP([1, 1, 1, 1], 0) === 1 / 4, 'bootP floors at 1/boot rather than reporting 0');

  const h = holm([0.01, 0.04, 0.03]);
  ok(Math.abs(h[0] - 0.03) < 1e-12, 'holm scales the smallest p by m');
  ok(h[1] >= h[2], 'holm is monotone in the sorted order');
  ok(
    holm([0.5, 0.5]).every((v) => v <= 1),
    'holm never exceeds 1'
  );

  /* robustSigma/lineResiduals are imported, so assert the seam rather than re-testing them. */
  ok(typeof robustSigma === 'function' && typeof lineResiduals === 'function', 'the scatter primitives are imported from block-scatter.mjs, not re-implemented');

  console.log(fail ? `\nselftest: ${fail} FAILURE(S) of ${n}` : `\nselftest: all ${n} selftests passed`);
  return fail;
}

if (SELFTEST) process.exit(selftest() ? 1 : 0);
if (!DIR) {
  console.error('need --dir <trio-dir>  (or --selftest)');
  process.exit(2);
}

/* ═══════════════════════════════════════════ CORPUS RUN ════════════════════════════════════════ */
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const I = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'integrator-dsp.js']).IntegratorDSP;
if (!I || typeof I.fitClockDrift !== 'function') {
  console.error('IntegratorDSP.fitClockDrift unavailable');
  process.exit(2);
}

function loadNode(dir, node) {
  try {
    const f = readdirSync(join(DIR, dir)).find((x) => x.startsWith(`${node}_`) && x.endsWith('.json'));
    if (!f) return null;
    return JSON.parse(readFileSync(join(DIR, dir, f), 'utf8'));
  } catch {
    return null;
  }
}
const beatMs = (j, key) => {
  const t0 = j?.recording?.startEpochMs;
  const ts = j?.timeseries?.[key]?.tSec;
  return t0 == null || !ts || ts.length < 500 ? null : ts.map((s) => t0 + s * 1000);
};

/* Largest inter-beat gap and the fraction of the record inside a gap > 5 s. The brief's "a period
   where one device simply was not on the body" has no field of its own; this is the observable it
   leaves behind. 5 s is ~7 missed beats — long enough that no single dropped beat qualifies. */
function gapStats(ms) {
  if (!ms || ms.length < 2) return { maxGapSec: null, gapFrac: null };
  let maxG = 0,
    inGap = 0;
  for (let i = 1; i < ms.length; i++) {
    const d = ms[i] - ms[i - 1];
    if (d > maxG) maxG = d;
    if (d > 5000) inGap += d;
  }
  const span = ms[ms.length - 1] - ms[0];
  return { maxGapSec: maxG / 1000, gapFrac: span > 0 ? (100 * inGap) / span : null };
}

/* Posture from the epochs the node already publishes. Changes-per-hour rather than a raw count, so
   a long night does not read as restless purely for being long. */
function postureStats(j) {
  const ep = j?.timeseries?.epochs;
  if (!Array.isArray(ep) || ep.length < 3) return { posChangesPerHr: null, supinePct: null, motionMed: null };
  const pos = ep.map((e) => e.position).filter((p) => typeof p === 'string');
  let changes = 0;
  for (let i = 1; i < pos.length; i++) if (pos[i] !== pos[i - 1]) changes++;
  const hours = ep.length > 1 ? (ep[ep.length - 1].tMin - ep[0].tMin) / 60 : 0;
  const mot = ep.map((e) => e.motionIndex).filter((v) => typeof v === 'number');
  return {
    posChangesPerHr: hours > 0 && pos.length ? changes / hours : null,
    supinePct: pos.length ? (100 * pos.filter((p) => p === 'supine').length) / pos.length : null,
    motionMed: mot.length ? median(mot.slice().sort((a, b) => a - b)) : null
  };
}

const correctedFrac = (j, key) => {
  const c = j?.timeseries?.[key]?.corrected;
  return Array.isArray(c) && c.length ? (100 * c.reduce((a, b) => a + (b ? 1 : 0), 0)) / c.length : null;
};

/* Per-night robust scatter at ONE block length — the estimator held fixed, per §2. */
function scatterOf(A, Bt) {
  let r = null;
  try {
    r = I.fitClockDrift(A, Bt, { blockMs: BLOCK_SEC * 1000 });
  } catch {
    return null;
  }
  if (!r || !Array.isArray(r.perBlock) || r.perBlock.length < 5) return null;
  const lr = lineResiduals(
    r.perBlock.map((b) => b.tMs),
    r.perBlock.map((b) => b.off)
  );
  if (!lr) return null;
  return {
    scatter: robustSigma(lr.res.slice().sort((a, b) => a - b)),
    blocks: r.perBlock.length,
    ppm: r.driftPpm,
    conc: r.wrappedConcentration ?? null
  };
}

const nights = readdirSync(DIR)
  .filter((d) => {
    try {
      return statSync(join(DIR, d)).isDirectory();
    } catch {
      return false;
    }
  })
  .sort();

console.log('JOINT-UNWRAP-ATTEMPT-FOLLOWUPS §3 — what distinguishes a lockable night from an un-lockable one?');
console.log(`block ${BLOCK_SEC} s (estimator FIXED — this is not a sweep) · split at ${SPLIT_MS} ms · ${BOOT} bootstrap resamples · seed ${SEED}\n`);

const rows = [];
for (const n of nights) {
  const E = loadNode(n, 'ECGDex');
  const P = loadNode(n, 'PpgDex');
  if (!E || !P) continue;
  const A = beatMs(E, 'rr'),
    Bt = beatMs(P, 'ppi');
  if (!A || !Bt) continue;
  const s = scatterOf(A, Bt);
  if (!s || s.scatter == null) continue;

  const gE = gapStats(A),
    gP = gapStats(Bt);
  const post = postureStats(E);
  rows.push({
    night: n,
    scatter: s.scatter,
    blocks: s.blocks,
    ppm: s.ppm,
    conc: s.conc,
    cov: {
      slipPpgPct: P.quality?.correctionRatePct ?? correctedFrac(P, 'ppi'),
      slipEcgPct: correctedFrac(E, 'rr'),
      coveragePpgPct: P.quality?.coveragePct ?? null,
      coverageEcgPct: E.quality?.coveragePct ?? null,
      analyzablePpgPct: P.quality?.analyzablePct ?? null,
      motionRejectedPct: P.quality?.motionRejectedPct ?? null,
      ledAgreementPct: P.quality?.ledAgreementPct ?? null,
      axisQuantizedShare: P.quality?.axisQuantizedShare ?? null,
      maxGapPpgSec: gP.maxGapSec,
      gapFracPpgPct: gP.gapFrac,
      maxGapEcgSec: gE.maxGapSec,
      posChangesPerHr: post.posChangesPerHr,
      supinePct: post.supinePct,
      motionMed: post.motionMed
    }
  });
  console.log(`  ${n}  scatter ${s.scatter.toFixed(0).padStart(5)} ms  (${String(s.blocks).padStart(3)} blocks, ${s.ppm == null ? 'n/a' : s.ppm.toFixed(1)} ppm)`);
}

if (rows.length < 6) {
  console.log(`\nonly ${rows.length} night(s) scored — too few to test a covariate. Not reporting one.`);
  process.exit(0);
}

/* ══════════════════════════════════ THE TWO POPULATIONS ════════════════════════════════════════ */
const scat = rows.map((r) => r.scatter);
const lock = rows.filter((r) => r.scatter < SPLIT_MS);
const unlock = rows.filter((r) => r.scatter >= SPLIT_MS);
const srt = (a) => a.slice().sort((x, y) => x - y);

console.log(`\n${rows.length} night(s) scored`);
console.log(
  `  scatter    median ${median(srt(scat)).toFixed(0)} ms   IQR ${quantile(srt(scat), 0.25).toFixed(0)}–${quantile(srt(scat), 0.75).toFixed(0)}   range ${Math.min(...scat).toFixed(0)}–${Math.max(...scat).toFixed(0)}`
);
console.log(`  lockable   (< ${SPLIT_MS} ms)  n = ${lock.length}${lock.length ? `   median ${median(srt(lock.map((r) => r.scatter))).toFixed(0)} ms` : ''}`);
console.log(`  un-lockable(≥ ${SPLIT_MS} ms)  n = ${unlock.length}${unlock.length ? `   median ${median(srt(unlock.map((r) => r.scatter))).toFixed(0)} ms` : ''}`);

if (!lock.length || !unlock.length) {
  console.log('\n⚠️  ONE POPULATION ONLY at this split — there is no separation question to ask.');
  console.log('    Reporting the rho column alone; the AUC column would compare a set against nothing.');
}

const KEYS = Object.keys(rows[0].cov);
const results = [];
for (const k of KEYS) {
  const have = rows.filter((r) => typeof r.cov[k] === 'number' && Number.isFinite(r.cov[k]));
  if (have.length < 6) {
    results.push({ key: k, n: have.length, skip: 'not measured on enough nights' });
    continue;
  }
  const xs = have.map((r) => r.cov[k]);
  const ys = have.map((r) => r.scatter);
  const uniq = new Set(xs).size;
  if (uniq < 3) {
    results.push({ key: k, n: have.length, skip: `constant across nights (${uniq} distinct value(s))` });
    continue;
  }

  const rho = spearman(xs, ys);
  const rhoCI = bootCI(
    ([a, b]) => spearman(a, b),
    have.length,
    (pick) => [pick.map((i) => xs[i]), pick.map((i) => ys[i])],
    { boot: BOOT, seed: SEED }
  );

  let aucV = null,
    aucCI = null;
  if (lock.length >= 3 && unlock.length >= 3) {
    const lv = have.filter((r) => r.scatter < SPLIT_MS).map((r) => r.cov[k]);
    const uv = have.filter((r) => r.scatter >= SPLIT_MS).map((r) => r.cov[k]);
    if (lv.length >= 3 && uv.length >= 3) {
      aucV = auc(uv, lv); // >0.5 ⇒ the covariate runs HIGH on un-lockable nights
      /* Resample each population independently — a pooled resample would sometimes empty one. */
      const rnd = mulberry32(SEED ^ 0x5f5f);
      const dist = [];
      for (let b = 0; b < BOOT; b++) {
        const su = Array.from({ length: uv.length }, () => uv[Math.floor(rnd() * uv.length)]);
        const sl = Array.from({ length: lv.length }, () => lv[Math.floor(rnd() * lv.length)]);
        const v = auc(su, sl);
        if (v != null) dist.push(v);
      }
      dist.sort((a, b) => a - b);
      aucCI = { lo: quantile(dist, 0.025), hi: quantile(dist, 0.975), dist };
    }
  }

  results.push({
    key: k,
    n: have.length,
    rho,
    rhoCI: rhoCI ? { lo: rhoCI.lo, hi: rhoCI.hi } : null,
    rhoP: rhoCI ? bootP(rhoCI.dist, 0) : null,
    auc: aucV,
    aucCI: aucCI ? { lo: aucCI.lo, hi: aucCI.hi } : null,
    aucP: aucCI ? bootP(aucCI.dist, 0.5) : null,
    medLock: lock.length ? median(srt(have.filter((r) => r.scatter < SPLIT_MS).map((r) => r.cov[k]))) : null,
    medUnlock: unlock.length ? median(srt(have.filter((r) => r.scatter >= SPLIT_MS).map((r) => r.cov[k]))) : null
  });
}

/* Holm across the covariates that actually produced a p — the family is the tested set, not the
   named set, and correcting over skipped rows would be a free discount. */
const tested = results.filter((r) => r.rhoP != null);
const adjRho = holm(tested.map((r) => r.rhoP));
tested.forEach((r, i) => {
  r.rhoPAdj = adjRho[i];
});
const testedA = results.filter((r) => r.aucP != null);
const adjAuc = holm(testedA.map((r) => r.aucP));
testedA.forEach((r, i) => {
  r.aucPAdj = adjAuc[i];
});

const f3 = (v) => (v == null ? '  n/a' : (v >= 0 ? ' ' : '') + v.toFixed(2));
const fp = (v) => (v == null ? ' n/a ' : v < 0.001 ? '<.001' : v.toFixed(3));
console.log(`\n  covariate              n    rho  [95% CI]        p    p(Holm)     AUC  [95% CI]        p    p(Holm)   med(lock) med(unlock)`);
console.log(`  ${'─'.repeat(120)}`);
for (const r of results) {
  if (r.skip) {
    console.log(`  ${r.key.padEnd(20)} ${String(r.n).padStart(3)}   — ${r.skip}`);
    continue;
  }
  const ci = r.rhoCI ? `[${f3(r.rhoCI.lo)},${f3(r.rhoCI.hi)}]` : '     n/a     ';
  const aci = r.aucCI ? `[${f3(r.aucCI.lo)},${f3(r.aucCI.hi)}]` : '     n/a     ';
  console.log(
    `  ${r.key.padEnd(20)} ${String(r.n).padStart(3)}  ${f3(r.rho)} ${ci}  ${fp(r.rhoP)}  ${fp(r.rhoPAdj)}   ${f3(r.auc)} ${aci}  ${fp(r.aucP)}  ${fp(r.aucPAdj)}   ` +
      `${r.medLock == null ? '   n/a' : r.medLock.toFixed(2).padStart(7)} ${r.medUnlock == null ? '   n/a' : r.medUnlock.toFixed(2).padStart(9)}`
  );
}

/* ═════════════════════════════════════════ THE VERDICT ═════════════════════════════════════════ */
const separators = results.filter((r) => !r.skip && r.aucCI && r.aucPAdj != null && r.aucPAdj < 0.05 && (r.aucCI.lo > 0.5 || r.aucCI.hi < 0.5));
const associated = results.filter((r) => !r.skip && r.rhoCI && r.rhoPAdj != null && r.rhoPAdj < 0.05 && (r.rhoCI.lo > 0 || r.rhoCI.hi < 0));

console.log(`\n  VERDICT (Holm-adjusted across ${tested.length} tested covariate(s))`);
if (separators.length) {
  console.log(`  ${separators.length} covariate(s) SEPARATE the two populations with an AUC CI excluding 0.5:`);
  for (const r of separators) console.log(`    · ${r.key}  AUC ${r.auc.toFixed(2)} [${r.aucCI.lo.toFixed(2)}, ${r.aucCI.hi.toFixed(2)}]  p(Holm) ${fp(r.aucPAdj)}`);
  console.log('  That is a precondition the unwrap could CHECK before fitting — §3 bullet 2, positive branch.');
} else {
  console.log('  NO covariate separates the populations after correction. §3 bullet 2, negative branch:');
  console.log('  the named candidates (slip rate, coverage, posture, off-body period) do not classify a');
  console.log('  night in advance, so no unwrap can be gated on them.');
}
if (associated.length && !separators.length) {
  console.log(`  (${associated.length} covariate(s) show a rank association with the continuous scatter but do not`);
  console.log('   separate the populations — an association within a cluster is not a classifier.)');
}
console.log('\n  NO UNWRAP IS PROPOSED HERE — §4 puts that out of scope until a night can be classified before the fit.');

if (JSON_OUT) {
  writeFileSync(JSON_OUT, `${JSON.stringify({ blockSec: BLOCK_SEC, splitMs: SPLIT_MS, boot: BOOT, seed: SEED, nights: rows, results }, null, 2)}\n`);
  console.log(`\n  wrote ${JSON_OUT}`);
}
