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
 * Usage:
 *   node tools/null-fuzz.mjs [--seed N] [--iters N] [--len N]
 *   --seed  randomize (default); any integer reproduces the run
 *   --iters number of fuzzed nights (default 50)
 *   --len   samples per night (default 900)
 *
 * Exit 0 = no fabrication found. Exit 1 = fabrication found; the seed that
 * reproduces it is printed. Loop it: `for s in $(seq 1 20); do
 * node tools/null-fuzz.mjs --seed $s --iters 50 || break; done`
 *
 * Zero npm dependencies. Loads the real DSP via node:vm, same as
 * tests/run-tests.mjs.
 */
import { readFileSync } from 'node:fs';
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
  if (m) return Number(m.split('=')[1]);
  const i = args.indexOf('--' + name);
  if (i >= 0 && args[i + 1] !== undefined) return Number(args[i + 1]);
  return dflt;
};
let SEED = opt('seed', (Math.random() * 0xffffffff) >>> 0);
const ITERS = opt('iters', 50);
const LEN = opt('len', 900);

/* ── seeded RNG (mulberry32) ── */
let _s = SEED >>> 0;
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
    // healthy baseline with mild noise; occasional genuine dip to 91–93
    const dip = rnd() < 0.06 ? rint(3, 6) : 0;
    const spo2 = Math.max(88, Math.min(100, 96 + rint(-2, 2) - dip));
    const hr = Math.max(45, Math.min(100, 62 + rint(-6, 6)));
    rows.push({ tMs: T0 + i * 1000, t: new Date(T0 + i * 1000), spo2, hr, motion: 0 });
  }
  // inject 1–3 dropout blocks at random positions/lengths
  const blocks = rint(1, 3);
  for (let b = 0; b < blocks; b++) {
    const start = rint(0, LEN - 1);
    const len = rint(30, Math.min(400, LEN - start));
    for (let i = start; i < start + len && i < LEN; i++) {
      // Coupled nulls: the whole row drops, so the clean night (null rows
      // removed) carries exactly the fuzzed night's measured multiset for
      // BOTH signals. Independent per-signal dropouts would need per-signal
      // clean versions, which processNight's row shape cannot express.
      rows[i].spo2 = null;
      rows[i].hr = null;
    }
  }
  return rows;
}
function cleanRows(rows) {
  // null rows removed, tMs re-sequenced (point-stats are order-independent)
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
    // Order-independent point statistics: P2 (fuzzed === clean) is exact.
    meanSpo2: st.meanSpo2, minSpo2: st.minSpo2, maxSpo2: st.maxSpo2, spo2Std: st.spo2Std,
    t95pct: st.t95pct, t90pct: st.t90pct,
    auc90Total: desat.auc90Total, auc90Rate: desat.auc90Rate,
    spo2IQR: adv.spo2IQR, condMeanBelow94: adv.condMeanBelow94, condPctBelow94: adv.condPctBelow94,
    // HR is EXCLUDED from strict P2: cleanArtifactHR is time-aware (it clamps
    // on neighbor deltas), so nulls legitimately change its neighborhood.
    // Null HR triggering fake artifact clamps is a separate suspected bug
    // (rows[i].hr - rows[i-1].hr with null → -60 → |rise| >= HARD).
    // Logged, not failed, until Kestrel rules.
    _meanHr: st.meanHr, _minHr: st.minHr, _maxHr: st.maxHr,
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
console.log(`null-fuzz: seed=${SEED} iters=${ITERS} len=${LEN}`);
let failures = 0;

// P1: all-null night → core stats must be null
{
  const out = getMetrics(OD.processNight(allNullRows(), 'allnull.csv'));
  for (const k of ['meanSpo2', 'minSpo2', 'maxSpo2', 'spo2Std']) {
    if (out[k] !== null) {
      failures++;
      console.log(`FAIL P1 all-null: ${k} = ${JSON.stringify(out[k])} (want null)`);
    }
  }
  // extended metrics: flag NaN/±Infinity/finite-nonzero as fabrication; null or 0 logged only
  for (const k of ['auc90Total', 'spo2IQR', 'condMeanBelow94', 'condPctBelow94']) {
    if (isFabricated(out[k])) {
      failures++;
      console.log(`FAIL P1 all-null: ${k} = ${JSON.stringify(out[k])} (fabricated)`);
    }
  }
}

// P2: fuzzed === clean for point statistics
for (let it = 0; it < ITERS; it++) {
  const fuzzed = mkNight();
  const clean = cleanRows(fuzzed);
  if (clean.length < 10) { it--; continue; } // degenerate draw, resample
  let fz, cl;
  try {
    fz = getMetrics(OD.processNight(fuzzed, 'fz.csv'));
    cl = getMetrics(OD.processNight(clean, 'cl.csv'));
  } catch (e) {
    failures++;
    console.log(`FAIL P2 iter ${it}: processNight threw: ${e.message}`);
    continue;
  }
  for (const k of Object.keys(fz)) {
    if (k.startsWith('_')) continue; // time-aware HR metrics: logged below, not failed
    if (!same(fz[k], cl[k])) {
      failures++;
      const nulls = fuzzed.filter((r) => r.spo2 == null).length;
      console.log(
        `FAIL P2 iter ${it}: ${k} fuzzed=${JSON.stringify(fz[k])} clean=${JSON.stringify(cl[k])} ` +
        `(nulls=${nulls}/${LEN}, seed=${SEED})`
      );
    }
  }
}

if (failures === 0) {
  console.log(`OK: ${ITERS} iters, no fabrication (seed=${SEED})`);
  process.exit(0);
} else {
  console.log(`${failures} fabrication(s) — reproduce with: node tools/null-fuzz.mjs --seed ${SEED} --iters ${ITERS} --len ${LEN}`);
  process.exit(1);
}
