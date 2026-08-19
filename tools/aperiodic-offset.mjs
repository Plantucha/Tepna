// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * aperiodic-offset — target 1 of KNOWN-CLOCK-ADVERSARIAL-CAPTURE, finally testable.
 *
 * WHY THIS EXISTS. The parent brief recorded target 1 (constant offset) as NEVER TESTED, and the
 * follow-up recorded WHY: `hostAxis` subtracts its first anchor, so a constant offset is removed by
 * construction — a 5 s injection moved the recovered rate by exactly 0.000 ppm on all 61 streams. That
 * is a fact about the estimator, not a test of offset recovery. Testing it needs a feature that is
 * APERIODIC, because beat trains align only modulo one heartbeat interval: two trains one RR apart are
 * indistinguishable from two aligned ones.
 *
 * THE HYPOTHESIS THIS WAS BUILT TO TEST — AND IT FAILED. The follow-up brief said target 1 needs a
 * capture-protocol change: a commanded LED, a deliberate tap. I proposed that nature already supplies
 * one, since a person turning over in bed produces a transient in BOTH devices' accelerometers at the
 * same instant. Measured on the real paired night (H10 chest vs Verity arm, 2026-08-13, 4.75 h
 * overlap): THERE IS NO USABLE SHARED TRANSIENT. Peak prominence 0.0017–0.018 against a posture-only
 * NULL control of 0.002 — indistinguishable — and the peak RIDES THE SEARCH BOUNDARY (3850 ms at
 * ±4 s, 5750 at ±6 s, 9000 at ±9 s), which is what an argmax of noise does and what a real lock never
 * does. Chest and arm accelerometers do not see the same impulse well enough at this granularity.
 * The brief was right; the shortcut does not exist. This tool is kept because the NEGATIVE result is
 * reusable — it is the instrument that would detect a marker if a future capture deliberately made
 * one, and it now carries the two discriminators that distinguish a lock from an argmax.
 *
 * ⚠ THE TRAP THIS FOUND, which is worth more than the hypothesis was. Testing an offset estimator by
 * INJECTING A CONSTANT OFFSET IS VACUOUS. A constant shift translates the entire correlation surface
 * rigidly, so the argmax moves by exactly the injected amount whether or not it means anything.
 * Measured: injections of ±1000 and ±3000 ms were recovered with error EXACTLY 0, on a night whose
 * prominence was 0.0017 — perfect recovery from a method measuring nothing. Use `prominence` and the
 * search-range invariance test instead; both are asserted in --self-test.
 *
 * DETERMINISM. No RNG, no wall clock.
 *
 * Usage:
 *   node tools/aperiodic-offset.mjs --self-test
 *   node tools/aperiodic-offset.mjs --a <ACC.txt> --b <ACC.txt> [--inject-ms N] [--max-lag-s 10]
 */
import { readFileSync } from 'node:fs';

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
export function hostMs(s) {
  const m = ISO.exec(String(s).trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, se, m[7] ? +m[7].padEnd(3, '0') : 0);
}

/** `Phone timestamp;sensor timestamp [ns];X;Y;Z` → { t[], mag[] } on the HOST axis. */
export function parseAcc(text) {
  const t = [],
    mag = [];
  const lines = String(text).split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (c.length < 5) continue;
    const h = hostMs(c[0]);
    const x = +c[2],
      y = +c[3],
      z = +c[4];
    if (h === null || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    t.push(h);
    mag.push(Math.sqrt(x * x + y * y + z * z));
  }
  return { t, mag };
}

/* GRAVITY AND POSTURE ARE NOT THE MARKER. |acc| is dominated by the 1 g vector and by whatever
   orientation the body is in, both of which drift slowly and differ between a chest strap and an
   armband. Differencing the resampled envelope keeps only what CHANGES, which is the transient the two
   devices genuinely share. Without it the correlation is driven by posture and reads as agreement. */
export function envelope(t, mag, gridMs, t0, t1) {
  const n = Math.floor((t1 - t0) / gridMs);
  const acc = new Float64Array(n),
    cnt = new Float64Array(n);
  for (let i = 0; i < t.length; i++) {
    const k = Math.floor((t[i] - t0) / gridMs);
    if (k >= 0 && k < n) {
      acc[k] += mag[i];
      cnt[k]++;
    }
  }
  const out = new Float64Array(n);
  let last = 0;
  for (let k = 0; k < n; k++) {
    out[k] = cnt[k] ? acc[k] / cnt[k] : last;
    last = out[k];
  }
  const d = new Float64Array(n - 1);
  for (let k = 1; k < n; k++) d[k - 1] = Math.abs(out[k] - out[k - 1]);
  return d;
}

const pearson = (a, b, off, n) => {
  let sa = 0,
    sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i + off];
  }
  const ma = sa / n,
    mb = sb / n;
  let na = 0,
    nb = 0,
    nab = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma,
      y = b[i + off] - mb;
    na += x * x;
    nb += y * y;
    nab += x * y;
  }
  return nab / Math.sqrt(na * nb || 1);
};

/** Lag of B relative to A, in ms, by peak correlation of the aperiodic envelopes. */
export function findLag(envA, envB, gridMs, maxLagMs) {
  const maxK = Math.floor(maxLagMs / gridMs);
  const n = Math.min(envA.length, envB.length) - 2 * maxK;
  if (n <= 10) return { ok: false, reason: 'series too short for the requested lag range' };
  let best = null,
    second = -Infinity;
  for (let k = -maxK; k <= maxK; k++) {
    const r = pearson(envA.subarray(maxK, maxK + n), envB, maxK + k, n);
    if (!best || r > best.r) {
      if (best) second = Math.max(second, best.r);
      best = { k, r };
    } else second = Math.max(second, r);
  }
  return {
    ok: true,
    lagMs: best.k * gridMs,
    r: best.r,
    /* PEAK PROMINENCE — the number that says whether the lag is a measurement or an argmax of noise.
       resp-acc-analysis learned this the hard way: a peak |r| of 0.16–0.20 was "the argmax of a noise
       field", not a lock. Published so a caller can refuse rather than trust. */
    runnerUpR: second,
    prominence: best.r - second,
    /* LOCKED, or the lag means nothing. Measured 2026-08-13 (H10 chest vs Verity arm, 4.75 h):
       synthetic planted lock 0.501 · posture-only NULL control 0.002 · the REAL paired night
       0.0017–0.018 — i.e. the real night is indistinguishable from the control. The bound sits an
       order of magnitude above the control and an order below a true lock.
       ⚠ AND DO NOT TEST THIS BY INJECTING A CONSTANT OFFSET. A constant shift translates the whole
       correlation surface rigidly, so the argmax moves by exactly the injected amount whether or not
       it means anything: measured, injections of ±1000/±3000 ms were "recovered" with error EXACTLY 0
       on a night whose prominence was 0.0017. Perfect recovery, measuring nothing. The discriminator
       is prominence, plus the test below. */
    locked: best.r - second >= 0.05
  };
}

function selfTest() {
  let fail = 0;
  const ok = (n, c, d = '') => {
    if (!c) fail++;
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  };
  /* A synthetic pair: slow posture drift (which must NOT drive the answer) plus sparse aperiodic
     impulses (which must). B is a copy shifted by a known lag. */
  const N = 6000,
    grid = 50;
  const t0 = Date.UTC(2026, 7, 13, 23, 0, 0);
  const tA = [],
    mA = [],
    tB = [],
    mB = [];
  const impulses = new Set([500, 1234, 2100, 3050, 4400, 5200]);
  const shift = 40; // grid steps = 2000 ms
  for (let i = 0; i < N; i++) {
    const posture = 1000 + 60 * Math.sin(i / 900);
    const spike = impulses.has(i) ? 700 : 0;
    tA.push(t0 + i * grid);
    mA.push(posture + spike);
    // B: different posture baseline entirely, same impulses, shifted
    const spikeB = impulses.has(i - shift) ? 700 : 0;
    tB.push(t0 + i * grid);
    mB.push(1400 - 90 * Math.sin(i / 700) + spikeB);
  }
  const t1 = t0 + N * grid;
  const eA = envelope(tA, mA, grid, t0, t1),
    eB = envelope(tB, mB, grid, t0, t1);
  const got = findLag(eA, eB, grid, 5000);
  ok('a planted 2000 ms lag is recovered exactly', got.ok && got.lagMs === shift * grid, `lag=${got.lagMs} r=${got.r.toFixed(3)}`);
  ok('…with a prominent peak, not an argmax of noise', got.prominence > 0.2, `prominence=${got.prominence.toFixed(3)}`);
  const zero = findLag(eA, eA, grid, 5000);
  ok('a stream against itself gives zero lag', zero.lagMs === 0 && zero.r > 0.99);
  /* THE CONTROL THAT MATTERS: posture-only, no shared impulses. The method must NOT report a confident
     lag — otherwise it would "recover" an offset from two unrelated recordings. */
  const pA = [],
    pB = [];
  for (let i = 0; i < N; i++) {
    pA.push(1000 + 60 * Math.sin(i / 900));
    pB.push(1400 - 90 * Math.sin(i / 700));
  }
  const nA = envelope(tA, pA, grid, t0, t1),
    nB = envelope(tB, pB, grid, t0, t1);
  const noise = findLag(nA, nB, grid, 5000);
  ok('posture-only pairs yield a WEAK peak — no fabricated lock', noise.prominence < 0.2, `prominence=${noise.prominence.toFixed(3)}`);
  ok('parser refuses an out-of-range stamp', hostMs('2026-13-45T25:00:00') === null);
  ok('a planted lock is reported LOCKED', got.locked === true);
  ok('…and a posture-only pair is NOT', noise.locked === false, `prominence=${noise.prominence.toFixed(4)}`);
  /* THE RANGE TEST. A real peak does not move when the search window widens; an argmax of noise rides
     the boundary. Measured on the real night: 3850 ms at ±4 s, 5750 at ±6 s, 9000 at ±9 s. */
  const wide = findLag(eA, eB, grid, 9000),
    narrow = findLag(eA, eB, grid, 3000);
  ok('a planted lock is INVARIANT to the search range', wide.lagMs === narrow.lagMs, `wide=${wide.lagMs} narrow=${narrow.lagMs}`);
  const nWide = findLag(nA, nB, grid, 9000),
    nNarrow = findLag(nA, nB, grid, 3000);
  ok('…while a noise argmax moves with it', nWide.lagMs !== nNarrow.lagMs, `wide=${nWide.lagMs} narrow=${nNarrow.lagMs}`);
  console.log(fail ? `\n${fail} self-test FAILURE(S)` : '\nself-test: all green');
  return fail ? 1 : 0;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--selftest') || argv.includes('--self-test')) return selfTest();
  const fa = arg('--a'),
    fb = arg('--b');
  if (!fa || !fb) {
    console.error('usage: --a <ACC.txt> --b <ACC.txt> [--inject-ms N] [--max-lag-s 10]');
    return 2;
  }
  const inject = Number(arg('--inject-ms') || 0);
  const maxLagMs = Number(arg('--max-lag-s') || 10) * 1000;
  const grid = Number(arg('--grid-ms') || 50);
  const A = parseAcc(readFileSync(fa, 'utf8'));
  const B = parseAcc(readFileSync(fb, 'utf8'));
  if (inject) for (let i = 0; i < B.t.length; i++) B.t[i] += inject;
  const t0 = Math.max(A.t[0], B.t[0]),
    t1 = Math.min(A.t[A.t.length - 1], B.t[B.t.length - 1]);
  if (!(t1 > t0)) {
    console.error('no overlap');
    return 1;
  }
  const eA = envelope(A.t, A.mag, grid, t0, t1),
    eB = envelope(B.t, B.mag, grid, t0, t1);
  const r = findLag(eA, eB, grid, maxLagMs);
  console.log(JSON.stringify({ overlapHours: +((t1 - t0) / 3.6e6).toFixed(2), gridMs: grid, injectedMs: inject, ...r }, null, 1));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('aperiodic-offset.mjs')) process.exit(main(process.argv.slice(2)));
