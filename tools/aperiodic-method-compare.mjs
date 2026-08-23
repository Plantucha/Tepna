/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * aperiodic-method-compare.mjs — EXTERNAL-METHODS-SURVEY §2's measurement.
 *
 * The question: our aperiodic alignment failed with a correlation/argmax method,
 * and Schranz et al. (2024) say correlation is the weak choice for exactly this
 * data. Does the event-based NEAREST ADVOCATE rescue it, or is the signal simply
 * absent — in which case no estimator can help and the negative result stands?
 *
 * The two are run on THE SAME DATA at THE SAME search widths. Correlation uses
 * `aperiodic-offset.mjs`'s own `parseAcc`/`envelope`/`findLag`; Nearest Advocate
 * consumes EVENTS derived from the identical envelope, so the only variable is
 * the estimator. Anything else would compare two experiments, not two methods.
 *
 * 🔴 WIDTH-STABILITY IS THE VERDICT, not the recovered number. The recorded
 * failure was a peak RIDING THE SEARCH BOUNDARY — 3850 ms at ±4 s, 5750 at ±6 s,
 * 9000 at ±9 s. A method that tracks the window is reporting the window. So both
 * estimators are swept at several widths and judged on whether their answer MOVES.
 *
 * Usage:
 *   node tools/aperiodic-method-compare.mjs --a <ACC.txt> --b <ACC.txt>
 *        [--widths 4,6,9] [--grid-ms 250] [--selftest]
 * ════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { envelope, findLag, parseAcc } from './aperiodic-offset.mjs';
import { nearestAdvocate } from './nearest-advocate.mjs';

/* Envelope → event times. Peaks above a high quantile, with a refractory gap so one
   long movement yields ONE event rather than a burst — Nearest Advocate counts events,
   so a burst would weight a single motion as many. Quantile rather than an absolute
   threshold because the two devices sit at different body sites and their envelope
   scales differ by construction. */
export function envelopeEvents(env, gridMs, t0, { q = 0.98, refractoryMs = 3000 } = {}) {
  const sorted = Array.from(env).sort((x, y) => x - y);
  const thr = sorted[Math.floor(sorted.length * q)] || 0;
  const out = [];
  let lastMs = -Infinity;
  for (let k = 1; k < env.length - 1; k++) {
    /* STRICT on both the threshold and the rising edge. With `>=` a flat run (a quiet stretch
       where the envelope sits at a constant, commonly 0) satisfies "not less than either
       neighbour" at every sample, so every point becomes a peak — the selftest caught this as
       4799 events from 60 planted, and on real data it would have buried the comparison in
       spurious events rather than failing visibly. */
    if (!(env[k] > thr) || !(env[k] > env[k - 1]) || !(env[k] >= env[k + 1])) continue;
    const ms = t0 + k * gridMs;
    if (ms - lastMs < refractoryMs) continue;
    out.push(ms / 1000);
    lastMs = ms;
  }
  return out;
}

function run(aTxt, bTxt, widths, gridMs) {
  const A = parseAcc(aTxt);
  const B = parseAcc(bTxt);
  const t0 = Math.max(A.t[0], B.t[0]);
  const t1 = Math.min(A.t[A.t.length - 1], B.t[B.t.length - 1]);
  if (!(t1 > t0)) return { error: 'no overlap between the two recordings' };
  const envA = envelope(A.t, A.mag, gridMs, t0, t1);
  const envB = envelope(B.t, B.mag, gridMs, t0, t1);
  const evA = envelopeEvents(envA, gridMs, t0);
  const evB = envelopeEvents(envB, gridMs, t0);
  const rows = [];
  for (const w of widths) {
    const corr = findLag(envA, envB, gridMs, w * 1000);
    const na = nearestAdvocate(evA, evB, { width: w, step: gridMs / 1000 });
    rows.push({
      width: w,
      corrLagMs: corr && Number.isFinite(corr.lagMs) ? Math.round(corr.lagMs) : null,
      corrProminence: corr && Number.isFinite(corr.prominence) ? +corr.prominence.toFixed(4) : null,
      naShiftMs: na.shiftSec == null ? null : Math.round(na.shiftSec * 1000),
      naZ: na.zNull,
      naOk: na.ok,
      naReason: na.reason
    });
  }
  return { overlapH: +((t1 - t0) / 3.6e6).toFixed(2), nEvA: evA.length, nEvB: evB.length, rows };
}

function spread(vals) {
  const v = vals.filter((x) => x != null);
  return v.length < 2 ? null : Math.max(...v) - Math.min(...v);
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
    if (!c) fail++;
  };
  // a synthetic envelope with planted shared transients, and its shifted twin
  const GRID = 250;
  const n = 4 * 3600 * (1000 / GRID);
  const eA = new Float64Array(n);
  /* APERIODIC by construction, and that is load-bearing rather than cosmetic. The first draft
     planted EVENLY-SPACED events and the recovery leg failed with shiftSec:null — correctly, because
     a periodic series aligns modulo its own interval, so the shuffled null matches it as well as the
     truth does. That is the degenerate case this whole method exists to avoid ("beat trains align
     only modulo one heartbeat"), and the null control refusing it is the tool working, not failing. */
  const seedTimes = [];
  let acc = 17;
  const jr = ((x) => () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x / 0x7fffffff))(99);
  for (let i = 0; i < 60; i++) {
    acc += Math.floor((n / 90) * (0.4 + 1.6 * jr()));
    if (acc < n - 2) seedTimes.push(acc);
  }
  for (const k of seedTimes) eA[k] = 10;
  const evA = envelopeEvents(eA, GRID, 0);
  ok('events recovered from a planted (aperiodic) envelope', evA.length === seedTimes.length, `${evA.length}/${seedTimes.length}`);
  const evB = evA.map((s) => s + 1.5);
  const na = nearestAdvocate(evA, evB, { width: 4, step: 0.25 });
  ok('a planted 1.5 s shift is recovered on those events', na.ok && Math.abs(na.shiftSec - 1.5) < 0.3, `shift=${na.shiftSec}`);
  ok(
    'refractory collapses a burst to one event',
    envelopeEvents(
      Float64Array.from({ length: 40 }, (_, i) => (i > 4 && i < 12 ? 10 : 0)),
      250,
      0
    ).length <= 1
  );
  console.log(`\n${fail ? `FAIL — ${fail}` : 'PASS — event extraction and recovery hold'}`);
  return fail ? 1 : 0;
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) process.exit(selftest());
const av = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d; // >= 0: the flag can be argv[0], where `i > 0` silently fell through to the default
};
if (!av('--a') || !av('--b')) {
  console.error('usage: node tools/aperiodic-method-compare.mjs --a <ACC.txt> --b <ACC.txt> [--widths 4,6,9]');
  process.exit(2);
}
const widths = String(av('--widths', '4,6,9')).split(',').map(Number);
const gridMs = Number(av('--grid-ms', 250));
/* --grids sweeps the SECOND invariance. Default off so a single run stays cheap, but the
   verdict is not trustworthy without it — see the header. */
const grids = av('--grids') ? String(av('--grids')).split(',').map(Number) : null;
if (grids) {
  console.log('▸ GRID-STABILITY sweep — the axis width-stability cannot see\n');
  console.log('  grid  │ correlation lag │ nearest-advocate shift    z   ok');
  const got = [];
  for (const g of grids) {
    const rr = run(readFileSync(av('--a'), 'utf8'), readFileSync(av('--b'), 'utf8'), [widths[0]], g);
    const x = rr.rows[0];
    got.push(x.naShiftMs);
    console.log(`  ${String(g).padStart(4)} ms│ ${String(x.corrLagMs).padStart(11)} ms │ ${String(x.naShiftMs).padStart(12)} ms ${String(x.naZ).padStart(6)}   ${x.naOk ? 'yes' : 'no'}`);
  }
  const sp = spread(got);
  console.log(`\n  nearest-advocate spread ACROSS GRIDS: ${sp == null ? 'n/a' : sp + ' ms'}`);
  console.log('  An answer that moves with the grid is reporting the grid. High z does not rescue it:');
  console.log('  a shuffled-INTERVAL null preserves event count and rate, so a method matching event');
  console.log('  DENSITY beats that null while recovering no alignment at all.');
  process.exit(0);
}
const r = run(readFileSync(av('--a'), 'utf8'), readFileSync(av('--b'), 'utf8'), widths, gridMs);
if (r.error) {
  console.error(r.error);
  process.exit(1);
}
console.log(`▸ overlap ${r.overlapH} h · grid ${gridMs} ms · events A=${r.nEvA} B=${r.nEvB}\n`);
console.log('  width │ correlation lag  prom  │ nearest-advocate shift    z   ok');
for (const x of r.rows) {
  console.log(
    `  ±${String(x.width).padStart(2)} s │ ${String(x.corrLagMs).padStart(9)} ms ${String(x.corrProminence).padStart(6)} │ ${String(x.naShiftMs).padStart(12)} ms ${String(x.naZ).padStart(6)}   ${x.naOk ? 'yes' : 'no'}${x.naReason ? '  (' + x.naReason + ')' : ''}`
  );
}
const cs = spread(r.rows.map((x) => x.corrLagMs));
const ns = spread(r.rows.map((x) => x.naShiftMs));
console.log(`\n  answer SPREAD across widths — correlation ${cs == null ? 'n/a' : cs + ' ms'} · nearest-advocate ${ns == null ? 'n/a (refused)' : ns + ' ms'}`);
console.log('  A method whose answer tracks the search width is reporting the width, not an alignment.');
