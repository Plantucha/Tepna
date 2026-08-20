#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * hostaxis-estimator-bakeoff.mjs — is a SYMMETRIC filter the right shape for
 * a ONE-SIDED error?
 *
 * WHY THIS EXISTS AT ALL. `DexClock.hostAxis` smooths host−device divergence
 * with a running median of width 21. CLAUDE.md §7 records how that width was
 * chosen — "planted recovery against ±100 ms jitter on real geometry (9 → 77 ms
 * worst, 21 → 57, 41 → 168, 81 → 245)" — but THE HARNESS THAT PRODUCED THOSE
 * NUMBERS IS NOT IN THE REPOSITORY. They are prose. Nobody can re-run them,
 * which means nobody can score a challenger against them either. That is the
 * repo's own recurring failure shape (a result that cannot be reproduced is not
 * yet evidence), and it is the first thing this tool fixes: the sweep is now
 * committed and re-runnable.
 *
 * THE SUBSTANTIVE CLAIM. The planted noise in that experiment was SYMMETRIC
 * (±100 ms). Real BLE delivery jitter is NOT: a packet can arrive late, never
 * early. The contamination is a non-negative additive term, so the divergence
 * distribution is skewed, and a median — which assumes symmetry — throws away
 * the cleanest half of the data. Network time transfer has known this since the
 * 1980s: NTP's clock filter keeps a sliding window and selects the sample of
 * MINIMUM DELAY, because "as the delay increases, the offset variation
 * increases, so the best samples are those at the lowest delay."
 *   → https://www.ntp.org/documentation/4.2.8-series/filter/
 *
 * AND THIS REPO ALREADY AGREES WITH ITSELF, IN THE OTHER LANE.
 * `capture-host/clock_offset.py` implements Moon et al.'s lower-envelope LP and
 * PAXSON'S ESTIMATOR (partition into subsets, take each subset's MINIMUM, then a
 * robust slope through the minima) — and its own docstring cross-references
 * `hostAxis` while doing it. A one-sided estimator was adopted in Python and
 * never propagated to the JS spine. Same shape as the Allan core living in two
 * places until #1232.
 *
 * WHAT IS AND IS NOT BEING PROPOSED. `hostAxis` INTERPOLATES measured divergence
 * and deliberately does not FIT (Clock Contract §7: a fit re-introduces "one ppm
 * describes the night", and the real O2Ring error is non-linear). So the part
 * borrowed from Paxson is the PER-SUBSET MINIMUM feeding the existing
 * interpolation — NOT the Theil–Sen slope. `clock_offset.py` also records why it
 * fits at all ("a minimum has NO TIME MODEL"); here the time model is the
 * interpolation that is already there.
 *
 * METHOD. Real anchor GEOMETRY (count + spacing) is read from a Polar Sensor
 * Logger file; its real divergence is DISCARDED and a known drift is planted, so
 * recovery error is exactly measurable. Both noise models are run, because the
 * honest result may be that the median is right under one and wrong under the
 * other — that is the question, not a foregone conclusion.
 *
 * USAGE
 *   node tools/hostaxis-estimator-bakeoff.mjs [--file <PSL *_ECG.txt>] [--trials 12]
 *   DEX_PSL=<dir> node tools/hostaxis-estimator-bakeoff.mjs
 * ════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── the shipped spine, in a co-loaded realm (the geometry-scan.mjs pattern) ── */
async function loadSpine() {
  const DexBuild = await import(path.join(ROOT, 'tools/build-core.js')).catch(() => null);
  const classicify = DexBuild?.classicify || DexBuild?.default?.classicify || ((s) => s);
  const ctx = vm.createContext({ console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String, Array, Object, Float64Array, Infinity, NaN });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(classicify(fs.readFileSync(path.join(ROOT, 'clock.js'), 'utf8')), ctx, { filename: 'clock.js' });
  if (!ctx.DexClock || typeof ctx.DexClock.hostAxis !== 'function') throw new Error('clock.js did not expose DexClock.hostAxis');
  return ctx.DexClock;
}

/* ── deterministic RNG. Math.random() would make a bakeoff unreproducible, and an
      unreproducible bakeoff is the exact defect this tool was written to fix. ── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => {
  let u = 0, v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ── real anchor geometry from a Polar Sensor Logger export ────────────────── */
function readGeometry(file, maxAnchors = 3000) {
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  const head = (lines[0] || '').split(';').map((s) => s.trim().toLowerCase());
  const iPhone = head.indexOf('phone timestamp');
  const iSensor = head.findIndex((h) => h.startsWith('sensor timestamp'));
  if (iPhone < 0 || iSensor < 0) throw new Error(`no two-clock columns in ${path.basename(file)}`);
  const devNs = [], hostMs = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (c.length <= Math.max(iPhone, iSensor)) continue;
    const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?/.exec(c[iPhone].trim());
    const ns = Number(c[iSensor]);
    if (!m || !Number.isFinite(ns)) continue;
    // Clock Contract §1: floating wall-clock ms via Date.UTC on the components as written.
    hostMs.push(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0));
    devNs.push(ns);
  }
  if (devNs.length < 100) throw new Error(`too few parsable rows in ${path.basename(file)}`);
  // Anchors are sampled across the record; hostAxis consumes anchor PAIRS, not every row.
  const step = Math.max(1, Math.floor(devNs.length / maxAnchors));
  const devMs = [], host = [];
  for (let i = 0; i < devNs.length; i += step) {
    devMs.push((devNs[i] - devNs[0]) / 1e6);
    host.push(hostMs[i] - hostMs[0]);
  }
  return { devMs, host, rows: devNs.length, file: path.basename(file) };
}

/* ── the planted truth: a NON-LINEAR drift, because the real O2Ring error is
      non-linear (−3035 ppm decaying to −1622) and a linear plant would flatter
      every estimator equally and prove nothing about curvature tracking. ────── */
function plantedDrift(tMs, spanMs, ppmStart, ppmEnd) {
  const f = spanMs > 0 ? tMs / spanMs : 0;
  const ppm = ppmStart + (ppmEnd - ppmStart) * (1 - Math.exp(-3 * f)) / (1 - Math.exp(-3));
  let v = (ppm * 1e-6) * tMs;
  /* A real clock STEP at mid-record. Without it the plant is smooth and slowly
     varying, so a wider window is monotonically better and the sweep degenerates
     into "pick the widest" — which is NOT what CLAUDE.md §7 recorded (41 → 168,
     81 → 245, i.e. wide is WORSE). A smooth-only plant cannot reproduce that
     ordering and therefore cannot fairly score width at all. §7 also states
     `maxStepMs` exists precisely to surface a step rather than smear it into a
     slope, so a step is the feature the smoother must NOT flatten. */
  if (f > 0.5) v += 250;
  return v;
}

/* ── noise models ──────────────────────────────────────────────────────────
   symmetric : what the width-21 experiment planted (±100 ms uniform)
   oneSided  : what BLE actually does — delay ADDS, never subtracts. Exponential
               body (~20 ms) plus a rare large stall, matching §7's "~0.1 s, up to
               470 ms observed". */
const NOISE = {
  symmetric: (rnd) => (rnd() * 2 - 1) * 100,
  oneSided: (rnd) => {
    const base = -Math.log(1 - rnd()) * 20;
    return rnd() < 0.02 ? base + 300 + rnd() * 200 : base;
  }
};

/* ── estimators. All share the SAME windowing so only the statistic differs. ── */
const median = (w) => {
  const s = w.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (w, p) => {
  const s = w.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const ESTIMATORS = {
  'median': (w) => median(w),
  'min': (w) => Math.min(...w),
  'q10': (w) => quantile(w, 0.1),
  'q25': (w) => quantile(w, 0.25)
};

function smooth(raw, win, stat) {
  const n = raw.length, out = new Array(n), half = win >> 1;
  for (let k = 0; k < n; k++) {
    const lo = Math.max(0, k - half), hi = Math.min(n - 1, k + half);
    out[k] = stat(raw.slice(lo, hi + 1));
  }
  return out;
}

/* ── one trial: plant, contaminate, recover, score ─────────────────────────── */
function trial(geom, noiseKind, seed) {
  const rnd = mulberry32(seed);
  const { devMs } = geom;
  const n = devMs.length;
  const span = devMs[n - 1] - devMs[0];
  const truth = devMs.map((t) => plantedDrift(t - devMs[0], span, -35, -18));
  const noisy = truth.map((v, i) => v + NOISE[noiseKind](rnd));
  const r0 = noisy[0];
  const raw = noisy.map((v) => v - r0);
  const truthRel = truth.map((v) => v - truth[0]);

  const res = {};
  for (const [name, stat] of Object.entries(ESTIMATORS)) {
    for (const win of [9, 21, 41, 81]) {
      const sm = smooth(raw, win, stat);
      // Score the INTERIOR only. Both families are biased at the clamped ends by
      // construction (§7 quantifies the median's); mixing that in would score the
      // edge artifact rather than the estimator.
      const lo = win, hi = n - win;
      let worst = 0, sum = 0, cnt = 0, absWorst = 0;
      for (let k = lo; k < hi; k++) {
        /* TWO errors, because they answer different questions and a single number
           hides the trade. `worst` removes a constant offset (the reference at
           `lo`), so it scores SHAPE tracking — which is what `correctionAt()`
           consumes, since the node has already anchored t0Ms and only relative
           divergence is applied. `absWorst` keeps the offset, because `ppm` is
           computed from `sm[n-1]` and a constant bias does NOT fully cancel there.
           A one-sided statistic (min/low quantile) is deliberately biased DOWNWARD
           by roughly the noise floor, so scoring it on `worst` alone would flatter
           it exactly where it is weakest. Report both; decide on both. */
        const e = Math.abs(sm[k] - truthRel[k] - (sm[lo] - truthRel[lo]));
        const a = Math.abs(sm[k] - truthRel[k]);
        if (e > worst) worst = e;
        if (a > absWorst) absWorst = a;
        sum += e; cnt++;
      }
      res[`${name}-${win}`] = { worst, absWorst, mean: cnt ? sum / cnt : NaN };
    }
  }
  return res;
}

/* ── main ──────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TRIALS = Number(arg('--trials', '12'));

let file = arg('--file', null);
if (!file) {
  const dir = process.env.DEX_PSL || '/run/media/michal/647A504F7A50205A/Ecg nightly';
  const hits = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /_ECG\.txt$/.test(f)) : [];
  if (!hits.length) {
    console.error('no PSL *_ECG.txt found. Pass --file <path> or set DEX_PSL=<dir>.');
    process.exit(2);
  }
  file = path.join(dir, hits.sort()[0]);
}

const spine = await loadSpine();
const geom = readGeometry(file);
const spanMin = (geom.devMs[geom.devMs.length - 1] - geom.devMs[0]) / 60000;
console.log(`geometry: ${geom.file}`);
console.log(`  ${geom.devMs.length} anchors from ${geom.rows} rows · span ${spanMin.toFixed(1)} min`);

/* Sanity: the shipped hostAxis must accept this geometry, or the bakeoff is
   scoring a shape the spine would refuse. */
const probe = spine.hostAxis(geom.devMs.map((d, i) => ({ devMs: d, hostMs: d + geom.host[i] * 0 + i })), {});
console.log(`  shipped hostAxis on this geometry: ok=${probe.ok}${probe.ok ? '' : ' — ' + probe.reason}`);

for (const noiseKind of ['symmetric', 'oneSided']) {
  const agg = {};
  for (let t = 0; t < TRIALS; t++) {
    const r = trial(geom, noiseKind, 1000 + t);
    for (const [k, v] of Object.entries(r)) {
      (agg[k] ||= { worst: [], mean: [], absWorst: [] });
      agg[k].worst.push(v.worst);
      agg[k].mean.push(v.mean);
      agg[k].absWorst.push(v.absWorst);
    }
  }
  const rows = Object.entries(agg)
    .map(([k, v]) => ({ k, worst: median(v.worst), mean: median(v.mean), absWorst: median(v.absWorst) }))
    .sort((a, b) => a.worst - b.worst);
  console.log(`\n── planted noise: ${noiseKind.toUpperCase()} · ${TRIALS} trials · median-of-trials ──`);
  console.log('  estimator     shape-worst   shape-mean   ABS-worst');
  for (const r of rows) {
    const star = r.k === 'median-21' ? '   ← SHIPPED' : '';
    console.log(`  ${r.k.padEnd(12)}  ${r.worst.toFixed(1).padStart(9)}  ${r.mean.toFixed(1).padStart(11)}  ${r.absWorst.toFixed(1).padStart(9)}${star}`);
  }
  const best = rows[0], shipped = rows.find((r) => r.k === 'median-21');
  console.log(`  → best ${best.k} at ${best.worst.toFixed(1)} ms vs shipped median-21 at ${shipped.worst.toFixed(1)} ms` +
    ` (${shipped.worst > 0 ? (((shipped.worst - best.worst) / shipped.worst) * 100).toFixed(1) : '0'} % better)`);
}
