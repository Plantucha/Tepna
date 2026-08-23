/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * nearest-advocate.mjs — EVENT-BASED time-shift estimation, for the case where
 * cross-correlation is known to fail.
 *
 * METHOD: Nearest Advocate — Schranz, C. et al. (2024), "Nearest advocate: a
 * novel event-based time delay estimation algorithm for multi-sensor time-series
 * data", EURASIP Journal on Advances in Signal Processing.
 * DOI 10.1186/s13634-024-01143-1
 * Surveyed in EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF §2, which records why it
 * was reached for: the authors attack exactly our failure mode — "Pearson
 * Cross-Correlation [is] sensitive to typical data quality issues, e.g.
 * misdetected events" — and report the method superior "particularly for short,
 * noisy time-series with missing events", including under NON-LINEAR drift.
 *
 * WHY NOT JUST TRUST IT. `tools/aperiodic-offset.mjs` failed on the paired night
 * by returning a confident-looking argmax of noise: peak prominence 0.0017–0.018
 * against a 0.002 posture-only null, with the peak RIDING THE SEARCH BOUNDARY
 * (3850 ms at ±4 s → 5750 at ±6 s → 9000 at ±9 s). A different estimator with no
 * null control would reproduce that failure in a new costume, so this one ships
 * with two guards and refuses without them:
 *
 *   1. A SHUFFLED NULL. The same search is run against B with its inter-event
 *      intervals shuffled — same event count, same rate, no shared structure.
 *      `zNull` is how many null-SDs the real minimum sits below the null mean.
 *   2. BOUNDARY DETECTION. If the argmin sits within one step of either search
 *      edge, the answer is `boundary: true` and must not be quoted — that is the
 *      exact signature the correlation estimator produced.
 *
 * A caller gets `{ shiftSec, meanDist, zNull, boundary, ok, reason }`. `ok` is
 * false whenever the answer is at a boundary or the null is not separated, and
 * an `ok:false` result carries NO shift a consumer could mistake for a estimate.
 *
 * Usage:
 *   node tools/nearest-advocate.mjs --selftest
 *   node tools/nearest-advocate.mjs --a <a.txt> --b <b.txt> --width 4 [--step 0.02]
 *     (each file: one event time in SECONDS per line)
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';

/* Mean distance from every event in `a` to its nearest "advocate" in `b+shift`.
   Distances are clipped at `dilation` so a single unmatched event contributes a
   bounded penalty instead of dominating the sum — that clipping is what makes the
   statistic robust to the missing events Schranz names, and without it this
   degrades to something as brittle as the correlation it replaces. */
/* SIGN CONVENTION, stated once and asserted in the selftest: `shift` is the amount to
   SUBTRACT FROM B to bring it onto A. So if B runs 1.37 s LATER than A, the answer is +1.37.
   Written explicitly because a silently-inverted offset is this repo's most repeated
   self-inflicted wound — one was caught the same week by a provenance split (DEEP-STAGE §11f),
   and it survives review easily because the magnitude is right. */
export function meanNearestDistance(a, b, shift, dilation) {
  if (!a.length || !b.length) return Number.POSITIVE_INFINITY;
  let sum = 0,
    j = 0;
  for (const t of a) {
    const x = t + shift;
    while (j + 1 < b.length && Math.abs(b[j + 1] - x) <= Math.abs(b[j] - x)) j++;
    let d = Math.abs(b[j] - x);
    if (j > 0) d = Math.min(d, Math.abs(b[j - 1] - x));
    sum += Math.min(d, dilation);
  }
  return sum / a.length;
}

function medianInterval(v) {
  if (v.length < 2) return 1;
  const d = [];
  for (let i = 1; i < v.length; i++) d.push(v[i] - v[i - 1]);
  d.sort((x, y) => x - y);
  return d[d.length >> 1] || 1;
}

/* Deterministic PRNG — the null must be reproducible, and Math.random() is banned
   in this repo's tooling for exactly that reason. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function shuffledLike(b, rnd) {
  if (b.length < 2) return b.slice();
  const gaps = [];
  for (let i = 1; i < b.length; i++) gaps.push(b[i] - b[i - 1]);
  for (let i = gaps.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [gaps[i], gaps[k]] = [gaps[k], gaps[i]];
  }
  const out = [b[0]];
  for (const g of gaps) out.push(out[out.length - 1] + g);
  return out;
}

function sweep(a, b, width, step, dilation) {
  let best = { shift: Number.NaN, dist: Number.POSITIVE_INFINITY };
  const dists = [];
  for (let s = -width; s <= width + 1e-12; s += step) {
    const d = meanNearestDistance(a, b, s, dilation);
    dists.push(d);
    if (d < best.dist) best = { shift: s, dist: d };
  }
  return { best, dists };
}

export function nearestAdvocate(a, b, opts = {}) {
  const A = a.slice().sort((x, y) => x - y);
  const B = b.slice().sort((x, y) => x - y);
  const width = opts.width ?? 4;
  const step = opts.step ?? 0.02;
  const dilation = opts.dilation ?? medianInterval(B) / 2;
  if (A.length < 3 || B.length < 3) return { ok: false, reason: 'fewer than 3 events in a series', shiftSec: null };

  const { best } = sweep(A, B, width, step, dilation);

  /* THE NULL: same event count and same rate, shared structure destroyed. If the
     real minimum is not clearly below what shuffled intervals achieve, the search
     found the shape of the search, not an alignment. */
  const rnd = lcg(opts.seed ?? 12345);
  const nulls = [];
  for (let i = 0; i < (opts.nullIters ?? 24); i++) nulls.push(sweep(A, shuffledLike(B, rnd), width, step, dilation).best.dist);
  const nMean = nulls.reduce((s, v) => s + v, 0) / nulls.length;
  const nSd = Math.sqrt(nulls.reduce((s, v) => s + (v - nMean) ** 2, 0) / nulls.length) || 1e-12;
  const zNull = (nMean - best.dist) / nSd;

  const boundary = Math.abs(Math.abs(best.shift) - width) <= step * 1.5;
  const zMin = opts.zMin ?? 3;
  const ok = !boundary && zNull >= zMin;
  return {
    ok,
    shiftSec: ok ? +best.shift.toFixed(4) : null,
    meanDist: +best.dist.toFixed(6),
    zNull: +zNull.toFixed(2),
    boundary,
    width,
    reason: boundary ? `argmin at the search boundary (±${width}s) — the aperiodic-offset failure signature` : zNull < zMin ? `null not separated (z=${zNull.toFixed(2)} < ${zMin})` : null
  };
}

/* ── selftest ─────────────────────────────────────────────────────────────── */
function selftest() {
  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!cond) fail++;
  };
  const rnd = lcg(7);
  // an aperiodic event train, ~1 event / 3 s over 20 min
  const base = [];
  for (let t = 0; t < 1200; t += 1 + rnd() * 4) base.push(+t.toFixed(3));

  console.log('\n### recovery — a planted shift, with jitter and MISSING events');
  const PLANT = 1.37;
  const b1 = base.filter(() => rnd() > 0.2).map((t) => t + PLANT + (rnd() - 0.5) * 0.04);
  const r1 = nearestAdvocate(base, b1, { width: 4, step: 0.01 });
  ok('recovers the planted shift within 50 ms', r1.ok && Math.abs(r1.shiftSec - PLANT) < 0.05, `shift=${r1.shiftSec} want≈${PLANT} z=${r1.zNull}`);
  // SIGN, asserted rather than assumed: B was built as A + PLANT, so the answer must be POSITIVE.
  ok('…with the documented SIGN (B later ⇒ positive shift)', r1.shiftSec > 0, `shift=${r1.shiftSec}`);
  ok('…and separates the shuffled null', r1.zNull > 5, `z=${r1.zNull}`);

  console.log('\n### THE CONTROL THAT MATTERS — unrelated series must NOT return a shift');
  const b2 = [];
  for (let t = 0; t < 1200; t += 1 + rnd() * 4) b2.push(+t.toFixed(3));
  const r2 = nearestAdvocate(base, b2, { width: 4, step: 0.01 });
  ok('independent series ⇒ ok:false, shiftSec null', r2.ok === false && r2.shiftSec === null, `z=${r2.zNull} reason=${r2.reason}`);

  console.log('\n### boundary refusal — the aperiodic-offset failure signature');
  const b3 = base.filter(() => rnd() > 0.2).map((t) => t + 9.0);
  const r3 = nearestAdvocate(base, b3, { width: 4, step: 0.01 });
  ok('a shift outside the window is REFUSED, not clamped', r3.ok === false, `boundary=${r3.boundary} shift=${r3.shiftSec}`);

  console.log('\n### width-stability — a real alignment must not move with the window');
  const s4 = [2, 4, 6].map((w) => nearestAdvocate(base, b1, { width: w, step: 0.01 }).shiftSec);
  ok(
    'same shift at ±2 / ±4 / ±6 s',
    s4.every((v) => v != null && Math.abs(v - s4[0]) < 0.02),
    JSON.stringify(s4)
  );

  console.log('\n### determinism');
  const r5 = nearestAdvocate(base, b1, { width: 4, step: 0.01 });
  ok('two runs agree exactly', r5.zNull === r1.zNull && r5.shiftSec === r1.shiftSec);

  console.log(`\n${fail === 0 ? 'PASS — recovery, null refusal, boundary refusal and width-stability all hold' : `FAIL — ${fail} problem(s)`}`);
  return fail > 0 ? 1 : 0;
}

/* ⚠ ENTRY-POINT GUARD. Without it this module runs its CLI on IMPORT, so any importer invoked
   with `--selftest` gets THIS tool's selftest instead of its own — and sees a PASS for tests it
   never ran. Caught 2026-08-23 the first time it was imported (`aperiodic-method-compare.mjs`).
   `aperiodic-offset.mjs:245` already guards the same way; this one shipped without it in #1644. */
const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('nearest-advocate.mjs');
const argv = process.argv.slice(2);
if (IS_MAIN && argv.includes('--selftest')) process.exit(selftest());
const readEvents = (p) =>
  fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .map(Number)
    .filter((v) => Number.isFinite(v));
const av = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d; // >= 0: the flag can be argv[0], where `i > 0` silently fell through to the default
};
if (IS_MAIN && (!av('--a') || !av('--b'))) {
  console.error('usage: node tools/nearest-advocate.mjs --a <a.txt> --b <b.txt> [--width 4] [--step 0.02]');
  console.error('       node tools/nearest-advocate.mjs --selftest');
  process.exit(2);
}
if (IS_MAIN) {
  const res = nearestAdvocate(readEvents(av('--a')), readEvents(av('--b')), { width: Number(av('--width', 4)), step: Number(av('--step', 0.02)) });
  console.log(JSON.stringify(res, null, 2));
}
