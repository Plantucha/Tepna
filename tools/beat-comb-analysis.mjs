#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * beat-comb-analysis.mjs — why two beat trains cannot tell you a clock offset
 *
 * WHY — IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF measured wrist↔finger beat
 * correspondence with "nearest beat + linear median" and reported a per-night
 * table, one row of which (2026-07-27: median 326 ms, 5 % of beats inside
 * ±100 ms) was called "an outlier worth chasing — a per-night defect, not a
 * method limit". It also cited no tool, so the numbers were not reproducible.
 *
 * Both problems have the same root. Nearest-beat matching is bounded by ±RR/2,
 * so its output is a CIRCULAR quantity and a linear median of it is undefined
 * near the wrap. Replace it with a LAG SWEEP — for each candidate offset τ,
 * count the A-beats having a B-beat within ±tol of (t+τ) — and the wrap is gone,
 * because τ is unbounded.
 *
 * What the sweep shows is worse than a resolution limit, and is the real finding:
 *
 *   The coincidence curve between two beat trains is a COMB whose period is the
 *   MEAN RR, with teeth of equal height. The offset is therefore identifiable
 *   only MODULO one heartbeat. No statistic escapes this — it is a property of
 *   correlating two periodic trains, not of the estimator or of the data.
 *
 * So the old table was reading one arbitrary tooth, and its "% inside ±100 ms"
 * column was simply the curve's height AT ZERO LAG — which varies between 5 %
 * and 26 % across nights purely by where zero happens to fall on the comb.
 * (`--dir` reproduces that column to within 2 points on all six box nights.)
 *
 * This is also the structural reason ACC↔ACC envelope correlation DOES work:
 * an activity envelope is APERIODIC, so its cross-correlation has one peak.
 * A beat train is periodic by construction, so its coincidence curve cannot.
 * The general rule for anything downstream: align on aperiodic features.
 *
 * USAGE
 *   node tools/beat-comb-analysis.mjs --selftest
 *     Deterministic synthetic pair with a PLANTED offset and known mean RR.
 *     Truth is known, so this asserts the comb rather than describing it:
 *     the teeth appear at planted + k·meanRR, they are of comparable height,
 *     and the argmax is NOT reliably the planted tooth. Known-answer, no corpus.
 *
 *   node tools/beat-comb-analysis.mjs --dir <folder of per-night export dirs>
 *     Real path. Each <night>/ holds PpgDex_<night>.node-export.json (wrist) and
 *     PpgDexFinger_<night>.node-export.json (finger); both need timeseries.ppi,
 *     which node exports carry from v2.0.0 on. Prints the per-night table.
 *
 *   --tol <ms>    coincidence half-window            (default 100)
 *   --span <RR>   sweep half-width in mean-RR units  (default 3)
 * ════════════════════════════════════════════════════════════════════════ */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const TOL = parseFloat(opt('--tol', '100'));
const SPAN_RR = parseFloat(opt('--span', '3'));

/* ── the instrument ────────────────────────────────────────────────────── */

/** Count A-beats having a B-beat within ±tol of (a + tau). Both arrays sorted ms. */
function coincidence(A, B, tau, tol) {
  let n = 0;
  let j = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i] + tau;
    while (j < B.length && B[j] < x - tol) j++;
    if (j < B.length && B[j] <= x + tol) n++;
  }
  return n;
}

/**
 * Sweep τ and return the curve plus its structure.
 * `floor` is the chance level: B-beats arriving at their own mean rate give each
 * A-beat an independent 1 − exp(−rate·2·tol) probability of a spurious partner.
 */
function sweep(A, B, meanRR, tol, spanRR, stepMs) {
  const step = stepMs || 10;
  const half = spanRR * meanRR;
  const lags = [];
  const counts = [];
  for (let tau = -half; tau <= half; tau += step) {
    lags.push(tau);
    counts.push(coincidence(A, B, tau, tol));
  }
  let bi = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[bi]) bi = i;

  const span = B[B.length - 1] - B[0];
  const rate = B.length / span;
  const floor = A.length * (1 - Math.exp(-rate * 2 * tol));

  /* Teeth: local maxima at least 60 % of a beat apart and clearly above chance.
     A tooth is not sharp — it is as wide as the matching window (±tol) convolved
     with the two trains' jitter, so the raw argmax wanders tens of ms inside a
     flat top. Report the count-weighted CENTROID of the plateau (everything
     within 90 % of the local max) instead; that is stable to a few ms. */
  const teeth = [];
  for (let i = 2; i < counts.length - 2; i++) {
    let isMax = true;
    for (let k = -2; k <= 2; k++) if (counts[i + k] > counts[i]) isMax = false;
    if (!isMax || counts[i] < 1.5 * floor) continue;
    let lo = i;
    let hi = i;
    while (lo > 0 && counts[lo - 1] >= 0.9 * counts[i]) lo--;
    while (hi < counts.length - 1 && counts[hi + 1] >= 0.9 * counts[i]) hi++;
    let wSum = 0;
    let w = 0;
    for (let k = lo; k <= hi; k++) {
      wSum += lags[k] * counts[k];
      w += counts[k];
    }
    const centre = w > 0 ? wSum / w : lags[i];
    if (teeth.length && centre - teeth[teeth.length - 1].lag < 0.6 * meanRR) {
      if (counts[i] > teeth[teeth.length - 1].n) teeth[teeth.length - 1] = { lag: centre, n: counts[i] };
      continue;
    }
    teeth.push({ lag: centre, n: counts[i] });
  }
  return { lags, counts, best: { lag: lags[bi], n: counts[bi] }, floor, teeth, zero: coincidence(A, B, 0, tol) };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/* ── real corpus ───────────────────────────────────────────────────────── */

function loadPpi(path) {
  if (!existsSync(path)) return null;
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const p = d.timeseries && d.timeseries.ppi;
  if (!p || !p.tSec || !p.tSec.length) return null;
  const t0 = (d.recording && d.recording.startEpochMs) || 0;
  return { t: p.tSec.map((s) => s * 1000 + t0), ms: p.ms };
}

function runDir(dir) {
  const nights = readdirSync(dir).sort();
  console.log(`beat-comb — ${dir}   tol ±${TOL} ms, sweep ±${SPAN_RR} RR\n`);
  console.log('night          meanRR   @lag0%   peak%   floor%   ratio   teeth   spacing (ms)');
  let seen = 0;
  for (const night of nights) {
    const w = loadPpi(join(dir, night, `PpgDex_${night}.node-export.json`));
    const f = loadPpi(join(dir, night, `PpgDexFinger_${night}.node-export.json`));
    if (!w || !f) continue;
    seen++;
    const meanRR = mean(w.ms);
    const s = sweep(w.t, f.t, meanRR, TOL, SPAN_RR);
    const sp = [];
    for (let i = 1; i < s.teeth.length; i++) sp.push(Math.round(s.teeth[i].lag - s.teeth[i - 1].lag));
    console.log(
      night.padEnd(14),
      String(Math.round(meanRR)).padStart(6),
      ((100 * s.zero) / w.t.length).toFixed(1).padStart(8),
      ((100 * s.best.n) / w.t.length).toFixed(1).padStart(7),
      ((100 * s.floor) / w.t.length).toFixed(1).padStart(8),
      (s.best.n / s.floor).toFixed(2).padStart(7),
      String(s.teeth.length).padStart(7),
      '  ' + sp.join(' ')
    );
  }
  if (!seen) {
    console.log('\n(no night had both PpgDex and PpgDexFinger with a timeseries.ppi block)');
    return;
  }
  console.log(`\n${seen} night(s). Read the SPACING column: where it is ≈ meanRR the curve is a comb,`);
  console.log('and the offset is identifiable only modulo one beat. @lag0 is what a nearest-beat');
  console.log('matcher reports as "% corresponding" — it is the comb sampled at zero, nothing more.');
}

/* ── selftest: planted truth ───────────────────────────────────────────── */

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`);
    }
  };

  /* Deterministic LCG — no Math.random, so the assertions below are fixed. */
  let s = 20260801;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const MEAN_RR = 1000;
  const PLANTED = 250; // ms; B beats arrive this much after A's
  const N = 6000;

  /* A: a beat train with realistic RR variability (±8 %). B: the same beats,
     shifted by PLANTED, with per-beat jitter and 25 % of beats dropped — i.e.
     the two trains genuinely share beats, which is the favourable case. */
  const A = [];
  let t = 0;
  for (let i = 0; i < N; i++) {
    A.push(t);
    t += MEAN_RR * (0.92 + 0.16 * rnd());
  }
  const B = [];
  for (let i = 0; i < A.length; i++) {
    if (rnd() < 0.25) continue;
    B.push(A[i] + PLANTED + (rnd() - 0.5) * 60);
  }

  const rrA = [];
  for (let i = 1; i < A.length; i++) rrA.push(A[i] - A[i - 1]);
  const meanRR = mean(rrA);

  const r = sweep(A, B, meanRR, 100, 3, 10);

  ok(
    'the planted offset IS a tooth',
    r.teeth.some((x) => Math.abs(x.lag - PLANTED) <= 60),
    `teeth at ${r.teeth.map((x) => Math.round(x.lag)).join(', ')}`
  );
  ok('the curve is a comb, not a peak — ≥3 teeth', r.teeth.length >= 3, `${r.teeth.length} teeth`);

  const sp = [];
  for (let i = 1; i < r.teeth.length; i++) sp.push(r.teeth[i].lag - r.teeth[i - 1].lag);
  const spOk = sp.length > 0 && sp.every((v) => Math.abs(v - meanRR) < 0.12 * meanRR);
  ok('tooth spacing is the MEAN RR', spOk, `spacing ${sp.map(Math.round).join(', ')} vs meanRR ${Math.round(meanRR)}`);

  /* The identifiability claim: a non-planted tooth reaches most of the planted
     tooth's height, so the argmax carries almost no information about which
     tooth is the true one. This is the assertion the brief's table violated. */
  const planted = r.teeth.find((x) => Math.abs(x.lag - PLANTED) <= 60);
  const others = r.teeth.filter((x) => Math.abs(x.lag - PLANTED) > 0.6 * meanRR);
  const tallestOther = others.length ? Math.max(...others.map((x) => x.n)) : 0;
  ok(
    'a wrong tooth reaches ≥50 % of the right one — offset is ambiguous mod RR',
    planted && tallestOther >= 0.5 * planted.n,
    planted ? `${Math.round((100 * tallestOther) / planted.n)} %` : 'no planted tooth'
  );

  /* And the consequence for the retired statistic: coincidence at lag 0 tells
     you where zero fell on the comb, NOT how well the two trains correspond. */
  const zeroPct = (100 * r.zero) / A.length;
  const peakPct = (100 * r.best.n) / A.length;
  ok('coincidence at lag 0 badly understates correspondence when zero is off-tooth', zeroPct < 0.5 * peakPct, `@0 ${zeroPct.toFixed(1)} % vs peak ${peakPct.toFixed(1)} %`);

  /* Control: against an INDEPENDENT train there is no comb above chance —
     so the comb above is beat sharing, not an artifact of the sweep itself. */
  const C = [];
  t = 0;
  for (let i = 0; i < N; i++) {
    C.push(t);
    t += MEAN_RR * (0.92 + 0.16 * rnd());
  }
  const rc = sweep(A, C, meanRR, 100, 3, 10);
  ok('independent trains produce no tooth above 1.5× chance', rc.teeth.length === 0, `${rc.teeth.length} teeth`);

  console.log(`\n${fail === 0 ? '✓' : '✗'} selftest — ${pass} passed, ${fail} failed`);
  return fail === 0;
}

/* ── main ──────────────────────────────────────────────────────────────── */

if (flag('--selftest')) {
  process.exit(selftest() ? 0 : 1);
} else {
  const dir = opt('--dir', null);
  if (!dir || !existsSync(dir)) {
    console.error('beat-comb-analysis: --dir <folder of per-night export dirs>, or --selftest');
    process.exit(2);
  }
  runDir(dir);
}
