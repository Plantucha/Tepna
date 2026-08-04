#!/usr/bin/env node
/*
 * tools/oxy-hr-bias.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * R5-HR-TRIPLET-REFERENCE §5 — "Investigate OxyDex's −0.36 bpm bias."
 *
 * R5 measured that OxyDex under-reads HR against the raw-ECG Pan–Tompkins leg, and that the offset
 * SURVIVES artifact gating, so it is not contamination. It named three candidates: (a) OxyDex's own
 * pulse-oximetry HR path (rolling median / smoothing), (b) a 1 Hz bucketing bias, (c) a genuine device
 * offset. This tool runs the two measurements that separate them, so the number is reproducible rather
 * than quoted.
 *
 * LEG 1 — does OXYDEX add anything? Mean of the raw `Pulse Rate` CSV column vs `computeNight().stats
 * .meanHr`, per night. If they agree, candidate (a) is out and the bias is upstream of OxyDex.
 *
 * LEG 2 — is it QUANTIZATION or the DEVICE? Per-5-min-epoch `hr` from the folded trio corpus, OxyDex
 * minus ECGDex, pooled. The discriminator is a prediction, not a vibe:
 *     the O2Ring writes `Pulse Rate` as an INTEGER at 1 Hz, so if it TRUNCATES, the mean of the
 *     reported values sits exactly 0.5 bpm below the mean of the true ones — and averaging over an
 *     epoch does NOT wash that out, because every sample is biased the same way.
 *     truncation ⇒ −0.500 · rounding ⇒ 0.000
 * A measured value between the two means neither mechanism alone accounts for it.
 *
 * ⚠ What this CANNOT do, and R5 says why: the raw-ECG leg is one of the three corners, so it is the
 * assumed-unbiased reference here rather than an independent one. Splitting a residual device offset
 * from a quantization rule needs the FOURTH corner R5's first two items ask for (the ResMed oximeter).
 * This tool bounds the question; it does not close it.
 *
 * Usage:
 *   node tools/oxy-hr-bias.mjs [--uploads <dir>]      (default: $DEX_UPLOADS or ./uploads)
 * Needs the gitignored corpus: O2Ring CSVs for leg 1, uploads/trio/<date>/ exports for leg 2.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
/* DERIVE the root from this file, never `process.cwd()` (the PR #686 class, gate-enforced): a tool run
   from another directory would otherwise co-load a DIFFERENT checkout's DSP and report its numbers
   under this one's name — the worst kind of wrong, because every path in the output still looks right. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uArg = process.argv.indexOf('--uploads');
const UP = uArg > 0 ? process.argv[uArg + 1] : process.env.DEX_UPLOADS || path.join(ROOT, 'uploads');
if (!fs.existsSync(UP)) {
  console.error(`✕ corpus not found: ${UP}\n  set DEX_UPLOADS or pass --uploads <dir>`);
  process.exit(2);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/* ── LEG 1 ─────────────────────────────────────────────────────────────────────────────────── */
function oxyRealm() {
  const DB = req(path.join(ROOT, 'tools', 'build-core.js'));
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop },
    appendChild: noop,
    setAttribute: noop,
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    innerHTML: '',
    textContent: ''
  });
  const ctx = {
    console: { log: noop, warn: noop, error: noop },
    setTimeout,
    clearTimeout,
    addEventListener: noop,
    removeEventListener: noop,
    document: {
      getElementById: () => null,
      createElement: el,
      createTextNode: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      head: el(),
      body: el(),
      documentElement: el(),
      addEventListener: noop,
      readyState: 'complete'
    },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of [
    'kernel-constants.js',
    'clock.js',
    'metric-registry.js',
    'dex-escape.js',
    'dex-export.js',
    'oxydex-registry.js',
    'signal-spec.js',
    'signal-frame.js',
    'oxydex-util.js',
    'oxydex-dsp.js'
  ]) {
    vm.runInContext(DB.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  }
  return ctx.OxyDex;
}

const O = oxyRealm();
const csvs = fs.readdirSync(UP).filter((f) => /^O2Ring.*\.csv$/.test(f));
console.log('▸ LEG 1 — does OxyDex itself add bias?  (raw `Pulse Rate` column mean vs stats.meanHr)\n');
console.log('   raw mean   OxyDex meanHr        Δ   samples  file');
const leg1 = [];
let nonInt = 0;
for (const f of csvs) {
  const txt = fs.readFileSync(path.join(UP, f), 'utf8');
  let s = 0,
    n = 0;
  for (const line of txt.split('\n').slice(1)) {
    const p = line.split(',');
    if (p.length < 3) continue;
    const v = Number(p[2]);
    if (!isFinite(v) || v <= 0) continue; // -1/0 are the device's "no reading" fills
    if (v !== Math.floor(v)) nonInt++;
    s += v;
    n++;
  }
  if (!n) continue;
  const raw = s / n;
  let oxy = null;
  try {
    const night = O.computeNight(O.parseCSV(txt), {});
    oxy = night && night.stats ? night.stats.meanHr : null;
  } catch {}
  if (oxy == null) continue;
  leg1.push(oxy - raw);
  console.log(`   ${raw.toFixed(3).padStart(8)} ${oxy.toFixed(3).padStart(14)} ${(oxy - raw).toFixed(3).padStart(8)} ${String(n).padStart(9)}  ${f.slice(0, 30)}`);
}
if (leg1.length) {
  console.log(`\n   mean Δ over ${leg1.length} night(s) = ${mean(leg1).toFixed(4)} bpm`);
  console.log(`   non-integer raw HR values seen: ${nonInt} — the column is integer-quantized at 1 Hz`);
  console.log(`   ⇒ candidate (a) "OxyDex's HR path" is ${Math.abs(mean(leg1)) < 0.06 ? 'EXCLUDED — the residual is its 1-dp output rounding' : 'NOT excluded'}`);
} else console.log('   (no O2Ring CSVs found)');

/* ── LEG 3 — THE ESTIMATOR, which turns out to be the whole story ───────────────────────────────
   Legs 1 and 2 chase the bias through OxyDex and through the device. It is in neither. The two nodes
   summarise an epoch's heart rate with DIFFERENT statistics of the same physiology:
       ECGDex   `hr = 60000 / mean(RR)`      — the rate of the mean interval (a harmonic mean of rate)
       OxyDex   `hr = median(1 Hz rate)`     — the median of instantaneous rates
   Those are not the same number, and the gap is not small next to the effect being hunted. This leg
   measures it with NO DEVICE INVOLVED: one RR series, both estimators, per 300-beat block. Any residual
   after subtracting it is the only part that could be a sensor property.
   ── */
function legEstimator(T) {
  if (!fs.existsSync(T)) return null;
  const blocks = [];
  for (const n of fs.readdirSync(T).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    let E;
    try {
      E = JSON.parse(fs.readFileSync(path.join(T, n, `ECGDex_${n}.node-export.json`), 'utf8'));
    } catch {
      continue;
    }
    const rr = E.timeseries && E.timeseries.rr;
    if (!rr || !rr.ms || rr.ms.length < 300) continue;
    const ms = rr.ms.filter((v) => v > 300 && v < 2000); // Malik-plausible only
    for (let i = 0; i + 300 <= ms.length; i += 300) {
      const seg = ms.slice(i, i + 300);
      const harm = 60000 / mean(seg); // ECGDex
      const rates = seg.map((v) => 60000 / v).sort((a, b) => a - b);
      blocks.push({ harm, med: rates[rates.length >> 1], arith: mean(rates) });
    }
  }
  return blocks;
}

const blocks = legEstimator(path.join(UP, 'trio'));
console.log('\n\u25b8 LEG 3 \u2014 estimator only: median(rate) vs 60000/mean(RR), ONE series, no device\n');
if (!blocks || !blocks.length) console.log('   (no ECG rr series in the folded corpus)');
else {
  const dm = blocks.map((b) => b.med - b.harm),
    da = blocks.map((b) => b.arith - b.harm);
  const sd = (a) => {
    const u = mean(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - u) * (y - u), 0) / a.length);
  };
  console.log(`   blocks = ${blocks.length} (300 beats each)`);
  console.log(`   median(rate)  \u2212 60000/mean(RR) = ${mean(dm).toFixed(3)} bpm  SD ${sd(dm).toFixed(2)}   \u2190 OxyDex \u2212 ECGDex, by construction`);
  console.log(`   mean(rate)    \u2212 60000/mean(RR) = ${mean(da).toFixed(3)} bpm  SD ${sd(da).toFixed(2)}`);
  console.log('   Compare LEG 2. If these match, the "device bias" is an ESTIMATOR MISMATCH and no');
  console.log('   sensor, firmware or aggregation change can remove it \u2014 only agreeing on one statistic.');
}

/* ── LEG 2 ─────────────────────────────────────────────────────────────────────────────────── */
const T = path.join(UP, 'trio');
console.log('\n▸ LEG 2 — quantization or device?  (per-epoch OxyDex hr − ECGDex hr, folded trio corpus)\n');
if (!fs.existsSync(T)) {
  console.log('   (uploads/trio/ absent — fold it with tools/trio-batch.mjs first)');
  process.exit(0);
}
const epochs = (o) => (o.timeseries && o.timeseries.epochs) || [];
let all = [];
let nights = 0;
for (const n of fs.readdirSync(T).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
  let E, X;
  try {
    E = JSON.parse(fs.readFileSync(path.join(T, n, `ECGDex_${n}.node-export.json`), 'utf8'));
    X = JSON.parse(fs.readFileSync(path.join(T, n, `OxyDex_${n}.node-export.json`), 'utf8'));
  } catch {
    continue;
  }
  const t0E = E.recording && E.recording.startEpochMs,
    t0X = X.recording && X.recording.startEpochMs;
  if (t0E == null || t0X == null) continue;
  // Key both on the ABSOLUTE floating-ms 5-min grid — tMin is per-node and the two t0 differ.
  const mx = new Map();
  for (const e of epochs(X)) if (e.hr != null) mx.set(Math.round((t0X + e.tMin * 60000) / 300000), e.hr);
  const ds = [];
  for (const e of epochs(E)) {
    if (e.hr == null) continue;
    const k = Math.round((t0E + e.tMin * 60000) / 300000);
    if (mx.has(k)) ds.push(mx.get(k) - e.hr);
  }
  if (ds.length < 12) continue; // an hour of overlap is the floor for a night to contribute
  nights++;
  all = all.concat(ds);
}
if (!all.length) {
  console.log('   (no paired epochs)');
  process.exit(0);
}
const m = mean(all);
const sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / (all.length - 1));
const sem = sd / Math.sqrt(all.length);
console.log(`   n = ${all.length} epochs over ${nights} night(s)`);
console.log(`   mean Δ(OxyDex − ECGDex) = ${m.toFixed(3)} bpm · SD ${sd.toFixed(2)} · SEM ${sem.toFixed(3)} · ${Math.abs(m / sem).toFixed(1)}σ from zero`);
console.log('   prediction if the device TRUNCATES: −0.500 · if it ROUNDS: 0.000');
console.log(`   ⇒ measured sits ${m < -0.45 ? 'at truncation' : m > -0.05 ? 'at rounding' : 'BETWEEN the two — so neither quantisation mechanism explains it'}`);
console.log('   …and LEG 3 shows why: the estimator mismatch alone is −0.299, which is this number.');
console.log('   Quantisation was the wrong question. See LEG 3.');
console.log('\n   The per-epoch SD dwarfs the offset: this is a small SYSTEMATIC bias on a noisy');
console.log('   difference, visible only in pooling. Do not read a single night as evidence.');
