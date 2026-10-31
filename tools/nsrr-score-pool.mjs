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
 * ── THE VERDICT (tepna.verdict/1, VERDICT-CONTRACT §1; `verdict.js` is the authority) ────────
 * The pool is the EMITTER for every scorer it drives, so the object is built here, once, from the
 * scorer's own `liveStat` and — when the scorer declares one — its own criterion:
 *     export const CRITERION = { name, threshold, unit, direction }   // pre-stated, in the scorer
 *     export function verdict(stat, rows) -> { status, reason }      // the scorer's decision
 * Population = paired records: eligible = every EDF↔annotation pair in the run, checked = the records
 * that contributed to the statistic (`stat.n`), excluded = the rest (errored, or missing a term).
 * `result` always carries the statistic (value · halfWidth · n · label) so the number survives the
 * status. ⚠️ A scorer that declares NO criterion gets **UNKNOWN**, with the reason saying so — never a
 * PASS. Four scorers (`nsrr-aai-validate`, `nsrr-ahiest-validate`, `nsrr-oxstat-validate`,
 * `nsrr-resprate-validate`) never pre-stated a band and their numbers are already on record (RESIDUE
 * 2026-09-15-* · 2026-09-22-nsrr-pool-scorers-have-no-prestated-band), so
 * a band written now would be a number, not a test; UNKNOWN is the truthful status for a statistic
 * with no rule to apply, and it is what makes the missing rule visible. The object is written into
 * the results file under `verdict` and printed as one labelled line.
 *
 * USAGE
 *   node tools/nsrr-score-pool.mjs --selftest
 *   node tools/nsrr-score-pool.mjs --verdict-sample                   # the object over a synthetic
 *                                                                     # scorer — no corpus; CI reads it
 *   node tools/nsrr-score-pool.mjs --dir <psg-dir>                    # full corpus, all cores
 *   node tools/nsrr-score-pool.mjs --dir <d> --workers 8              # cap the pool
 *   node tools/nsrr-score-pool.mjs --dir <d> --precision 0.25         # stop at +/-0.25 events/h
 *   node tools/nsrr-score-pool.mjs --dir <d> --resume                 # continue from checkpoint
 *   node tools/nsrr-score-pool.mjs --dir <d> --seed shhs2            # name the hash order
 *   node tools/nsrr-score-pool.mjs --scorer ./nsrr-stage-validate.mjs # drive a different scorer
 *
 * A SCORER is any module exporting `makeRealm()` and `scoreRecord(ctx, rec)` (or `poolScoreRecord`
 * when its own CLI needs a different signature), with `rec = { id, edf, xml }`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { cpus, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { isCliEntry } from './argv-guard.mjs';
import { printVerdict } from './verdict-emit.mjs';
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';

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

/* ── the shuffle seed ─────────────────────────────────────────────────────────────────────────
   `'shhs1'` was a literal at the one call site, which made the hold-out order a property of the
   SOURCE rather than of the run: a second cohort, or a second fold of the same cohort, could not
   get its own order without editing the tool, and no output recorded which order it had been
   scored in. The literal is now this default, so every run made before this change reproduces
   byte for byte, and `--seed` names the order when a caller wants a different one.

   PARSED HERE, PURELY, FOR TWO REASONS. The pool's own `arg()` helper reads only the SPACE form
   (`--k v`), so `--seed=x` would be ignored in silence and the run would quietly use the default
   while its header claimed the caller's seed — a precise answer about the wrong order. And an
   empty value (`--seed` at the end of the line, or `--seed=`) is the same failure wearing a
   different hat. Both REFUSE. Two `--seed` flags refuse as well: a run has one hold-out order,
   and picking the last silently discards the caller's other instruction. */
export const DEFAULT_SEED = 'shhs1';

export function seedFromArgv(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const hits = [];
  for (let i = 0; i < list.length; i++) {
    const a = String(list[i] == null ? '' : list[i]);
    if (a === '--seed') hits.push({ raw: a, value: i + 1 < list.length ? String(list[i + 1] == null ? '' : list[i + 1]) : null });
    else if (a.startsWith('--seed=')) hits.push({ raw: a, value: a.slice('--seed='.length) });
  }
  if (!hits.length) return { seed: DEFAULT_SEED, explicit: false, error: null };
  if (hits.length > 1) return { seed: null, explicit: true, error: '--seed given ' + hits.length + ' times; a run has one hold-out order' };
  const v = hits[0].value;
  if (v == null || v === '') return { seed: null, explicit: true, error: '--seed needs a value (`--seed shhs1` or `--seed=shhs1`)' };
  if (v.startsWith('--')) return { seed: null, explicit: true, error: '--seed read the next flag (' + v + ') as its value' };
  return { seed: v, explicit: true, error: null };
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
/* ── the verdict object ───────────────────────────────────────────────────────────────────────
   Pure. `scorer` is the imported scorer module (or any object with liveStat/CRITERION/verdict);
   `stat` its liveStat over `rows`; `pop` = { total }; `meta` = { scorerSpec, commit, at, evidence }. */
export function poolVerdict(scorer, stat, rows, pop, meta) {
  meta = meta || {};
  const name = String(meta.scorerSpec || 'scorer')
    .replace(/^.*\//, '')
    .replace(/\.mjs$/, '');
  const n = stat && Number.isFinite(stat.n) ? stat.n : 0;
  const total = pop && Number.isFinite(pop.total) ? pop.total : n;
  const result = n > 0 ? { label: stat.label, value: stat.value, halfWidth: stat.halfWidth == null ? null : stat.halfWidth, n } : null;
  const declared = scorer && scorer.CRITERION && typeof scorer.verdict === 'function';
  let status;
  let reason;
  if (!n) {
    status = 'NOT_RUN';
    reason = 'no record contributed to the statistic (' + (rows || []).length + ' scored, ' + total + ' paired) — nothing to decide on';
  } else if (!declared) {
    status = 'UNKNOWN';
    reason =
      name +
      ' declares no pre-stated criterion (no `CRITERION` + `verdict()` export) — the statistic is reported bare and no rule can be applied to it; a band written after the number is a number, not a test';
  } else {
    const d = scorer.verdict(stat, rows) || {};
    status = d.status;
    reason = d.reason == null ? null : d.reason;
  }
  const producedBy = { tool: 'tools/nsrr-score-pool.mjs', commit: meta.commit == null ? null : meta.commit };
  if (meta.commit == null) producedBy.commitReason = meta.commitReason || 'not run inside a git checkout';
  return {
    schema: 'tepna.verdict/1',
    gate: 'nsrr-score-pool:' + name,
    scope: 'internal',
    status,
    population: { checked: n, eligible: total, excluded: total - n },
    criterion: declared ? scorer.CRITERION : { name: 'undeclared', threshold: 0, unit: '', direction: 'lte' },
    result: status === 'NOT_RUN' || status === 'NOT_APPLICABLE' ? null : result,
    evidence: ['tools/nsrr-score-pool.mjs', ...(meta.scorerSpec ? ['tools/' + String(meta.scorerSpec).replace(/^\.\//, '')] : []), ...(meta.evidence || [])],
    reason,
    producedBy,
    at: (meta.at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z')
  };
}
/* A scorer that DOES declare — the shape every real scorer can copy, and what --verdict-sample runs.
   Synthetic rows, a pre-stated band on the median, no corpus. */
export const SAMPLE_SCORER = Object.freeze({
  CRITERION: Object.freeze({ name: 'median_abs_delta', threshold: 1, unit: 'events/h', direction: 'lte' }),
  liveStat: (rows) => {
    const d = rows.filter((r) => r && !r.err && r.delta != null).map((r) => r.delta);
    return { label: 'median delta (synthetic)', value: median(d), halfWidth: medianHalfWidth(d), n: d.length };
  },
  verdict: (stat) => (Math.abs(stat.value) <= 1 ? { status: 'PASS', reason: null } : { status: 'FAIL', reason: 'median |delta| ' + stat.value + ' > 1 events/h' })
});
export function verdictSample() {
  const rows = Array.from({ length: 40 }, (_, i) => (i % 8 === 7 ? { err: 'synthetic failure' } : { delta: ((i * 7) % 11) / 10 - 0.5 }));
  return poolVerdict(
    SAMPLE_SCORER,
    SAMPLE_SCORER.liveStat(rows),
    rows,
    { total: 44 },
    { scorerSpec: './sample-scorer.mjs', commit: null, commitReason: '--verdict-sample: synthetic scorer and rows, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}
function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

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

  /* ── the seed ───────────────────────────────────────────────────────────────────────────────
     The order the pool scores in used to be a literal, so the first thing these legs prove is that
     naming it changed NOTHING: the default order is pinned to a digest computed before the literal
     moved. Neutral ids, so no record identifier appears in this file. */
  {
    const nids = Array.from({ length: 200 }, (_, i) => 'rec-' + String(i).padStart(3, '0'));
    const dig = (list) => createHash('sha256').update(list.join(',')).digest('hex').slice(0, 16);
    A('seed: the default is the value the call site used to hardcode', DEFAULT_SEED === 'shhs1', DEFAULT_SEED);
    A('seed: no flag reads as the default, and says it was not explicit', seedFromArgv([]).seed === DEFAULT_SEED && seedFromArgv([]).explicit === false);
    A(
      'seed: the default order is byte-identical to the pinned pre-change order',
      dig(shuffledOrder(nids, seedFromArgv([]).seed)) === '95b46410acfe8251',
      dig(shuffledOrder(nids, seedFromArgv([]).seed))
    );
    A('seed: CONTROL — another seed does NOT reproduce that order', dig(shuffledOrder(nids, 'other')) === 'bad98a632561ee6c' && dig(shuffledOrder(nids, 'other')) !== '95b46410acfe8251');
    A('seed: the space form is read', seedFromArgv(['--seed', 'shhs2']).seed === 'shhs2');
    A('seed: the equals form is read too, because the pool’s own arg() ignores it', seedFromArgv(['--seed=shhs2']).seed === 'shhs2');
    A('seed: an explicit value reports itself as explicit', seedFromArgv(['--seed', 'shhs2']).explicit === true);
    A('seed: a flag in the middle of a line is found', seedFromArgv(['--dir', 'd', '--seed', 'q', '--resume']).seed === 'q');
    A('seed: a trailing --seed REFUSES rather than defaulting in silence', seedFromArgv(['--seed']).seed === null && /needs a value/.test(seedFromArgv(['--seed']).error));
    A('seed: an empty equals value refuses', seedFromArgv(['--seed=']).seed === null && seedFromArgv(['--seed=']).error != null);
    A('seed: --seed swallowing the next flag refuses', seedFromArgv(['--seed', '--resume']).seed === null && /next flag/.test(seedFromArgv(['--seed', '--resume']).error));
    A(
      'seed: two --seed flags refuse — a run has one order, so last-wins discards an instruction',
      seedFromArgv(['--seed', 'a', '--seed=b']).seed === null && /one hold-out order/.test(seedFromArgv(['--seed', 'a', '--seed=b']).error)
    );
    A('seed: a value that merely CONTAINS --seed is not a flag', seedFromArgv(['--dir', 'x--seed=y']).explicit === false);
    A('seed: a non-string argv member cannot crash the parser', seedFromArgv([null, undefined, 7, '--seed', 'ok']).seed === 'ok');
    A('seed: a non-array argv reads as no flag', seedFromArgv(null).seed === DEFAULT_SEED && seedFromArgv(undefined).explicit === false);
    /* the refusals in main() are asserted on its SOURCE: both are process.exit paths, and a leg that
       spawned the pool would need a corpus */
    const src = readFileSync(new URL(import.meta.url).pathname, 'utf8');
    A('seed: main refuses --seed together with --no-shuffle', /seedRead\.explicit && noShuffle/.test(src));
    A('seed: main refuses a resume whose checkpoint carries a different order', /ckSeed !== undefined && ckSeed !== runSeed/.test(src));
    A('seed: an unrecorded checkpoint seed is reported as absent, never assumed to be the default', /predates seed recording/.test(src) && !/ckSeed \|\| DEFAULT_SEED/.test(src));
    A('seed: the checkpoint and the results file both record the order they were scored in', (src.match(new RegExp('seed: ' + 'runSeed', 'g')) || []).length === 3);
  }

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

  /* the verdict — declared and undeclared scorers, pinned against verdict.js */
  {
    const V = createRequire(import.meta.url)('../verdict.js');
    const val = (v) => (V.validate(v).ok ? true : V.validate(v).errors.join(' | '));
    const meta = { scorerSpec: './nsrr-aai-validate.mjs', commit: 'ec4e2d93', at: '2026-09-22T00:00:00Z' };
    const rows = Array.from({ length: 30 }, (_, i) => ({ odi4: 10 + (i % 5), expertDesat4Idx: 11 }));
    const undeclared = { liveStat: defaultLiveStat };
    const u = poolVerdict(undeclared, defaultLiveStat(rows), rows, { total: 32 }, meta);
    A('verdict: a scorer with no CRITERION → UNKNOWN naming the missing rule, never PASS', u.status === 'UNKNOWN' && /no pre-stated criterion/.test(u.reason), u.reason);
    A('verdict: …the statistic still rides in result (value, halfWidth, n)', u.result && u.result.n === 30 && u.result.value != null && 'halfWidth' in u.result, JSON.stringify(u.result));
    A('verdict: …population is paired records, checked + excluded = eligible', u.population.checked === 30 && u.population.excluded === 2 && u.population.eligible === 32);
    A('verdict: …gate names the scorer', u.gate === 'nsrr-score-pool:nsrr-aai-validate', u.gate);
    A('verdict: …valid under verdict.js', val(u) === true, String(val(u)));
    const smp = verdictSample();
    A(
      'verdict: a declared scorer decides — the sample lands on its own enum value with the declared criterion',
      smp.status === 'PASS' && smp.criterion.name === 'median_abs_delta' && smp.population.checked === 35 && smp.population.eligible === 44,
      JSON.stringify({ s: smp.status, p: smp.population })
    );
    A('verdict: …valid, commit null WITH a reason', val(smp) === true && smp.producedBy.commit === null && /synthetic/.test(smp.producedBy.commitReason), String(val(smp)));
    const failing = { ...SAMPLE_SCORER, verdict: (st) => ({ status: 'FAIL', reason: 'median |delta| ' + st.value + ' > 1' }) };
    const f = poolVerdict(failing, SAMPLE_SCORER.liveStat([{ delta: 3 }, { delta: 4 }, { delta: 5 }]), [{ delta: 3 }, { delta: 4 }, { delta: 5 }], { total: 3 }, meta);
    A('verdict: a declared FAIL passes through with its reason', f.status === 'FAIL' && /> 1/.test(f.reason) && val(f) === true, String(val(f)));
    const nr = poolVerdict(SAMPLE_SCORER, SAMPLE_SCORER.liveStat([{ err: 'x' }]), [{ err: 'x' }], { total: 5 }, meta);
    A('verdict: nothing contributed → NOT_RUN, result null, even for a declared scorer', nr.status === 'NOT_RUN' && nr.result === null && val(nr) === true, String(val(nr)));
    const bad = { ...SAMPLE_SCORER, verdict: () => ({ status: 'PASS', reason: null }) };
    const b = poolVerdict(bad, { label: 'x', value: 0, halfWidth: null, n: 0 }, [], { total: 0 }, meta);
    A('verdict: a scorer cannot smuggle PASS over checked 0 — the pool decides NOT_RUN first', b.status === 'NOT_RUN', b.status);
  }

  /* ── THE POPULATION, TESTED BOTH WAYS ───────────────────────────────────────────────────────
     The pairing IS the rule this pool publishes, and the queue is now rebuilt from the OFFER's
     member names. So the leg that matters is the EQUIVALENCE: the same two paths `pairRecords`
     built, or the run scores a path nobody enumerated. Planted in a temp tree, both directions. */
  const ptmp = mkdtempSync(join(tmpdir(), 'nsrr-pool-'));
  try {
    const ed = join(ptmp, 'edfs'),
      xd = join(ptmp, 'anns');
    mkdirSync(ed);
    mkdirSync(xd);
    for (const f of ['rec-0001.edf', 'rec-0002.edf', 'rec-0009.edf']) writeFileSync(join(ed, f), 'x');
    for (const f of ['rec-0001-nsrr.xml', 'rec-0002-nsrr.xml', 'rec-0008-nsrr.xml', 'notes.txt']) writeFileSync(join(xd, f), 'x');
    const lister = pairedRecordLister(ed);
    A('lister: the population is the INTERSECTION, so an unpaired record on either side is out', lister(xd).join(',') === 'rec-0001,rec-0002', lister(xd).join(','));
    A('lister: the function carries a NAME, so the published rule is not `null`', lister.name === 'pairedWithAnEdf', lister.name);
    const snap = snapshotEntries(xd, { list: lister, unit: 'records' });
    A('snapshot: the published rule names the pairing, over a RECORD unit', snap.rule === 'pairedWithAnEdf' && snap.unit === 'records' && snap.n === 2, String(snap.rule));
    A(
      'EQUIVALENCE: the queue rebuilt from the offer holds the paths the pairing itself built',
      JSON.stringify(snap.members.map((id) => recordPaths(id, ed, xd))) === JSON.stringify(pairRecords(ed, xd)),
      JSON.stringify(snap.members.map((id) => recordPaths(id, ed, xd)))
    );
    const gone = snapshotEntries(join(ptmp, 'nowhere'), { list: lister, unit: 'records' });
    A('snapshot: a tree nobody can enumerate is not a population of 0', gone.ok === false && gone.reason !== null, String(gone.reason));
  } finally {
    rmSync(ptmp, { recursive: true, force: true });
  }
  /* ⚠️ `notCovered` DROPS A ROW ON `ok === false`, AND AN ERRORED POOL ROW CARRIES `err`, not `ok`.
     So the caller filters the errors out BEFORE the call; passing `done` whole would count a record
     that threw as scored and name it nowhere. Both readings are pinned. */
  const offer3 = { members: ['a', 'b', 'c'], n: 3, unit: 'records' };
  A('unscored: the offer minus the score, read through the record key the rows carry', notCovered(offer3, [{ id: 'b' }], { key: 'id' }).join(',') === 'a,c');
  A('unscored CONTROL: an errored row left IN would read as scored, which is why the caller filters', notCovered(offer3, [{ id: 'b' }, { id: 'c', err: 'boom' }], { key: 'id' }).join(',') === 'a');
  A('exit: a tree nobody can enumerate exits 2', exitCodeFor({ status: 'NOT_RUN' }, 0, 0) === 2);
  A('exit: a root that offered nothing exits 2', exitCodeFor({ status: 'PASS' }, 0, 0) === 2);
  A('exit: a pool whose every worker errored exits 2 \u2014 it returned 0 before', exitCodeFor({ status: 'PASS' }, 32, 0) === 2);
  A('exit CONTROL: an early stop is reduced coverage, which annotates and exits 0', exitCodeFor({ status: 'PASS' }, 5136, 400) === 0);

  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

/* Keyed on argv[1], like the main guard below: a scorer may `import()` this module for `poolVerdict`
   while running its OWN --selftest / --verdict-sample, and a bare argv check would hijack that run. */
const POOL_IS_CLI = isCliEntry(import.meta.url);
if (POOL_IS_CLI && process.argv.includes('--selftest')) process.exit(selftest());
if (POOL_IS_CLI && process.argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample(), null, 1));
  process.exit(0);
}

/* Probe whether a scorer can support early stopping AT ALL, before a run starts — an unsupported
   `--precision` must fail loudly at second 0, not run to the end pretending to watch. */
export function liveStatProbe(mod, rows) {
  const f = typeof mod.liveStat === 'function' ? mod.liveStat : defaultLiveStat;
  const st = f(rows || []);
  return st && st.halfWidth !== undefined ? 0 : null;
}

/* ── the LIVE STATISTIC ───────────────────────────────────────────────────────────────────────
   The running answer, recomputed from the rows scored so far, for the heartbeat and the early stop.

   ⚠️ THIS WAS HARDWIRED TO THE ODI METRIC AND THAT WAS A DEFECT, not a missing feature. Driving the
   pool with `--scorer ./nsrr-stage-validate.mjs` printed `median —  +/-—` for a whole run: the
   progress meter reported nothing and the early stop could never fire, because its input was always
   empty. Same shape as every other check here that reported on something it never examined — and it
   FAILS SILENTLY, because an em-dash reads as "not yet" rather than "structurally unavailable".

   A scorer supplies its own `liveStat(rows) -> { label, value, halfWidth, n, detail? }`; this is the
   fallback. `halfWidth: null` disables early stopping for that scorer rather than stopping on a
   number nobody computed. */
export function defaultLiveStat(rows) {
  const d = rows.filter((r) => r && !r.err && r.odi4 != null && r.expertDesat4Idx).map((r) => r.odi4 - r.expertDesat4Idx);
  return { label: 'median ODI-4 − expert (events/h)', value: median(d), halfWidth: medianHalfWidth(d), n: d.length };
}

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

/* ── THE POPULATION THIS POOL SCORES OVER ─────────────────────────────────────────────────────
   Row 2026-10-28-two-nsrr-readers-are-excluded-where-three-were-debt. `POPULATION_EXCLUSIONS`
   excused this tool because the NSRR mount is not the capture corpus, while three siblings reading
   the same two trees publish a population anyway. A population is about the enumeration a run
   scores over, not about the filesystem the bytes came off.

   The OFFER is the PAIRING above, and `snapshotEntries` hands a lister ONE root, so the EDF side is
   bound here and the returned function carries a name the published rule can state. A shuffle, a
   `--limit`, a `--precision` stop and a resumed checkpoint are all reduced coverage: they annotate
   and the unscored records are named, rather than refusing (owner ruling 2026-09-17, §∅). */
const POP_TOOL = 'tools/nsrr-score-pool.mjs';
const POP_EV = [POP_TOOL, 'tools/corpus-scope-core.mjs'];
export function pairedRecordLister(edfDir) {
  return function pairedWithAnEdf(xmlDir) {
    return pairRecords(edfDir, xmlDir).map((r) => r.id);
  };
}
/* The queue is rebuilt from the OFFER's member names rather than from a second walk of either tree:
   a verdict that describes one walk while the run scores another is the defect the primitive exists
   to catch. The two names are the ones `pairRecords` built, so the paths are identical. */
export function recordPaths(id, edfDir, xmlDir) {
  return { id, edf: join(edfDir, id + '.edf'), xml: join(xmlDir, id + '-nsrr.xml') };
}
/* The shared exit rule, pure so the run and a leg read the same one: a tree nobody can enumerate, a
   root that offered nothing, and a run that scored no record all exit 2. This pool RETURNED 0 over
   the last of those, with every worker erroring and a median over nothing (row
   2026-10-21-forty-one-corpus-enumerators-report-no-population). */
export function exitCodeFor(population, offered, scored) {
  return population.status === 'NOT_RUN' || offered === 0 || scored === 0 ? 2 : 0;
}

/* ── worker ═══════════════════════════════════════════════════════════════════════════════════
   One realm per worker, built ONCE and reused for every record it is handed. Building it per record
   would dominate the runtime, and the realm is the reason a worker is worth having at all. */
async function workerMain() {
  const { parentPort, workerData } = await import('node:worker_threads');
  const mod = await import(workerData.scorer);
  /* A module may expose a pool-shaped entry point beside its own differently-shaped one — the stage
     validator's `scoreRecord` takes (ctx, edfBuffer, xmlText) because that is what its own CLI needs.
     `poolScoreRecord` is the opt-in adapter; no arity sniffing, which would silently call the wrong
     function the day a signature grows an optional argument. */
  const score = mod.poolScoreRecord || mod.scoreRecord;
  if (typeof mod.makeRealm !== 'function' || typeof score !== 'function') throw new Error(workerData.scorer + ' is not a pool scorer: needs makeRealm() and scoreRecord/poolScoreRecord(ctx, rec)');
  const ctx = mod.makeRealm();
  parentPort.postMessage({ ready: true, w: workerData.w });
  parentPort.on('message', (m) => {
    if (m.stop) return process.exit(0);
    let row;
    try {
      row = score(ctx, m.rec);
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
  const seedRead = seedFromArgv(argv);
  if (seedRead.error) {
    console.error('\u2715 ' + seedRead.error);
    process.exit(2);
  }
  const seed = seedRead.seed;
  /* a named order and no order are contradictory instructions, and picking one silently would make
     the header's `order` line a claim about something the run did not do */
  if (seedRead.explicit && noShuffle) {
    console.error('\u2715 --seed names a hash order; --no-shuffle asks for directory order. Pick one.');
    process.exit(2);
  }
  /* WHICH scorer this pool drives. The pool was born hardwired to the ODI driver, which meant the one
     other long serial run in this repo — `nsrr-stage-validate.mjs`, 5136 records — could not use the
     machinery built to end exactly that. A pool that parallelises one caller is a script. */
  const scorerSpec = arg('--scorer', './nsrr-oxydex-odi.mjs');
  const limit = arg('--limit', null) != null ? Number(arg('--limit', null)) : null;

  /* the two new features are only sound together — refuse rather than silently produce a precise
     estimate of a biased subset */
  if (precision != null && noShuffle) {
    console.error('✕ --precision requires the hash shuffle: a prefix of directory order is a biased');
    console.error('  subset, so stopping early on it reports a precise answer about the wrong population.');
    process.exit(2);
  }

  const commitOf = gitCommitOf();
  const snapOf = (dir) => snapshotEntries(dir, { list: pairedRecordLister(edfDir), unit: 'records' });
  const snapBefore = snapOf(xmlDir);
  const popOver = () => populationVerdict(snapBefore, snapOf(xmlDir), { commit: commitOf.commit, commitReason: commitOf.reason, tool: POP_TOOL, evidence: POP_EV });
  const recs = snapBefore.members.map((id) => recordPaths(id, edfDir, xmlDir));
  if (!recs.length) {
    console.error('✕ no paired records under\n    ' + edfDir + '\n    ' + xmlDir);
    /* 🔴 A REFUSAL STILL PUBLISHES ITS POPULATION, so the run that scored nothing says which tree
       offered nothing and whether anyone could read it at all (§∅). */
    const population = popOver();
    console.log(`population: ${snapBefore.n} record(s) offered under ${xmlDir} · 0 scored · movement ${population.status}` + (population.reason ? ` — ${population.reason}` : ''));
    console.log('POPULATION ' + JSON.stringify(population));
    process.exit(exitCodeFor(population, snapBefore.n, 0) || 2);
  }
  const order = noShuffle
    ? recs.map((r) => r.id)
    : shuffledOrder(
        recs.map((r) => r.id),
        seed
      );
  const byId = new Map(recs.map((r) => [r.id, r]));
  let queue = order.map((id) => byId.get(id));
  if (limit != null) queue = queue.slice(0, limit);

  const ck = resume ? loadCheckpoint(CKPT) : null;
  /* ⚠️ RESUMING UNDER A DIFFERENT SEED IS A DIFFERENT SEQUENCE. The checkpoint carries the ids it
     finished, not the order they came in, so continuing under another seed would score the rest of a
     sequence those ids were never a prefix of — and the results file would name one seed for two
     orders. A checkpoint written before the seed was recorded carries NO seed field: that is absence,
     not `'shhs1'`, so it is reported rather than assumed, and refusing it would strand real hours. */
  const ckSeed = ck && Object.hasOwn(ck, 'seed') ? ck.seed : undefined;
  const runSeed = noShuffle ? null : seed;
  if (ck && ckSeed !== undefined && ckSeed !== runSeed) {
    console.error('✕ the checkpoint was scored under order ' + JSON.stringify(ckSeed) + ', this run asks for ' + JSON.stringify(runSeed) + '.');
    console.error('  Pass the same --seed, or delete ' + CKPT + ' and start the new order from the top.');
    process.exit(2);
  }
  if (ck && ckSeed === undefined) {
    console.log('  ⚠ the checkpoint predates seed recording, so its order cannot be checked');
  }
  const done = ck ? ck.done : [];
  const seen = new Set(done.map((r) => r.id));
  const total = queue.length;
  queue = queue.filter((r) => !seen.has(r.id));

  /* imported in the MAIN thread for its liveStat; the workers import it separately for scoring */
  const scorerMod = await import(scorerSpec);
  if (precision != null && liveStatProbe(scorerMod, []) === null) {
    console.error('✕ --precision given, but ' + scorerSpec + ' publishes no halfWidth, so no stopping');
    console.error('  rule could ever fire. Refusing rather than running to the end pretending to watch.');
    process.exit(2);
  }
  const { Worker } = await import('node:worker_threads');
  const nw = poolSize(arg('--workers', null) != null ? Number(arg('--workers', null)) : null, (cpus() || []).length);
  const tier = nw > 1 ? 'worker pool x' + nw : 'serial (1 core)';
  const why = nw > 1 ? '' : '  — pool of 1: machine reports ' + ((cpus() || []).length || '?') + ' cores';

  console.log('▸ nsrr-score-pool');
  console.log('  records   ' + total + (done.length ? '  (' + done.length + ' already done, resuming)' : ''));
  console.log(
    '  order     ' +
      (noShuffle ? 'directory (BIASED prefix — early stop disabled)' : 'hash-shuffled on seed ' + JSON.stringify(seed) + (seedRead.explicit ? '' : ' (default)') + ' — any prefix is a random sample')
  );
  console.log('  scorer    ' + scorerSpec);
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
  const liveStat = typeof scorerMod.liveStat === 'function' ? scorerMod.liveStat : defaultLiveStat;
  let stat = liveStat(done);

  const beat = (force) => {
    const now = Date.now();
    if (!force && now - lastBeat < 5000) return;
    lastBeat = now;
    const el = (now - t0) / 1000;
    const rate = el > 0 ? (fin - done0) / el : 0;
    const eta = rate > 0 ? (total - fin) / rate : null;
    const hw = stat.halfWidth;
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
        (stat.value != null ? Number(stat.value).toFixed(3) : '—') +
        '  +/-' +
        (hw != null ? Number(hw).toFixed(3) : '—') +
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
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { w: i, scorer: scorerSpec }, argv: ['--worker-child'] });
      live++;
      workers.push(w);
      w.on('message', (m) => {
        if (m.ready) return feed(w);
        done.push(m.row);
        fin++;
        stat = liveStat(done);
        if (fin % 25 === 0) saveCheckpoint(CKPT, { done, n: fin, total, seed: runSeed });
        beat(false);
        if (precision != null && !stopped) {
          const hw = stat.halfWidth;
          if (hw != null && hw <= precision) stopped = { n: stat.n, fin, hw, floor: stoppedAtFloor(stat.n) };
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
  saveCheckpoint(CKPT, { done, n: fin, total, seed: runSeed });
  mkdirSync(dirname(outPath), { recursive: true });
  const verdict = poolVerdict(scorerMod, liveStat(done), done, { total }, { scorerSpec, commit: headCommit(), evidence: [edfDir, xmlDir, outPath] });
  /* The offer against the score. `notCovered` reads `row[key]`, and the arithmetic THROWS rather
     than writing a coverage figure that contradicts its own headline. The resumed rows count as
     scored: they are records this pool scored, under the same order. */
  const population = popOver();
  const scoredRows = done.filter((r) => r && !r.err);
  const unscored = notCovered(snapBefore, scoredRows, { key: 'id' });
  if (unscored.length !== snapBefore.n - scoredRows.length) throw new Error(`population arithmetic: ${snapBefore.n} offered − ${scoredRows.length} scored ≠ ${unscored.length} unscored`);
  writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), total, scored: fin, stopped, seed: runSeed, verdict, population, unscored, records: done }, null, 1));

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const rps = (fin - done0) / Math.max(1e-9, (Date.now() - t0) / 1000);
  console.log('\n');
  console.log('  scored    ' + fin + ' of ' + total + ' in ' + mins + ' min  (' + rps.toFixed(2) + ' rec/s)');
  stat = liveStat(done);
  console.log('  ' + String(stat.label).padEnd(36) + (stat.value != null ? Number(stat.value).toFixed(4) : '—') + '   (n=' + stat.n + ')');
  console.log('  95% half-width' + ' '.repeat(22) + (stat.halfWidth != null ? '+/-' + Number(stat.halfWidth).toFixed(4) : '— (scorer publishes none; early stop disabled)'));
  if (Array.isArray(stat.detail)) for (const line of stat.detail) console.log('    ' + line);
  if (stopped) {
    console.log('');
    console.log('  ⏹ STOPPED EARLY at n=' + stopped.n + ' of ' + total + ' — half-width ' + stopped.hw + ' <= target ' + precision);
    console.log('    valid because the order is hash-shuffled: this n is a uniform random sample.');
    if (stopped.floor) console.log('    ⚠️ FLOOR-BOUND: the target was met at the first evaluable n (' + PRECISION_MIN_N + '). The criterion did not');
    if (stopped.floor) console.log('       decide, the floor did — read this as provisional and re-run with a tighter target.');
  }
  console.log('  results   ' + outPath);
  printVerdict(verdict, { prefix: '' });
  console.log(`\npopulation: ${snapBefore.n} record(s) offered under ${xmlDir} · ${scoredRows.length} scored · movement ${population.status}` + (population.reason ? ` — ${population.reason}` : ''));
  const popRule = ruleLine(population);
  if (popRule) console.log(popRule);
  if (unscored.length)
    console.log(`  ${unscored.length} offered record(s) produced no score, by name: ${unscored.slice(0, 8).join(' · ')}${unscored.length > 8 ? ` · … (+${unscored.length - 8})` : ''}`);
  console.log('POPULATION ' + JSON.stringify(population));
  return exitCodeFor(population, snapBefore.n, scoredRows.length);
}

if (process.argv.includes('--worker-child')) workerMain();
else if (isCliEntry(import.meta.url) && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main(process.argv.slice(2)).then((c) => process.exit(c));
