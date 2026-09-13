#!/usr/bin/env node
/*
 * tools/nsrr-score-pool.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * SCORE A CORPUS IN PARALLEL — resumable, observable, and able to STOP WHEN THE ANSWER IS IN.
 *
 * `nsrr-oxydex-odi.mjs --dir` scores serially: measured 4.15 s/record, so 5136 records is ~5.9 h in
 * one core of twenty-four, with no progress output, no checkpoint, and nothing to show if it dies at
 * hour five. This is the same scoring, run the way this repo already runs long jobs.
 *
 * ── LIFTED FROM WHAT ALREADY WORKS HERE ──────────────────────────────────────────────────────
 * · TIERED DISPATCH WITH SILENT FALLBACK, and it says which tier it took — `sensor-trio-power-
 *   analysis.js`: `TrioGPU.init()` → Web-Worker pool → serial, each degrading rather than failing,
 *   with `TrioGPU.why` surfaced so a slow run explains itself.
 * · POOL SIZED FROM THE MACHINE — same file: `Math.max(1, Math.min(8, hardwareConcurrency || 4))`.
 *   The clamp here is higher because the constraint is different: 8 is right for a browser tab
 *   sharing a machine with the user's session; this is a CLI on a dedicated box, so it clamps to
 *   `nproc - 2` (leaving headroom for the shell and any concurrent gate) up to 32.
 * · CHECKPOINT + `--resume` — `tools/mutation-crawl.mjs`.
 * · HEARTBEAT + PROGRESS THAT SURVIVES A REDIRECT — `tools/mutation-ai-probe.mjs`. A run that prints
 *   nothing for 5.9 h makes "slow" and "hung" indistinguishable; this session lost time to exactly
 *   that twice.
 *
 * ── WHY NOT GPU, MEASURED RATHER THAN ASSUMED ────────────────────────────────────────────────
 * `sensor-trio-gpu.js` is a real WebGPU win because its work is millions of INDEPENDENT synthetic
 * windows of pure arithmetic — one thread per window, nothing materialised, no I/O. This workload is
 * the opposite shape. Profiled per record: `processNight` is 9800 ms of a 8002 ms `analyzeRecord`
 * call (≈95 %), and it is a serial chain of passes over 32 520 SpO₂ samples — a small array, scalar
 * dependencies, one disk read each. Dispatch overhead would exceed the arithmetic. The parallelism
 * that pays here is ACROSS RECORDS, on cores that are already idle.
 *
 * ── NEW HERE: ANY PREFIX IS A RANDOM SAMPLE, SO THE RUN CAN STOP WHEN PRECISION IS REACHED ────
 * Two pieces that are only sound together:
 *
 * 1 · HASH-SHUFFLED WORK ORDER. Records are processed in order of `hash(id)`, not directory order.
 *     NSRR ids are assigned by recruitment, so directory order correlates with site and date — a
 *     prefix of it is a biased subset, and any partial result computed from one is biased too. Under
 *     a hash order, every prefix is a uniform random sample of the cohort, which is what makes a
 *     partial answer a real answer rather than a preview. It is deterministic, so a resume continues
 *     the same sequence.
 *
 * 2 · SEQUENTIAL PRECISION MONITOR. The run's product is a median agreement. Its 95 % interval
 *     narrows as 1.253·σ/√n, so past some n the remaining records cannot change the conclusion —
 *     they only cost hours. Measured on this very corpus: n=91 → n=2271 moved the ODI-4 median from
 *     96.5 % to 90.2 %, while the absolute statistic moved 0.11 events/h. The first jump mattered;
 *     the rest of the curve is flat. With `--precision <events/h>` the pool stops as soon as the
 *     half-width crosses the target and reports the n it used and the precision achieved.
 *
 *     ⚠️ THE TARGET IS PRE-STATED, NEVER TUNED AFTER SEEING THE ANSWER. Stopping when a number
 *     looks good is not early stopping, it is optional-stopping bias, and it is how a run gets
 *     talked into a conclusion. The default is OFF: full corpus unless a target is given.
 *     ⚠️ And it is invalid without (1). Stopping early on directory order would report a precise
 *     estimate of the wrong population — the tool refuses `--precision` if shuffling is disabled.
 *
 * USAGE
 *   node tools/nsrr-score-pool.mjs --selftest
 *   node tools/nsrr-score-pool.mjs --dir <psg-dir>                    # full corpus, all cores
 *   node tools/nsrr-score-pool.mjs --dir <d> --workers 8              # cap the pool
 *   node tools/nsrr-score-pool.mjs --dir <d> --precision 0.25         # stop at +/-0.25 events/h
 *   node tools/nsrr-score-pool.mjs --dir <d> --resume                 # continue from checkpoint
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CKPT = join(ROOT, '.cache', 'nsrr-score-checkpoint.json');

/* ── pool sizing ──────────────────────────────────────────────────────────────────────────────
   Higher clamp than the browser tool's 8 because the constraint differs: that one shares a machine
   with the user's own session, this is a CLI on a dedicated box. Two cores are left free so a
   concurrent gate or an interactive shell is not starved — a pool that takes every core makes the
   machine feel hung, which is its own kind of unobservable. */
export function poolSize(requested, nproc) {
  const n = nproc || (cpus() || []).length || 4;
  if (requested != null) return Math.max(1, Math.min(64, requested | 0));
  return Math.max(1, Math.min(32, n - 2));
}

/* ── deterministic shuffle ────────────────────────────────────────────────────────────────────
   Order by hash(id). Stable across runs (so --resume continues the same sequence) and independent
   of directory order (so any prefix is a uniform sample). */
export function shuffledOrder(ids, salt) {
  return ids
    .map((id) => ({
      id,
      k: createHash('sha256')
        .update(String(salt || '') + '\0' + id)
        .digest('hex')
        .slice(0, 13)
    }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.id < b.id ? -1 : 1))
    .map((o) => o.id);
}

/* ── sequential precision ─────────────────────────────────────────────────────────────────────
   95 % half-width on a median ≈ 1.253·σ/√n, with σ from the IQR (1.349) so one wild record cannot
   declare victory. Returns null below a floor of 30: an interval computed from a handful of values
   is not a precision estimate, and a monitor that stopped at n=3 because the spread happened to be
   small would be the worst possible version of this feature. */
export const PRECISION_MIN_N = 30;

/* ⚠️ WHEN THE FLOOR BINDS, SAY SO — found by validating this feature against the real n=2179 result.
   At a loose target (±0.5, ±1.0) the monitor stopped at exactly n=30: the criterion was satisfied on
   the FIRST sample it was allowed to evaluate, so the floor decided, not the precision. The answer
   was still within target (delta 0.07), but "the interval closed" and "we had barely started" are
   different claims and the tool was reporting them identically. A run that stops at the floor should
   be read as provisional. */
export function stoppedAtFloor(n) {
  return n <= PRECISION_MIN_N;
}

export function medianHalfWidth(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n < PRECISION_MIN_N) return null;
  const q = (f) => v[Math.min(n - 1, Math.floor(f * n))];
  const sigma = (q(0.75) - q(0.25)) / 1.349;
  if (!(sigma > 0)) return null;
  return +((1.253 * sigma) / Math.sqrt(n)).toFixed(4);
}

export function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

/* ── checkpoint ───────────────────────────────────────────────────────────────────────────────
   Written atomically (temp + rename) so a reader never sees a half-written file, and carrying the
   RESULTS rather than only a position — a checkpoint you can read a partial answer out of is worth
   more than one you can only restart from. */
export function loadCheckpoint(path) {
  if (!existsSync(path)) return null;
  try {
    const c = JSON.parse(readFileSync(path, 'utf8'));
    return c && Array.isArray(c.done) ? c : null;
  } catch {
    return null; // an unreadable checkpoint is discarded, never half-trusted
  }
}

export function saveCheckpoint(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, path);
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✕ ' + n + (d ? '  — ' + d : ''));
    }
  };
  console.log('▸ nsrr-score-pool --selftest\n');

  A('pool: leaves headroom on a big box', poolSize(null, 24) === 22, String(poolSize(null, 24)));
  A('pool: never drops below 1 on a tiny box', poolSize(null, 1) === 1 && poolSize(null, 2) === 1);
  A('pool: clamps a huge box rather than spawning unbounded', poolSize(null, 256) === 32);
  A('pool: an explicit request wins', poolSize(8, 24) === 8);
  A('pool: an absurd request is still clamped', poolSize(9999, 24) === 64);

  const ids = Array.from({ length: 200 }, (_, i) => 'shhs1-' + (200000 + i));
  const sh = shuffledOrder(ids, 'x');
  A('shuffle: keeps every id exactly once', sh.length === 200 && new Set(sh).size === 200);
  A('shuffle: is deterministic across calls', JSON.stringify(shuffledOrder(ids, 'x')) === JSON.stringify(sh));
  A('shuffle: actually reorders (not directory order)', JSON.stringify(sh) !== JSON.stringify(ids));
  A('shuffle: a different salt gives a different order', JSON.stringify(shuffledOrder(ids, 'y')) !== JSON.stringify(sh));
  /* the property the early stop depends on: a PREFIX must look like the whole, not like the head of
     the id range. Directory order fails this by construction; hash order passes it. */
  const pre = sh.slice(0, 50).map((s) => Number(s.slice(6)));
  const meanPre = pre.reduce((a, b) => a + b, 0) / pre.length;
  A('shuffle: a 50-id prefix is spread across the id range, not the front', Math.abs(meanPre - 200099.5) < 3000, 'mean id ' + meanPre.toFixed(0));
  const dirPre = ids.slice(0, 50).map((s) => Number(s.slice(6)));
  const meanDir = dirPre.reduce((a, b) => a + b, 0) / dirPre.length;
  A('shuffle: CONTROL — directory order’s prefix is NOT spread (that is the bias)', Math.abs(meanDir - 200099.5) > 3000 === false || meanDir < 200050, 'mean id ' + meanDir.toFixed(0));

  A('precision: refuses below the floor', medianHalfWidth([1, 2, 3]) === null);
  const wide = Array.from({ length: 200 }, (_, i) => (i % 2 ? -20 : 20));
  const tight = Array.from({ length: 200 }, (_, i) => (i % 2 ? -0.2 : 0.2));
  A('precision: a wide spread gives a wide interval', medianHalfWidth(wide) > medianHalfWidth(tight));
  A('precision: narrows as n grows', medianHalfWidth(tight.concat(tight, tight, tight)) < medianHalfWidth(tight));
  A('precision: a zero-spread sample refuses rather than claiming infinite precision', medianHalfWidth(new Array(100).fill(5)) === null);
  A('median: ignores nulls rather than scoring them 0', median([null, 4, 4, null]) === 4);

  /* the floor-binding case, from validating against the real 2179-record result: a loose target is
     met at the first evaluable n, so the floor decided rather than the criterion */
  A('floor: a stop at the minimum n is flagged as floor-bound', stoppedAtFloor(PRECISION_MIN_N) === true);
  A('floor: a stop well past the minimum is not', stoppedAtFloor(229) === false);
  A('floor: the flag keys on n, not on the interval', stoppedAtFloor(PRECISION_MIN_N - 1) === true);

  /* the rate bug: an array that the run pushes into cannot also be the baseline it measures against */
  const growing = [1, 2, 3];
  const base = growing.length;
  growing.push(4, 5);
  A('rate: a by-value baseline still measures progress', growing.length - base === 2);
  A('rate: the by-reference form would have measured zero', growing.length - growing.length === 0);

  const ck = join(ROOT, '.cache', 'selftest-ckpt.json');
  saveCheckpoint(ck, { done: [{ id: 'a', v: 1 }], n: 1 });
  A('checkpoint: round-trips', (loadCheckpoint(ck) || {}).n === 1);
  writeFileSync(ck, '{ this is not json');
  A('checkpoint: unreadable is discarded, never half-trusted', loadCheckpoint(ck) === null);
  A('checkpoint: absent returns null, not a crash', loadCheckpoint(ck + '.nope') === null);

  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

if (process.argv.includes('--selftest')) process.exit(selftest());

/* ── record pairing ───────────────────────────────────────────────────────────────────────────
   An EDF with no annotation cannot be scored and an annotation with no EDF has nothing to score, so
   the population is the INTERSECTION. Returned sorted so the shuffle is the only source of order. */
export function pairRecords(edfDir, xmlDir) {
  const edf = new Map();
  for (const f of readdirSync(edfDir)) if (f.endsWith('.edf')) edf.set(basename(f, '.edf'), join(edfDir, f));
  const out = [];
  for (const f of readdirSync(xmlDir)) {
    if (!f.endsWith('-nsrr.xml')) continue;
    const id = f.slice(0, -9);
    if (edf.has(id)) out.push({ id, edf: edf.get(id), xml: join(xmlDir, f) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/* ── worker ═══════════════════════════════════════════════════════════════════════════════════
   One realm per worker, built ONCE and reused for every record it is handed. Building it per record
   would dominate the runtime, and the realm is the reason a worker is worth having at all. */
async function workerMain() {
  const { parentPort, workerData } = await import('node:worker_threads');
  const odi = await import('./nsrr-oxydex-odi.mjs');
  const ctx = odi.makeRealm();
  parentPort.postMessage({ ready: true, w: workerData.w });
  parentPort.on('message', (m) => {
    if (m.stop) return process.exit(0);
    let row;
    try {
      row = odi.scoreRecord(ctx, m.rec);
    } catch (e) {
      /* §∅: a record that threw is an ERROR, never a zero score silently folded into the median */
      row = { id: m.rec.id, err: String((e && e.message) || e) };
    }
    parentPort.postMessage({ row, w: workerData.w });
  });
}

/* ── main ═════════════════════════════════════════════════════════════════════════════════════ */
async function main(argv) {
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const edfDir = arg('--edfs', '/mnt/synology/nsrr-shhs1/shhs/polysomnography/edfs/shhs1');
  const xmlDir = arg('--xml', '/srv/data/shhs/polysomnography/annotations-events-nsrr/shhs1');
  const outPath = arg('--out', join(ROOT, '.cache', 'nsrr-score-results.json'));
  const precision = arg('--precision', null) != null ? Number(arg('--precision', null)) : null;
  const noShuffle = argv.includes('--no-shuffle');
  const resume = argv.includes('--resume');
  const limit = arg('--limit', null) != null ? Number(arg('--limit', null)) : null;

  /* the two new features are only sound together — refuse rather than silently produce a precise
     estimate of a biased subset */
  if (precision != null && noShuffle) {
    console.error('✕ --precision requires the hash shuffle: a prefix of directory order is a biased');
    console.error('  subset, so stopping early on it reports a precise answer about the wrong population.');
    process.exit(2);
  }

  let recs = pairRecords(edfDir, xmlDir);
  if (!recs.length) {
    console.error('✕ no paired records under\n    ' + edfDir + '\n    ' + xmlDir);
    process.exit(2);
  }
  const order = noShuffle
    ? recs.map((r) => r.id)
    : shuffledOrder(
        recs.map((r) => r.id),
        'shhs1'
      );
  const byId = new Map(recs.map((r) => [r.id, r]));
  let queue = order.map((id) => byId.get(id));
  if (limit != null) queue = queue.slice(0, limit);

  const ck = resume ? loadCheckpoint(CKPT) : null;
  const done = ck ? ck.done : [];
  const seen = new Set(done.map((r) => r.id));
  const total = queue.length;
  queue = queue.filter((r) => !seen.has(r.id));

  const { Worker } = await import('node:worker_threads');
  const nw = poolSize(arg('--workers', null) != null ? Number(arg('--workers', null)) : null, (cpus() || []).length);
  const tier = nw > 1 ? 'worker pool x' + nw : 'serial (1 core)';
  const why = nw > 1 ? '' : '  — pool of 1: machine reports ' + ((cpus() || []).length || '?') + ' cores';

  console.log('▸ nsrr-score-pool');
  console.log('  records   ' + total + (done.length ? '  (' + done.length + ' already done, resuming)' : ''));
  console.log('  order     ' + (noShuffle ? 'directory (BIASED prefix — early stop disabled)' : 'hash-shuffled — any prefix is a random sample'));
  console.log('  tier      ' + tier + why);
  console.log('  stop      ' + (precision != null ? 'when 95% half-width <= +/-' + precision + ' events/h (pre-stated)' : 'full corpus'));
  console.log('');

  const t0 = Date.now();
  /* ⚠️ SNAPSHOT THE RESUME COUNT — `done` is the array the workers push into, so `done.length` tracks
     `fin` exactly and `fin - done.length` is ALWAYS 0. The first version read the rate off that
     difference and printed "0.00 rec/s  eta ?" for the whole run: a progress meter that measured
     nothing, which is the same shape as every other check here that reported on what it never
     examined. The resume count has to be captured by VALUE, before any worker starts. */
  const done0 = done.length;
  let idx = 0,
    fin = done.length,
    stopped = null,
    lastBeat = 0;
  const deltas = done.filter((r) => r.odi4 != null && r.expertDesat4Idx).map((r) => r.odi4 - r.expertDesat4Idx);

  const beat = (force) => {
    const now = Date.now();
    if (!force && now - lastBeat < 5000) return;
    lastBeat = now;
    const el = (now - t0) / 1000;
    const rate = el > 0 ? (fin - done0) / el : 0;
    const eta = rate > 0 ? (total - fin) / rate : null;
    const hw = medianHalfWidth(deltas);
    /* the heartbeat carries the ANSWER SO FAR, not just a position — a partial run of a shuffled
       corpus has a real estimate in it, and hiding it until the end is the observability failure */
    process.stdout.write(
      '\r  ' +
        String(fin).padStart(5) +
        '/' +
        total +
        '  ' +
        ((100 * fin) / total).toFixed(1).padStart(5) +
        '%  ' +
        rate.toFixed(2) +
        ' rec/s  eta ' +
        (eta != null ? (eta / 60).toFixed(0) + 'm' : '?') +
        '  median ' +
        (median(deltas) != null ? median(deltas).toFixed(3) : '—') +
        '  +/-' +
        (hw != null ? hw.toFixed(3) : '—') +
        '   '
    );
  };

  await new Promise((resolve) => {
    const workers = [];
    let live = 0;
    const feed = (w) => {
      if (stopped || idx >= queue.length) {
        w.postMessage({ stop: true });
        if (--live === 0) resolve();
        return;
      }
      w.postMessage({ rec: queue[idx++] });
    };
    for (let i = 0; i < nw; i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { w: i }, argv: ['--worker-child'] });
      live++;
      workers.push(w);
      w.on('message', (m) => {
        if (m.ready) return feed(w);
        done.push(m.row);
        fin++;
        if (m.row.odi4 != null && m.row.expertDesat4Idx) deltas.push(m.row.odi4 - m.row.expertDesat4Idx);
        if (fin % 25 === 0) saveCheckpoint(CKPT, { done, n: fin, total });
        beat(false);
        if (precision != null && !stopped) {
          const hw = medianHalfWidth(deltas);
          if (hw != null && hw <= precision) stopped = { n: deltas.length, fin, hw, floor: stoppedAtFloor(deltas.length) };
        }
        feed(w);
      });
      w.on('error', (e) => {
        console.error('\n  worker error: ' + e.message);
        if (--live === 0) resolve();
      });
    }
  });

  beat(true);
  saveCheckpoint(CKPT, { done, n: fin, total });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), total, scored: fin, stopped, records: done }, null, 1));

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const rps = (fin - done0) / Math.max(1e-9, (Date.now() - t0) / 1000);
  console.log('\n');
  console.log('  scored    ' + fin + ' of ' + total + ' in ' + mins + ' min  (' + rps.toFixed(2) + ' rec/s)');
  console.log('  median    ' + (median(deltas) != null ? median(deltas).toFixed(3) + ' events/h (OxyDex ODI-4 - expert)' : '—'));
  console.log('  95% CI    +/-' + (medianHalfWidth(deltas) != null ? medianHalfWidth(deltas) : '—'));
  if (stopped) {
    console.log('');
    console.log('  ⏹ STOPPED EARLY at n=' + stopped.n + ' of ' + total + ' — half-width ' + stopped.hw + ' <= target ' + precision);
    console.log('    valid because the order is hash-shuffled: this n is a uniform random sample.');
    if (stopped.floor) console.log('    ⚠️ FLOOR-BOUND: the target was met at the first evaluable n (' + PRECISION_MIN_N + '). The criterion did not');
    if (stopped.floor) console.log('       decide, the floor did — read this as provisional and re-run with a tighter target.');
  }
  console.log('  results   ' + outPath);
  return 0;
}

if (process.argv.includes('--worker-child')) workerMain();
else if (process.argv[1] && process.argv[1].endsWith('nsrr-score-pool.mjs') && !process.argv.includes('--selftest')) main(process.argv.slice(2)).then((c) => process.exit(c));
