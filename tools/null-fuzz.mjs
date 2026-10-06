#!/usr/bin/env node
/*
 * null-fuzz.mjs — null-injection fuzzer for the DSP absence contract
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fuzzes OxyDex's processNight with random dropout patterns and asserts the
 * §∅ contract: STATISTICS ARE COMPUTED OVER MEASURED SAMPLES, NEVER OVER
 * ABSENT ONES (oxydex-dsp.js:3158–3176).
 *
 * Two properties:
 *   P1 (no fabrication): an all-null signal yields null metrics, never
 *       0 / NaN / ±Infinity / finite fabrications.
 *   P2 (nulls are ignored, not zeroed): for order-independent point
 *       statistics, metric(fuzzed rows) === metric(clean rows) where clean
 *       is the fuzzed night with null rows removed. A null must behave like
 *       a missing row, never like a 0 reading.
 *
 * Long-run operation (TOOL-BUILD-STANDARD §2):
 *   --seeds N        seeds to run from --seed-start (default 1)
 *   --seed-start N   first seed (default: random); seeds are independent units,
 *                    so ranges shard across machines with no coordination
 *   --iters N        fuzzed nights per seed (default 50)
 *   --len N          samples per night (default 900)
 *   --out FILE       results bundle JSON (default null-fuzz-<start>.json).
 *                    Accumulates every failure; the bundle IS the checkpoint.
 *   --resume         resume from --out: completed seeds are skipped, failures
 *                    already recorded are kept. Kill -9 mid-run, then rerun
 *                    with --resume for 0 duplicates, 0 re-run seeds.
 *   --heartbeat SEC  progress line to stderr every SEC (default 30). Survives
 *                    redirection; a silent run is indistinguishable from hung.
 *   --quiet          failures go to the bundle only, not stdout (token-saving)
 *
 *   Example overnight soak, shardable:
 *     node tools/null-fuzz.mjs --seed-start 1 --seeds 200 --iters 50 --quiet \
 *       --out /tmp/fuzz-a.json &
 *     node tools/null-fuzz.mjs --seed-start 201 --seeds 200 --iters 50 --quiet \
 *       --out /tmp/fuzz-b.json &
 *
 * Exit 0 = no fabrication in the seeds run. Exit 1 = fabrication found (see
 * bundle). Exit 2 = load/setup error.
 *
 * §2.11 declarations: single process, no workers — SIGKILL terminates cleanly
 * and the checkpoint is always consistent (§2.3 trivially satisfied). No GPU:
 * the workload is serial processNight calls (~1.1 s each, pure JS, no dense
 * kernel); the parallel unit is the seed, sharded across processes/machines
 * (§2.6 — measured 2026-10-06, n=30 iters: 1.08 s/iter mean, 0.97–1.24 range).
 * Single-purpose: OxyDex only; the shape ports to other Dexes as separate work
 * (§2.9). §2.1 search 2026-10-06: no prior null-fuzz work in repo.
 *
 * Zero npm dependencies. Loads the real DSP via node:vm, same as
 * tests/run-tests.mjs.
 */
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const DexBuild = require(join(ROOT, 'tools', 'build-core.js'));

/* ── CLI ── */
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const m = args.find((a) => a.startsWith('--' + name + '='));
  if (m) return m.split('=').slice(1).join('=');
  const i = args.indexOf('--' + name);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) return args[i + 1];
  return dflt;
};
const has = (name) => args.includes('--' + name);
const SEED_START = Number(opt('seed-start', opt('seed', (Math.random() * 0xffffffff) >>> 0)));
const SEEDS = Number(opt('seeds', 1));
const ITERS = Number(opt('iters', 50));
const LEN = Number(opt('len', 900));
const HEARTBEAT_SEC = Number(opt('heartbeat', 30));
const QUIET = has('--quiet');
const RESUME = has('--resume');
const OUT = opt('out', `null-fuzz-${SEED_START}.json`);
const OUT_PATH = OUT.startsWith('/') ? OUT : join(process.cwd(), OUT);

/* ── checkpoint / bundle (§2.2: atomic, carries results, discard if corrupt) ── */
function blankBundle() {
  return {
    tool: 'null-fuzz.mjs', version: 2,
    seed_start: SEED_START, seeds: SEEDS, iters: ITERS, len: LEN,
    started_at: new Date().toISOString(), updated_at: null,
    completed_seeds: [], failures: [],
    stats: { iters_run: 0, ms_total: 0 },
    summary: null,
  };
}
let bundle = blankBundle();
if (RESUME && existsSync(OUT_PATH)) {
  try {
    const raw = readFileSync(OUT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.tool === 'null-fuzz.mjs' && Array.isArray(parsed.completed_seeds)) {
      bundle = parsed;
      bundle.started_at = bundle.started_at || new Date().toISOString();
    } else {
      console.error(`checkpoint unparseable or foreign — starting fresh (discarded ${OUT_PATH})`);
    }
  } catch {
    console.error(`checkpoint unreadable — starting fresh (discarded ${OUT_PATH})`);
  }
}
function saveBundle() {
  bundle.updated_at = new Date().toISOString();
  const tmp = OUT_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(bundle, null, 1));
  renameSync(tmp, OUT_PATH); // atomic: readers never see a half-write
}
const fail = (entry) => {
  seedFailures.push(entry); // buffered; merged into bundle only on seed completion (§2.2: no duplicates on resume)
  if (!QUIET) console.log(`FAIL ${entry.property} seed=${entry.seed} iter=${entry.iter}: ${entry.metric} fuzzed=${JSON.stringify(entry.fuzzed)} clean=${JSON.stringify(entry.clean)}${entry.note ? ' ' + entry.note : ''}`);
};
let seedFailures = [];

/* ── seeded RNG ── */
let _s = 0;
function reseed(seed) { _s = seed >>> 0; }
function rnd() {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/* ── load DSP ── */
function makeSandbox() {
  const noop = () => {};
  const sandbox = {};
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.document = {
    getElementById: () => null, createElement: () => ({ style: {} }),
    querySelector: () => null, querySelectorAll: () => [],
    head: {}, body: {}, documentElement: { outerHTML: '' }, addEventListener: noop
  };
  sandbox.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
  sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  return vm.createContext(sandbox);
}
const ctx = makeSandbox();
for (const f of ['kernel-constants.js', 'clock.js', 'oxydex-util.js', 'oxydex-dsp.js']) {
  vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
}
const OD = (ctx.OxyDex && ctx.OxyDex._bare) || ctx.OxyDex;
if (!OD || typeof OD.processNight !== 'function') {
  console.error('FATAL: OxyDex.processNight not reachable');
  process.exit(2);
}

/* ── night generator ── */
const T0 = Date.UTC(2026, 0, 1, 22, 0, 0);
function mkNight() {
  const rows = [];
  for (let i = 0; i < LEN; i++) {
    const dip = rnd() < 0.06 ? rint(3, 6) : 0;
    const spo2 = Math.max(88, Math.min(100, 96 + rint(-2, 2) - dip));
    const hr = Math.max(45, Math.min(100, 62 + rint(-6, 6)));
    rows.push({ tMs: T0 + i * 1000, t: new Date(T0 + i * 1000), spo2, hr, motion: 0 });
  }
  const blocks = rint(1, 3);
  for (let b = 0; b < blocks; b++) {
    const start = rint(0, LEN - 1);
    const len = rint(30, Math.min(400, LEN - start));
    for (let i = start; i < start + len && i < LEN; i++) {
      // Coupled nulls: the whole row drops, so the clean night carries exactly
      // the fuzzed night's measured multiset for both signals.
      rows[i].spo2 = null;
      rows[i].hr = null;
    }
  }
  return rows;
}
function cleanRows(rows) {
  const out = [];
  for (const r of rows) {
    if (r.spo2 != null) out.push({ tMs: T0 + out.length * 1000, t: new Date(T0 + out.length * 1000), spo2: r.spo2, hr: r.hr, motion: 0 });
  }
  return out;
}
function allNullRows() {
  const rows = [];
  for (let i = 0; i < LEN; i++) rows.push({ tMs: T0 + i * 1000, t: new Date(T0 + i * 1000), spo2: null, hr: null, motion: 0 });
  return rows;
}

/* ── metric extractors (order-independent point statistics) ── */
function getMetrics(out) {
  const st = out.stats || {};
  const desat = out.desat || {};
  const adv = out.spo2Adv || {};
  return {
    meanSpo2: st.meanSpo2, minSpo2: st.minSpo2, maxSpo2: st.maxSpo2, spo2Std: st.spo2Std,
    t95pct: st.t95pct, t90pct: st.t90pct,
    auc90Total: desat.auc90Total, auc90Rate: desat.auc90Rate,
    spo2IQR: adv.spo2IQR, condMeanBelow94: adv.condMeanBelow94, condPctBelow94: adv.condPctBelow94,
  };
}
const isFabricated = (v) =>
  v !== null && v !== undefined && (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v) || v !== 0);
const same = (a, b) => {
  if (a === null && b === null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return false;
};

/* ── run ── */
const tRunStart = Date.now();
let lastBeat = 0;
function heartbeat(force) {
  const now = Date.now();
  if (!force && now - lastBeat < HEARTBEAT_SEC * 1000) return;
  lastBeat = now;
  const seedsDone = bundle.completed_seeds.length;
  const itersDone = bundle.stats.iters_run;
  const itersTotal = SEEDS * ITERS;
  const elapsed = (now - tRunStart) / 1000;
  const rate = itersDone / Math.max(elapsed, 0.001);
  const eta = rate > 0 ? Math.max(0, (itersTotal - itersDone) / rate) : Infinity;
  const etaStr = !isFinite(eta) ? '?' : eta < 90 ? `${eta.toFixed(0)}s` : `${(eta / 60).toFixed(1)}m`;
  const failuresSoFar = bundle.failures.length + seedFailures.length;
  // §2.4: real running values — seeds, iters, rate, ETA, failures so far. Never a placeholder.
  console.error(
    `null-fuzz: seeds ${seedsDone}/${SEEDS} iters ${itersDone}/${itersTotal} ` +
    `${rate.toFixed(1)}/s ETA ${etaStr} failures ${failuresSoFar} → ${OUT_PATH}`
  );
}

console.error(`null-fuzz v2: seeds ${SEED_START}..${SEED_START + SEEDS - 1} iters=${ITERS} len=${LEN} out=${OUT_PATH}${RESUME ? ' (resume)' : ''}${QUIET ? ' (quiet)' : ''}`);

for (let s = 0; s < SEEDS; s++) {
  const seed = SEED_START + s;
  if (bundle.completed_seeds.includes(seed)) continue; // §2.2: skip completed units on resume
  reseed(seed);
  seedFailures = [];

  // P1: all-null night → core stats must be null
  {
    const t0 = Date.now();
    const out = getMetrics(OD.processNight(allNullRows(), 'allnull.csv'));
    bundle.stats.ms_total += Date.now() - t0;
    for (const k of ['meanSpo2', 'minSpo2', 'maxSpo2', 'spo2Std']) {
      if (out[k] !== null) fail({ property: 'P1', seed, iter: -1, metric: k, fuzzed: out[k], clean: null, note: 'all-null night, want null' });
    }
    for (const k of ['auc90Total', 'spo2IQR', 'condMeanBelow94', 'condPctBelow94']) {
      if (isFabricated(out[k])) fail({ property: 'P1', seed, iter: -1, metric: k, fuzzed: out[k], clean: null, note: 'all-null night, fabricated' });
    }
  }

  // P2: fuzzed === clean for point statistics
  for (let it = 0; it < ITERS; it++) {
    const fuzzed = mkNight();
    const clean = cleanRows(fuzzed);
    if (clean.length < 10) { it--; continue; }
    const t0 = Date.now();
    let fz, cl;
    try {
      fz = getMetrics(OD.processNight(fuzzed, 'fz.csv'));
      cl = getMetrics(OD.processNight(clean, 'cl.csv'));
    } catch (e) {
      fail({ property: 'P2', seed, iter: it, metric: '(threw)', fuzzed: String(e.message), clean: null, note: 'processNight threw' });
      continue;
    } finally {
      bundle.stats.ms_total += Date.now() - t0;
      bundle.stats.iters_run++;
    }
    const nulls = fuzzed.filter((r) => r.spo2 == null).length;
    for (const k of Object.keys(fz)) {
      if (!same(fz[k], cl[k])) {
        fail({ property: 'P2', seed, iter: it, metric: k, fuzzed: fz[k], clean: cl[k], note: `nulls=${nulls}/${LEN}` });
      }
    }
    heartbeat(false);
  }

  bundle.completed_seeds.push(seed);
  for (const f of seedFailures) bundle.failures.push(f); // merge only on completion
  seedFailures = [];
  saveBundle(); // §2.2: atomic checkpoint per completed unit
  heartbeat(true);
}

/* ── final bundle ── */
const msPerIter = bundle.stats.iters_run ? bundle.stats.ms_total / bundle.stats.iters_run : 0;
bundle.summary = {
  seeds_run: bundle.completed_seeds.length,
  iters_run: bundle.stats.iters_run,
  failures: bundle.failures.length,
  ms_per_iter: +msPerIter.toFixed(1),
  verdict: bundle.failures.length === 0 ? 'CLEAN' : 'FABRICATION-FOUND',
};
saveBundle();

heartbeat(true);
console.error(`null-fuzz done: ${bundle.summary.verdict} — ${bundle.failures.length} failures across ${bundle.summary.seeds_run} seeds, bundle at ${OUT_PATH}`);
process.exit(bundle.failures.length === 0 ? 0 : 1);
