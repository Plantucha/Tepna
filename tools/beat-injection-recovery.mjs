// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * beat-injection-recovery — the artificial-star test for a beat detector.
 * (CROSS-DOMAIN-METHODS-FOLLOWUPS §7.2 names this as the instrument that supersedes capture–recapture
 * for this question on clean data.)
 *
 * THE PROBLEM IT SOLVES. "How many beats does the shipped detector miss?" has no answer from the data
 * alone: there are no adjudicated R-peaks, and capture–recapture across three detectors turned out to
 * be unidentifiable on quiet sleep because the detectors agree on every beat — which is equally
 * consistent with nothing missed and with all three missing the same beats.
 *
 * THE IMPORT. Astronomy has the same problem — a survey's true source count is unknown — and answers
 * it with the ARTIFICIAL STAR TEST: plant synthetic sources of known brightness into the real image,
 * re-run the real detection pipeline, and measure the recovered fraction as a function of brightness.
 * That yields a COMPLETENESS CURVE, and it needs no ground truth, no second detector and no
 * independence assumption. Gravitational-wave injection campaigns are the same idea. Here the image is
 * the raw waveform, the star is a beat, and brightness is amplitude relative to local noise.
 *
 * WHY IT BEATS PERTURBING THE BEAT TRAIN. `beat-error-recovery.mjs` deletes and duplicates entries in
 * an already-detected RR series, so it must ASSUME a miss rate and can only propagate its consequences
 * into rMSSD. This injects into the signal the detector actually reads, so the miss rate is MEASURED.
 *
 * DESIGN CHOICES THAT MATTER, each because the naive version is wrong:
 *   · The template is the subject's OWN averaged beat, not a synthetic QRS. A generic template would
 *     measure how well the detector likes our textbook waveform, not how well it finds this heart's.
 *   · Injections are placed only where they are PHYSIOLOGICALLY ADMISSIBLE — at least a refractory
 *     period from any existing beat. A beat planted 100 ms after a real one is correctly rejected by
 *     refractory logic, and counting that as a miss would measure the detector's correctness as if it
 *     were a failure.
 *   · Amplitude is expressed against LOCAL noise, not in absolute units, because the same microvolt
 *     amplitude is trivially detectable in a quiet passage and invisible under motion.
 *   · A NULL injection (amplitude 0) is always run: it must recover nothing, and any recovery there is
 *     the harness matching noise to itself.
 *
 * DETERMINISM. Seeded LCG only; no Math.random, no Date.now.
 *
 * Usage:
 *   node tools/beat-injection-recovery.mjs --self-test
 *   node tools/beat-injection-recovery.mjs --ecg <ECG.txt> [--n 200] [--seed 7]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DexBuild = require(join(ROOT, 'tools/build-core.js'));

export function realm() {
  const noop = () => {};
  const s = {};
  s.window = s;
  s.self = s;
  s.globalThis = s;
  s.console = console;
  s.setTimeout = setTimeout;
  s.clearTimeout = clearTimeout;
  s.addEventListener = noop;
  s.removeEventListener = noop;
  s.document = {
    createElement: () => ({ style: {}, getContext: () => null, appendChild: noop }),
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: noop }
  };
  const ctx = vm.createContext(s);
  for (const f of ['clock.js', 'ecgdex-dsp.js']) {
    vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: join(ROOT, f) });
  }
  return ctx;
}

const lcg = (seed) => {
  let x = seed >>> 0;
  return () => (x = (1664525 * x + 1013904223) >>> 0) / 4294967296;
};

/** ECG column 3, host stamps column 0 — the capture-host layout. */
export function parseEcg(text) {
  const v = [];
  const lines = String(text).split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (c.length < 4) continue;
    const x = +c[3];
    if (Number.isFinite(x)) v.push(x);
  }
  return v;
}

export function detect(ctx, v, fs) {
  const bp = ctx.ECGDSP.bandpass(Float64Array.from(v), fs);
  const i16 = Int16Array.from(v.map((x) => Math.max(-32768, Math.min(32767, Math.round(x)))));
  const p = ctx.ECGDSP.detectPeaks(i16, bp, fs);
  return (Array.isArray(p) ? p : (p && (p.peaks || p.idx)) || []).filter(Number.isFinite);
}

/** Subject's own averaged beat, centred on the detected peak. */
export function buildTemplate(v, peaks, fs) {
  const half = Math.round(0.12 * fs); // ±120 ms spans QRS plus a little
  const len = 2 * half + 1;
  const acc = new Float64Array(len);
  let n = 0;
  for (const p of peaks) {
    const i = Math.round(p);
    if (i - half < 0 || i + half >= v.length) continue;
    for (let k = 0; k < len; k++) acc[k] += v[i - half + k];
    n++;
  }
  if (!n) return null;
  for (let k = 0; k < len; k++) acc[k] /= n;
  /* Remove the DC pedestal so injection ADDS a beat rather than a step. */
  const base = (acc[0] + acc[len - 1]) / 2;
  for (let k = 0; k < len; k++) acc[k] -= base;
  return { wave: acc, half, peakAmp: Math.max(...acc.map(Math.abs)) };
}

/** Robust local noise: MAD of the first difference, which is dominated by noise not by QRS. */
export function localNoise(v, at, fs) {
  const w = Math.round(1.0 * fs);
  const lo = Math.max(1, at - w),
    hi = Math.min(v.length, at + w);
  const d = [];
  for (let i = lo; i < hi; i++) d.push(Math.abs(v[i] - v[i - 1]));
  if (!d.length) return 1;
  d.sort((a, b) => a - b);
  return Math.max(1e-9, d[d.length >> 1] * 1.4826);
}

/**
 * Plant `n` beats at admissible positions and report what the SHIPPED detector recovers.
 * `snr` scales the template so its peak equals `snr x` the local noise.
 */
export function injectAndRecover(ctx, v, fs, tpl, snr, n, seed, tolMs = 100) {
  const r = lcg(seed);
  const base = detect(ctx, v, fs);
  const refractory = Math.round(0.35 * fs); // beyond the detector's 200 ms, so admissibility is not marginal
  const sorted = base.slice().sort((a, b) => a - b);
  const admissible = (i) => {
    if (i - tpl.half < 0 || i + tpl.half >= v.length) return false;
    let lo = 0,
      hi = sorted.length - 1,
      best = Infinity;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const d = Math.abs(sorted[m] - i);
      if (d < best) best = d;
      if (sorted[m] < i) lo = m + 1;
      else hi = m - 1;
    }
    return best > refractory;
  };
  const planted = [];
  let guard = 0;
  while (planted.length < n && guard++ < n * 200) {
    const i = Math.floor(r() * v.length);
    if (!admissible(i)) continue;
    if (planted.some((p) => Math.abs(p - i) < refractory)) continue;
    planted.push(i);
  }
  planted.sort((a, b) => a - b);
  const out = v.slice();
  for (const i of planted) {
    const scale = snr === 0 ? 0 : (snr * localNoise(v, i, fs)) / tpl.peakAmp;
    for (let k = 0; k < tpl.wave.length; k++) out[i - tpl.half + k] += tpl.wave[k] * scale;
  }
  const after = detect(ctx, out, fs)
    .slice()
    .sort((a, b) => a - b);
  const tol = (tolMs / 1000) * fs;
  const isNew = (t) => {
    let lo = 0,
      hi = sorted.length - 1,
      best = Infinity;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const d = Math.abs(sorted[m] - t);
      if (d < best) best = d;
      if (sorted[m] < t) lo = m + 1;
      else hi = m - 1;
    }
    return best > tol;
  };
  let recovered = 0;
  for (const p of planted) if (after.some((t) => Math.abs(t - p) <= tol)) recovered++;
  /* Detections that are neither a pre-existing beat nor a plant — the injection's collateral. */
  const spurious = after.filter((t) => isNew(t) && !planted.some((p) => Math.abs(t - p) <= tol)).length;
  return { snr, planted: planted.length, recovered, completeness: planted.length ? recovered / planted.length : null, spurious, baseline: base.length, afterCount: after.length };
}

function selfTest() {
  let fail = 0;
  const ok = (n, c, d = '') => {
    if (!c) fail++;
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  };
  const ctx = realm();
  const fs = 130;
  /* A synthetic ECG-like record: sharp biphasic beats on low noise, 60 bpm. */
  const N = fs * 240,
    v = new Array(N).fill(0);
  const r = lcg(3);
  for (let i = 0; i < N; i++) v[i] = (r() - 0.5) * 20;
  for (let b = fs; b < N - fs; b += fs) {
    for (let k = -3; k <= 3; k++) v[b + k] += 600 * Math.exp(-(k * k) / 2) * (k < 0 ? -0.3 : 1);
  }
  const base = detect(ctx, v, fs);
  ok('the shipped detector finds the synthetic beats', base.length > 200, `${base.length} beats`);
  const tpl = buildTemplate(v, base, fs);
  ok("a template is built from the subject's own beats", !!tpl && tpl.peakAmp > 0, tpl ? `peakAmp=${tpl.peakAmp.toFixed(0)}` : 'null');
  /* SNR here is amplitude / LOCAL NOISE, and the noise floor is small, so a real beat sits near
     SNR 60 rather than 5. Measured knee on this fixture: 0 % at 20, 98 % at 40, 100 % at 60 — the
     first version probed at 20 and read a correct 0 % as a broken harness. */
  const hi = injectAndRecover(ctx, v, fs, tpl, 60, 40, 11);
  ok('an injection at real-beat amplitude is recovered at high completeness', hi.completeness > 0.8, `completeness=${(hi.completeness * 100).toFixed(0)} % of ${hi.planted}`);
  /* THE CURVE IS THE PRODUCT, not any single point: completeness must be MONOTONE in amplitude. */
  const ladder = [10, 30, 60].map((x) => injectAndRecover(ctx, v, fs, tpl, x, 40, 11).completeness);
  ok('completeness is monotone in amplitude', ladder[0] <= ladder[1] && ladder[1] <= ladder[2], ladder.map((x) => (x * 100).toFixed(0) + '%').join(' -> '));
  const nul = injectAndRecover(ctx, v, fs, tpl, 0, 40, 11);
  ok('the NULL injection recovers ~nothing — the harness is not matching noise to itself', nul.completeness < 0.2, `completeness=${(nul.completeness * 100).toFixed(0)} %`);
  ok('…and completeness RISES with amplitude', hi.completeness > nul.completeness, `${(nul.completeness * 100).toFixed(0)} % -> ${(hi.completeness * 100).toFixed(0)} %`);
  ok('plants are placed clear of existing beats', hi.planted === 40);
  console.log(fail ? `\n${fail} self-test FAILURE(S)` : '\nself-test: all green');
  return fail ? 1 : 0;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--self-test')) return selfTest();
  const f = arg('--ecg');
  if (!f) {
    console.error('usage: --ecg <ECG.txt> [--n 200] [--seed 7]');
    return 2;
  }
  const n = Number(arg('--n') || 200),
    seed = Number(arg('--seed') || 7);
  const ctx = realm();
  const v = parseEcg(readFileSync(f, 'utf8'));
  const fs = Number(arg('--fs') || 130.02);
  const base = detect(ctx, v, fs);
  const tpl = buildTemplate(v, base, fs);
  if (!tpl) {
    console.error('no template — the detector found no beats');
    return 1;
  }
  console.log(`samples=${v.length} (${(v.length / fs / 60).toFixed(1)} min)  baseline beats=${base.length}  template peak=${tpl.peakAmp.toFixed(0)} uV`);
  console.log('\n  SNR   planted  recovered  completeness  spurious');
  for (const snr of [0, 5, 10, 20, 30, 40, 60, 90, 140]) {
    const r = injectAndRecover(ctx, v, fs, tpl, snr, n, seed);
    console.log(
      `  ${String(snr).padStart(4)}  ${String(r.planted).padStart(7)}  ${String(r.recovered).padStart(9)}  ${((r.completeness || 0) * 100).toFixed(1).padStart(11)} %  ${String(r.spurious).padStart(8)}`
    );
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('beat-injection-recovery.mjs')) process.exit(main(process.argv.slice(2)));
