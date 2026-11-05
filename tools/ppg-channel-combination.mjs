#!/usr/bin/env node
/*
 * tools/ppg-channel-combination.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CHANNEL COMBINATION AGAINST CHANNEL SELECTION, OUT OF SAMPLE — a producer for the half of
 * `papers/ppg-ecg-hrv-validation.html` §4 that carries none.
 *
 * Residue `2026-10-28-three-paper-panels-are-carried-from-draft-v2-with-no-producer` names three
 * published panels whose producer never landed. `tools/ecg-template-xcorr-residual.mjs` re-cut the
 * first on 2026-11-03. This is the second, and the published sentence it answers is:
 *
 *     "Combining the three LED channels into one waveform — by simple averaging, by the first
 *      principal component, or by a maximum-SNR generalised-eigenvalue beamformer — loses to
 *      selecting the best single channel, out of sample, on both a spectral criterion and on
 *      foot-to-foot interval dispersion; the channels correlate at rho ~ 0.99."
 *
 * WHY THIS IS NOT `tools/ppg-fusion-e3.mjs`. E-3 re-scored fusion on PPI jitter against paired H10
 * chest ECG, which is a different endpoint and a different population. It carries no GEV beamformer,
 * no spectral criterion and no out-of-sample split — the three things the sentence states. E-3 also
 * runs its corpus pass at module top level, so importing its `znorm`/`meanFuse`/`pca1Fuse` would
 * execute that pass; the small linear algebra they share is therefore written again below rather
 * than imported, and the duplication is deliberate.
 *
 * ── THE OUT-OF-SAMPLE SPLIT IS THE WHOLE POINT ────────────────────────────────────────────────
 * Channel selection and fusion weights both FIT something: selection picks an index, PCA-1 and the
 * beamformer each solve three free weights. Scoring a fit on the samples that chose it measures fit
 * and not performance, and a three-weight beamformer will win that comparison on any data. So every
 * block is cut in half on the sample axis: the FIRST half selects the channel and solves both weight
 * vectors, the SECOND half is scored, and neither fit ever sees it. The normalisation moments come
 * from the fit half too, applied to the eval half — a z-score fitted on the scored samples is a
 * small leak and there is no reason to take it.
 *
 * ── THE TWO CRITERIA ARE THE SUITE'S OWN ──────────────────────────────────────────────────────
 *   spectral     std(bandpass 0.7-3.0 Hz) / std(bandpass 4.0-8.0 Hz) — the formula and both bands
 *                are `snrOfSlice`'s, read from `ppgdex-dsp.js:1969`, over the shipped `bandpass`.
 *                Higher is better. A criterion invented here would be a third variable.
 *   dispersion   the shipped `detectBeats` on each variant, feet placed on the Clock Contract axis
 *                through `rec.relSec`, then the SD of SUCCESSIVE foot-to-foot differences over
 *                sqrt(2). Successive differences and not a plain SD: a real overnight HR drift
 *                inflates a plain SD by far more than the variants differ from each other, inflates
 *                all four about equally, and so compresses every ratio toward 1. The plain SD is
 *                reported beside it. Lower is better.
 *
 * ── PRE-STATED, before the first corpus read (§🧾). None is derived from the data it judges ────
 *   BLOCK_SEC 300      one block; blocks never cross a file, so no continuity is manufactured
 *   FIT_SHARE 0.5      the first half fits, the second half is scored
 *   PULSE/NOISE bands  0.7-3.0 Hz and 4.0-8.0 Hz, both inside the shipped 0.5-8.0 Hz pass-band
 *   MIN_FEET 60        a variant with fewer feet in the eval half is not a beat train; the block
 *                      is excluded BY NAME rather than scored on a handful
 *   MIN_CHANNELS 2     combination needs two distinct channels to combine
 *   MIN_BLOCKS 10      below this the run reports UNDERPOWERED rather than a direction
 *   identity rule      a capture is (basename, byte size), so the second copy of a recording that
 *                      two capture trees both hold is dropped and counted rather than given a
 *                      second vote. See the block above `dedupeByIdentity` for the measurement.
 *   ADV_MAX 1.0        the DIRECTION Draft v2 published: no combination beats selection. Advantage
 *                      is fusion/single on the spectral criterion and single/fusion on dispersion,
 *                      so above 1 means the combination WON. PASS reproduces the published
 *                      direction; FAIL refutes it, and a refutation is the honest result if it is
 *                      what the corpus says.
 *
 * ── §∅ ABSENCE IS NULL ────────────────────────────────────────────────────────────────────────
 * Every block that cannot be scored is excluded under a NAMED reason and counted; none is scored as
 * a zero, and no variant is credited a figure it did not produce. The validity sidecar is read for
 * every file through the shared reader, and an absent sidecar is validity UNKNOWN for that stream,
 * never a clean one.
 *
 * USAGE
 *   node tools/ppg-channel-combination.mjs --dir <captures> [--max-files N] [--json]
 *   node tools/ppg-channel-combination.mjs --selftest
 *   node tools/ppg-channel-combination.mjs --verdict-sample
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { dedupeByIdentity, gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';
/* RE-EXPORTED, NOT RE-IMPLEMENTED. The identity rule moved to the shared module so that the three
   tools applying it cannot drift apart; this spelling stays because callers already import it here. */
export { dedupeByIdentity };
import { readRunsSidecar, validityLine } from './trio-fold-validity.mjs';
import { median, quantile, sd } from './ppi-match.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const TOOL = 'tools/ppg-channel-combination.mjs';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const MAX_FILES = +opt('--max-files', 20);
const UNIT = 'verity PPG files';

/* ════════════════════════════════════ PRE-STATED CONSTANTS ════════════════════════════════════ */
const BLOCK_SEC = 300;
const FIT_SHARE = 0.5;
const PULSE_LO = 0.7;
const PULSE_HI = 3.0;
const NOISE_LO = 4.0;
const NOISE_HI = 8.0;
const MIN_FEET = 60;
const MIN_CHANNELS = 2;
const MIN_BLOCKS = 10;
const ADV_MAX = 1;
const POWER_ITERS = 64;
const VARIANTS = ['single', 'mean3', 'pca1', 'gev'];
const FUSIONS = ['mean3', 'pca1', 'gev'];
const CRITERIA = ['spectral', 'dispersion'];

/* ═══════════════════════════════════════ THE LINEAR ALGEBRA ═══════════════════════════════════ */

/* Mean and SD of one slice, so the eval half can be normalised by the FIT half's moments. */
export function moments(x) {
  const n = x.length;
  if (!(n > 1)) return { m: 0, s: 0, n };
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i];
  const m = s / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (x[i] - m) * (x[i] - m);
  return { m, s: Math.sqrt(v / (n - 1)), n };
}

/* z-score with SOMEONE ELSE'S moments — the out-of-sample form. A combination must not be dominated
   by whichever LED happens to carry the largest counts, and the scale that removes that is fitted on
   the half that fits everything else. */
export function znormWith(x, m, s) {
  const d = s > 0 ? s : 1e-9;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = (x[i] - m) / d;
  return y;
}

/* k x k covariance across k equal-length channels. */
export function covOf(chans) {
  const k = chans.length;
  const n = chans[0].length;
  const mu = chans.map((c) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += c[i];
    return s / n;
  });
  const R = Array.from({ length: k }, () => new Float64Array(k));
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (chans[a][i] - mu[a]) * (chans[b][i] - mu[b]);
      const v = s / Math.max(1, n - 1);
      R[a][b] = v;
      R[b][a] = v;
    }
  }
  return R;
}

/* Dominant eigenvector by power iteration, unit-norm, dominant component positive so a combination
   keeps the channels' polarity rather than inverting the fused pulse. `null` when the iteration
   collapses — which is a refusal, never a zero vector passed on as weights. */
export function dominantEigen(A, iters = POWER_ITERS) {
  const k = A.length;
  let w = new Float64Array(k).fill(1 / Math.sqrt(k));
  for (let it = 0; it < iters; it++) {
    const y = new Float64Array(k);
    for (let a = 0; a < k; a++) {
      let s = 0;
      for (let b = 0; b < k; b++) s += A[a][b] * w[b];
      y[a] = s;
    }
    let nrm = 0;
    for (let a = 0; a < k; a++) nrm += y[a] * y[a];
    nrm = Math.sqrt(nrm);
    if (!(nrm > 1e-300) || !Number.isFinite(nrm)) return null;
    for (let a = 0; a < k; a++) w[a] = y[a] / nrm;
  }
  let dom = 0;
  for (let a = 1; a < k; a++) if (Math.abs(w[a]) > Math.abs(w[dom])) dom = a;
  if (w[dom] < 0) for (let a = 0; a < k; a++) w[a] = -w[a];
  return Array.from(w);
}

/* Gauss-Jordan inverse of a small matrix, `null` on a singular one. The beamformer needs the noise
   covariance inverted and three co-located photodiodes make that matrix nearly singular, so the
   refusal path is the normal one and not an edge case. */
export function invSmall(A) {
  const k = A.length;
  const M = Array.from({ length: k }, (_, a) => Array.from({ length: 2 * k }, (_, b) => (b < k ? A[a][b] : b - k === a ? 1 : 0)));
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    if (piv !== c) [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let b = 0; b < 2 * k; b++) M[c][b] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let b = 0; b < 2 * k; b++) M[r][b] -= f * M[c][b];
    }
  }
  const out = Array.from({ length: k }, (_, a) => M[a].slice(k));
  return out.every((row) => row.every(Number.isFinite)) ? out : null;
}

/* PCA-1: the leading eigenvector of the z-scored channels' covariance. */
export function pca1Weights(zs) {
  return dominantEigen(covOf(zs));
}

/* THE MAXIMUM-SNR GENERALISED-EIGENVALUE BEAMFORMER — the variant the paper names and E-3 never
   carried. It maximises w'Rs w / w'Rn w, i.e. the dominant eigenvector of inv(Rn) Rs, with Rs and Rn
   the channel covariances inside the pulse band and inside the noise band. Rn is regularised by a
   fixed fraction of its own trace because near-collinear channels make it ill-conditioned; the
   fraction is pre-stated here, not tuned against the result. */
export const GEV_REG = 1e-6;
export function gevWeights(Rs, Rn) {
  const k = Rn.length;
  let tr = 0;
  for (let a = 0; a < k; a++) tr += Rn[a][a];
  if (!(tr > 0)) return null;
  const reg = (GEV_REG * tr) / k;
  const Rr = Rn.map((row, a) => row.map((v, b) => v + (a === b ? reg : 0)));
  const Ri = invSmall(Rr);
  if (!Ri) return null;
  const M = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => {
      let s = 0;
      for (let c = 0; c < k; c++) s += Ri[a][c] * Rs[c][b];
      return s;
    })
  );
  return dominantEigen(M);
}

/* Project k channels onto one waveform. Equal weights are mean-of-3; a solved vector is PCA-1 or the
   beamformer. One function so the three combinations differ ONLY in their weights. */
export function applyWeights(zs, w) {
  const k = zs.length;
  const n = zs[0].length;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let a = 0; a < k; a++) s += w[a] * zs[a][i];
    y[i] = s;
  }
  return y;
}

/* ═════════════════════════════════════════ THE CRITERIA ═══════════════════════════════════════ */

/* `snrOfSlice`'s formula and bands (`ppgdex-dsp.js:1969`), over the shipped `bandpass`. `null` when
   either band is flat — an un-measurable ratio, never a 0 and never an in-range sentinel. */
export function snrOf(bandpass, x, fs) {
  const p = sd(bandpass(x, fs, PULSE_LO, PULSE_HI));
  const n = sd(bandpass(x, fs, NOISE_LO, NOISE_HI));
  if (!(p > 0) || !(n > 0) || !Number.isFinite(p / n)) return null;
  return p / n;
}

/* Foot-to-foot dispersion. `jitterMs` is the SD of SUCCESSIVE differences over sqrt(2), which is the
   per-interval jitter with slow HR drift removed; `sdMs` is the plain SD beside it. `null` under
   three feet, because two intervals are the fewest that can differ. */
export function ffStats(feetMs) {
  if (!feetMs || feetMs.length < 4) return null;
  const ff = [];
  for (let i = 1; i < feetMs.length; i++) ff.push(feetMs[i] - feetMs[i - 1]);
  const d = [];
  for (let i = 1; i < ff.length; i++) d.push(ff[i] - ff[i - 1]);
  if (d.length < 2) return null;
  let q = 0;
  for (const v of d) q += v * v;
  const jitterMs = Math.sqrt(q / d.length) / Math.SQRT2;
  const sdMs = sd(ff);
  if (!Number.isFinite(jitterMs) || sdMs == null || !Number.isFinite(sdMs)) return null;
  return { feet: feetMs.length, intervals: ff.length, medianFfMs: median(ff), sdMs, jitterMs };
}

/* Advantage above 1 means the COMBINATION won. Two orientations because the two criteria point
   opposite ways, and writing both out beats remembering which. */
export function advantageOf(single, variant) {
  return {
    spectral: single.snr > 0 ? variant.snr / single.snr : null,
    dispersion: variant.jitterMs > 0 ? single.jitterMs / variant.jitterMs : null
  };
}

/* ═════════════════════════════════════ BLOCKS AND SCORING ═════════════════════════════════════ */

/* Whole blocks only, and never across a file. A trailing remainder shorter than one block is DROPPED
   rather than scored short: a block's two halves are its fit and its score, and a half of unstated
   length makes the ratio it feeds un-interpretable. */
export function blockPlan(n, fs, blockSec = BLOCK_SEC) {
  const w = Math.round(blockSec * fs);
  const out = [];
  if (!(w > 8)) return out;
  for (let s = 0; s + w <= n; s += w) out.push([s, s + w]);
  return out;
}

/* Sample index (possibly fractional) to floating wall-clock ms, through the record's own axis —
   never index/fs, which would quote a nominal rate the device did not hold (Clock Contract §7). */
export function indexToMs(rec, fi) {
  const i0 = Math.floor(fi);
  if (!(i0 >= 0 && i0 < rec.n)) return null;
  const i1 = Math.min(rec.n - 1, i0 + 1);
  const fr = fi - i0;
  const relSec = rec.relSec[i0] * (1 - fr) + rec.relSec[i1] * fr;
  return Number.isFinite(relSec) ? rec.t0Ms + relSec * 1000 : null;
}

/* ONE BLOCK. Returns `{ row }` or `{ excluded: <reason> }` — and the reason is a name, so the tally
   at the end says WHAT was not measured rather than how much. */
export function scoreBlock(P, bps, rec, s, e) {
  const k = bps.length;
  const fitEnd = s + Math.round((e - s) * FIT_SHARE);
  const fit = bps.map((b) => b.subarray(s, fitEnd));
  const ev = bps.map((b) => b.subarray(fitEnd, e));
  const mom = fit.map(moments);
  if (mom.some((m) => !(m.s > 0))) return { excluded: 'flat-fit-channel' };

  /* SELECTION, fitted on the first half only. */
  const fitSnr = fit.map((x) => snrOf(P.bandpass, x, rec.fs));
  if (fitSnr.some((v) => v == null)) return { excluded: 'fit-snr-unmeasurable' };
  let bestIdx = 0;
  for (let a = 1; a < k; a++) if (fitSnr[a] > fitSnr[bestIdx]) bestIdx = a;

  /* WEIGHTS, fitted on the first half only. */
  const zFit = fit.map((x, i) => znormWith(x, mom[i].m, mom[i].s));
  const wPca = pca1Weights(zFit);
  const Rs = covOf(fit.map((x) => P.bandpass(x, rec.fs, PULSE_LO, PULSE_HI)));
  const Rn = covOf(fit.map((x) => P.bandpass(x, rec.fs, NOISE_LO, NOISE_HI)));
  const wGev = gevWeights(Rs, Rn);
  if (!wPca || !wGev) return { excluded: 'weights-unsolved' };

  /* SCORING, on the second half, which neither fit has seen. */
  const zEval = ev.map((x, i) => znormWith(x, mom[i].m, mom[i].s));
  const waves = {
    single: zEval[bestIdx],
    mean3: applyWeights(zEval, new Array(k).fill(1 / k)),
    pca1: applyWeights(zEval, wPca),
    gev: applyWeights(zEval, wGev)
  };
  const v = {};
  for (const name of VARIANTS) {
    const snr = snrOf(P.bandpass, waves[name], rec.fs);
    if (snr == null) return { excluded: `eval-snr-unmeasurable:${name}` };
    const feet = P.detectBeats(waves[name], rec.fs).feet || [];
    const feetMs = feet.map((f) => indexToMs(rec, fitEnd + f)).filter((t) => t != null);
    if (feetMs.length < MIN_FEET) return { excluded: `feet<${MIN_FEET}:${name}` };
    const st = ffStats(feetMs);
    if (!st) return { excluded: `dispersion-unmeasurable:${name}` };
    v[name] = { snr, ...st };
  }
  if (!(v.single.snr > 0) || !(v.single.jitterMs > 0)) return { excluded: 'single-degenerate' };
  const adv = {};
  for (const name of FUSIONS) {
    adv[name] = advantageOf(v.single, v[name]);
    if (CRITERIA.some((c) => adv[name][c] == null || !Number.isFinite(adv[name][c]))) return { excluded: `advantage-unmeasurable:${name}` };
  }
  return { row: { s, fitEnd, e, bestIdx, chRho: rhoOf(Rs), wPca, wGev, v, adv } };
}

/* The paper states rho ~ 0.99 between the channels, so the run reports its own. Pulse-band
   covariance, since that is the band the combinations are meant to strengthen. */
export function rhoOf(R) {
  const k = R.length;
  const out = [];
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) out.push(R[a][b] / Math.sqrt(Math.max(1e-300, R[a][a] * R[b][b])));
  return out.length ? median(out) : null;
}

/* ═══════════════════════════════════════════ THE REALM ════════════════════════════════════════ */
/* Shipped DSP only, loaded the way every sibling tool loads it. The ONLY new code in this file is
   the combination algebra above and the harness below. */
let _realm = null;
async function loadPpg() {
  if (_realm) return _realm;
  const B = await import(join(ROOT, 'tools/build-core.js'));
  const classicify = B.classicify || B.default?.classicify;
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']) {
    vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  }
  _realm = sb;
  return sb;
}

/* ═══════════════════════════════════════════ SELFTEST ═════════════════════════════════════════ */
async function selftest() {
  let asserted = 0;
  let failed = 0;
  const ok = (c, m, detail) => {
    asserted++;
    if (!c) failed++;
    console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}${detail ? `  — ${detail}` : ''}`);
  };
  console.log('ppg-channel-combination --selftest');

  /* WHITE noise, from a seeded xorshift32 — deterministic without `Math.random`. The first fixture
     here built its noise as `(i * seed) % 1009`, which is a SAWTOOTH: its harmonics land inside the
     0.7-3.0 Hz pulse band, so a "noise-only" channel out-scored the pulse-carrying one on the
     spectral criterion and the beamformer was right to prefer it. A tonal fixture tests nothing
     about a pulse. */
  const prng = (seed) => {
    let st = seed >>> 0 || 1;
    return () => {
      st ^= st << 13;
      st >>>= 0;
      st ^= st >>> 17;
      st ^= st << 5;
      st >>>= 0;
      return (st / 4294967296) * 2 - 1;
    };
  };
  const n = 4096;
  const sig = new Float32Array(n);
  const noise = new Float32Array(n);
  const noise2 = new Float32Array(n);
  const noise3 = new Float32Array(n);
  const small1 = new Float32Array(n);
  const small2 = new Float32Array(n);
  const r1 = prng(12345);
  const r2 = prng(67891);
  const r3 = prng(24680);
  const r4 = prng(13579);
  const r5 = prng(98765);
  for (let i = 0; i < n; i++) {
    sig[i] = Math.sin((2 * Math.PI * i) / 55);
    noise[i] = r1();
    noise2[i] = r2();
    noise3[i] = r3();
    small1[i] = 0.05 * r4();
    small2[i] = 0.05 * r5();
  }

  const mo = moments(sig);
  const z = znormWith(sig, mo.m, mo.s);
  ok(Math.abs(moments(z).s - 1) < 0.01, 'the fit half’s moments z-score the slice they were taken from to unit SD', `sd ${moments(z).s.toFixed(4)}`);
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i++) scaled[i] = sig[i] * 1000 + 5e5;
  const zs = znormWith(scaled, mo.m, mo.s);
  ok(Math.abs(moments(zs).s) > 100, 'a FOREIGN slice is NOT forced to unit SD, so the normalisation cannot launder a scale change', `sd ${moments(zs).s.toFixed(1)}`);

  const wEq = pca1Weights([znormWith(sig, mo.m, mo.s), znormWith(sig, mo.m, mo.s), znormWith(sig, mo.m, mo.s)]);
  ok(
    wEq != null && Math.abs(Math.abs(wEq[0]) - 1 / Math.sqrt(3)) < 1e-3,
    'on three identical channels PCA-1 returns the equal-weight mean, 1/sqrt(3) each',
    `[${wEq.map((x) => x.toFixed(3)).join(' ')}]`
  );
  const wNoisy = pca1Weights([sig, sig, noise]);
  ok(wNoisy != null && Math.abs(wNoisy[2]) < Math.abs(wNoisy[0]), 'PCA-1 down-weights a noise-only channel', `[${wNoisy.map((x) => x.toFixed(3)).join(' ')}]`);
  let nrm = 0;
  for (const w of wNoisy) nrm += w * w;
  ok(Math.abs(nrm - 1) < 1e-6, 'the PCA-1 weight vector is unit-norm');

  /* The three noise channels are INDEPENDENT on purpose. Give two of them the SAME noise and the
     beamformer finds a difference direction in which that noise cancels exactly, so its SNR is
     unbounded and the dominant weight lands away from the pulse — correct behaviour on a degenerate
     covariance, and a fixture that would read as a failure. */
  const Rs = covOf([sig, small1, small2]);
  const Rn = covOf([noise, noise2, noise3]);
  const wG = gevWeights(Rs, Rn);
  ok(
    wG != null && Math.abs(wG[2]) < Math.abs(wG[0]),
    'the GEV beamformer puts its dominant weight on the channel carrying pulse rather than noise',
    wG ? `[${wG.map((x) => x.toFixed(3)).join(' ')}]` : 'null'
  );
  let gn = 0;
  for (const w of wG || []) gn += w * w;
  ok(wG != null && Math.abs(gn - 1) < 1e-6, 'the GEV weight vector is unit-norm');
  ok(
    gevWeights(Rs, [
      [0, 0],
      [0, 0]
    ]) === null,
    'a zero noise covariance REFUSES rather than returning weights',
    'null'
  );
  const I = [
    [2, 0],
    [0, 4]
  ];
  const Ii = invSmall(I);
  ok(Ii != null && Math.abs(Ii[0][0] - 0.5) < 1e-12 && Math.abs(Ii[1][1] - 0.25) < 1e-12, 'the small-matrix inverse is right on a diagonal case');
  ok(
    invSmall([
      [1, 1],
      [1, 1]
    ]) === null,
    'a singular matrix inverts to null, not to Infinity'
  );

  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = -sig[i];
  const m3 = applyWeights([sig, sig, sig], [1 / 3, 1 / 3, 1 / 3]);
  const cancelled = applyWeights([sig, sig, inv], [1 / 3, 1 / 3, 1 / 3]);
  let a1 = 0;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    a1 = Math.max(a1, Math.abs(m3[i]));
    a2 = Math.max(a2, Math.abs(cancelled[i]));
  }
  ok(a2 < a1 * 0.5, 'an opposite-polarity channel CANCELS the combined pulse, which is why the shipped polarity pass runs first', `${a2.toFixed(2)} vs ${a1.toFixed(2)}`);

  const even = [];
  for (let i = 0; i < 200; i++) even.push(i * 1000);
  const st = ffStats(even);
  ok(st != null && st.jitterMs === 0 && st.sdMs === 0, 'a perfectly periodic foot train has zero dispersion, and zero here is a MEASUREMENT', `jitter ${st && st.jitterMs}`);
  const drift = [];
  for (let i = 0, t = 0; i < 200; i++, t += 1000 + i * 2) drift.push(t);
  const sd2 = ffStats(drift);
  ok(
    sd2 != null && sd2.jitterMs < sd2.sdMs / 10,
    'a slow HR drift inflates the plain SD and barely moves the successive-difference jitter, which is why the criterion reads the latter',
    `jitter ${sd2.jitterMs.toFixed(2)} vs sd ${sd2.sdMs.toFixed(2)}`
  );
  ok(ffStats([0, 1000, 2000]) === null, 'three feet are too few to state a dispersion, so it is null rather than 0');

  ok(advantageOf({ snr: 2, jitterMs: 10 }, { snr: 4, jitterMs: 5 }).spectral === 2, 'advantage above 1 on the spectral criterion means the combination won');
  ok(advantageOf({ snr: 2, jitterMs: 10 }, { snr: 1, jitterMs: 20 }).dispersion === 0.5, 'advantage below 1 on dispersion means selection won');

  /* The identity rule: two capture trees holding one recording must not give it two votes. */
  const dd = dedupeByIdentity([
    { p: 'uploads/vigil-archive/captures/2026-08-17/A_PPG.txt', size: 100 },
    { p: 'uploads/captures/2026-08-17/A_PPG.txt', size: 100 }
  ]);
  ok(dd.kept.length === 1 && dd.kept[0].p.startsWith('uploads/captures/'), 'one recording offered by two capture trees is counted ONCE, and the lexicographically first path wins', dd.kept[0].p);
  ok(dd.dropped.length === 1 && dd.dropped[0].includes('vigil-archive'), 'the dropped second copy is NAMED, not merely counted', dd.dropped[0]);
  const dc = dedupeByIdentity([
    { p: 'x/A_PPG.txt', size: 100 },
    { p: 'y/A_PPG.txt', size: 101 }
  ]);
  ok(dc.kept.length === 2 && dc.conflicts.length === 1, 'the same basename at a DIFFERENT size is two recordings, so both are kept and the basename is reported', JSON.stringify(dc.conflicts));
  ok(
    dedupeByIdentity([
      { p: 'x/A_PPG.txt', size: 1 },
      { p: 'x/B_PPG.txt', size: 2 }
    ]).dropped.length === 0,
    'two different recordings drop nothing'
  );

  const plan = blockPlan(1000, 1, 300);
  ok(plan.length === 3 && plan[2][1] === 900, 'whole blocks only: a 1000 s record gives three 300 s blocks and the 100 s remainder is dropped, not scored short', JSON.stringify(plan));
  ok(blockPlan(100, 1, 300).length === 0, 'a record shorter than one block yields no block at all');

  /* The harness end to end, on a synthetic three-channel record through the SHIPPED detector: one
     clean LED and two noise-only ones. Selection must beat every combination on both criteria here,
     because two of the three channels carry nothing to combine. */
  const P = (await loadPpg()).PPGDSP;
  const fs = 176;
  const N = Math.round(BLOCK_SEC * fs);
  const beatSec = 1 / 1.1;
  const pulse = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const ph = ((i / fs) % beatSec) / beatSec;
    pulse[i] = Math.exp(-(((ph - 0.15) / 0.08) ** 2)) + 0.4 * Math.exp(-(((ph - 0.45) / 0.12) ** 2));
  }
  const mk = (amp, seed) => {
    const rp = prng(seed);
    const y = new Float32Array(N);
    for (let i = 0; i < N; i++) y[i] = amp * pulse[i] + 0.3 * rp();
    return y;
  };
  const chans = [mk(1, 2654435761), mk(0, 40503), mk(0, 1000003)];
  const bps = chans.map((c) => P.bandpass(c, fs, 0.5, 8.0));
  const relSec = new Float32Array(N);
  for (let i = 0; i < N; i++) relSec[i] = i / fs;
  const rec = { fs, n: N, relSec, t0Ms: Date.UTC(2026, 5, 16, 22, 11, 15) };
  const res = scoreBlock(P, bps, rec, 0, N);
  ok(res.row != null, 'the harness scores a synthetic three-channel block end to end through the shipped detector', res.excluded || '');
  if (res.row) {
    const r = res.row;
    ok(r.bestIdx === 0, 'selection, fitted on the first half only, picks the one channel carrying pulse', `idx ${r.bestIdx}`);
    ok(r.v.single.feet >= MIN_FEET, 'the shipped detector finds a full beat train on the selected channel', `${r.v.single.feet} feet`);
    ok(
      FUSIONS.every((f) => r.adv[f].spectral < 1),
      'with two of three channels carrying nothing, every combination LOSES on the spectral criterion',
      FUSIONS.map((f) => `${f} ${r.adv[f].spectral.toFixed(3)}`).join(' · ')
    );
    ok(
      Math.abs(r.wGev[0]) > Math.abs(r.wGev[1]) && Math.abs(r.wGev[0]) > Math.abs(r.wGev[2]),
      'the beamformer’s dominant weight lands on the pulse-carrying channel',
      `[${r.wGev.map((x) => x.toFixed(3)).join(' ')}]`
    );
  }
  const flat = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  ok(scoreBlock(P, flat, rec, 0, N).excluded === 'flat-fit-channel', 'a flat channel EXCLUDES the block by name rather than scoring it zero', scoreBlock(P, flat, rec, 0, N).excluded);

  console.log(failed ? `\nselftest: ${failed} of ${asserted} selftests FAILED` : `\nselftest: all ${asserted} selftests passed`);
  return failed;
}

if (SELFTEST) process.exit((await selftest()) ? 1 : 0);

/* ════════════════════════════════════════ THE POPULATION ══════════════════════════════════════ */
/* THE LISTER IS THE POPULATION RULE AND IT CARRIES A NAME, so the snapshot publishes who chose it
   rather than `rule: null`. The unit is a FILE: a part-split capture arrives as contiguous parts and
   a block never crosses one, so no night is assembled here that the bytes do not state.
   🔴 It must not swallow an unreadable root — `walk` catches every error, so the root's own readdir
   runs OUTSIDE that catch and the snapshot then reports `ok: false` instead of a measured zero. */
const PPG_RE = /(?:VeritySense|Polar_Sense).*_PPG(?:_part\d+of\d+)?\.txt$/i;
const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, o);
      else o.push({ p, size: st.size });
    }
  } catch (_e) {}
  return o;
};
export function listVerityPpg(root) {
  readdirSync(root);
  return dedupeByIdentity(walk(root).filter((f) => PPG_RE.test(f.p))).kept.map((f) => relative(root, f.p));
}

export function verdictSample() {
  const at = '2026-11-04T00:00:00Z';
  const snap = snapshotEntries('uploads/sample', { list: () => ['sample-a', 'sample-b'], unit: UNIT, at });
  return populationVerdict(snap, snap, { tool: TOOL, at, evidence: [TOOL] });
}
if (has('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
if (!DIR) {
  console.error('need --dir <captures>  (or --selftest)');
  process.exit(2);
}

/* ═══════════════════════════════════════════ CORPUS RUN ═══════════════════════════════════════ */
const snapBefore = snapshotEntries(DIR, { list: listVerityPpg, unit: UNIT });
const commitOf = gitCommitOf(ROOT);
const P = (await loadPpg()).PPGDSP;
const offer = dedupeByIdentity(walk(DIR).filter((f) => PPG_RE.test(f.p)));
const files = offer.kept
  .slice()
  .sort((a, b) => b.size - a.size)
  .slice(0, MAX_FILES);

const excluded = {};
const bump = (why) => {
  excluded[why] = (excluded[why] || 0) + 1;
};
const validity = {};
const fileRows = [];
const blocks = [];

console.log('channel COMBINATION against channel SELECTION, out of sample — §4 of the PPG/ECG validation paper');
console.log(`criteria: spectral std(${PULSE_LO}-${PULSE_HI} Hz)/std(${NOISE_LO}-${NOISE_HI} Hz) · dispersion SD of successive foot-to-foot differences / sqrt(2)`);
console.log(`blocks of ${BLOCK_SEC} s, the first ${Math.round(FIT_SHARE * 100)} % fitting selection and both weight vectors, the rest scored\n`);
console.log('file                                            fs     blocks  rho    snr_sing  jit_sing  adv_mean3      adv_pca1       adv_gev');

for (const f of files) {
  const name = relative(DIR, f.p);
  /* THE SIDECAR GOES TO THE PARSER, not merely to the tally. `parsePPG` is what can mark a sample
     absent rather than zero, so a reader that keeps `runsText` to itself leaves the parser blind
     (§∅; gate SAMPLE-VALIDITY-ENVELOPE). Most of this corpus predates the writer, so most streams
     read `absent` and parse exactly as before — absent is validity UNKNOWN, never a clean stream. */
  const runsText = readRunsSidecar(f.p, 'PPG', { tally: validity }).runsText;
  let rec;
  try {
    const text = readFileSync(f.p, 'utf8');
    rec = runsText ? P.parsePPG(text, { runsText }) : P.parsePPG(text);
  } catch (_e) {
    bump('parse-failed');
    console.log(`${basename(name).slice(0, 44).padEnd(44)}  ${'—'.padStart(5)}  ${'—'.padStart(6)}  parse-failed`);
    continue;
  }
  if (rec.t0Ms == null || !rec.ch || !rec.ch.length || !(rec.fs > 0)) {
    bump('no-axis');
    console.log(`${basename(name).slice(0, 44).padEnd(44)}  ${'—'.padStart(5)}  ${'—'.padStart(6)}  no-axis`);
    continue;
  }
  const keepIdx = P.distinctChannelIdx(rec.ch);
  if (keepIdx.length < MIN_CHANNELS) {
    bump('channels<2');
    console.log(`${basename(name).slice(0, 44).padEnd(44)}  ${rec.fs.toFixed(1).padStart(5)}  ${'—'.padStart(6)}  channels<2`);
    continue;
  }
  if (rec.gap) {
    bump('gap');
    console.log(`${basename(name).slice(0, 44).padEnd(44)}  ${rec.fs.toFixed(1).padStart(5)}  ${'—'.padStart(6)}  gap`);
    continue;
  }
  /* POLARITY IS A PREREQUISITE, NOT A DETAIL (E-3's finding, and it governs here too): averaging or
     projecting channels that disagree in sign cancels the very pulse the combination is meant to
     strengthen. The shipped consensus pass settles it before any weight is solved, so this measures
     combination and not the polarity bug. */
  const perChannel = keepIdx.map((c) => P.detectChannel(rec.ch[c], rec.fs));
  const polarityActed = P.applyConsensusPolarity(perChannel, (i, sgn) => P.detectChannel(rec.ch[keepIdx[i]], rec.fs, sgn));
  const bps = perChannel.map((pc) => pc.bp);
  const plan = blockPlan(rec.n, rec.fs);
  if (!plan.length) {
    bump('shorter-than-one-block');
    console.log(`${basename(name).slice(0, 44).padEnd(44)}  ${rec.fs.toFixed(1).padStart(5)}  ${'—'.padStart(6)}  shorter-than-one-block`);
    continue;
  }
  const mine = [];
  for (const [s, e] of plan) {
    const r = scoreBlock(P, bps, rec, s, e);
    if (r.excluded) {
      bump(r.excluded);
      continue;
    }
    mine.push(r.row);
    blocks.push(r.row);
  }
  if (!mine.length) {
    console.log(`${basename(name).slice(0, 44).padEnd(44)}  ${rec.fs.toFixed(1).padStart(5)}  ${String(0).padStart(6)}  every block excluded`);
    continue;
  }
  const mAdv = (v, c) => median(mine.map((r) => r.adv[v][c]));
  fileRows.push({ rec: name, blocks: mine.length, polarityActed });
  const pair = (v) => `${(mAdv(v, 'spectral') ?? 0).toFixed(3)}/${(mAdv(v, 'dispersion') ?? 0).toFixed(3)}`;
  console.log(
    `${basename(name).slice(0, 44).padEnd(44)}  ${rec.fs.toFixed(1).padStart(5)}  ${String(mine.length).padStart(6)}  ${(median(mine.map((r) => r.chRho)) ?? 0).toFixed(3)}  ${median(
      mine.map((r) => r.v.single.snr)
    )
      .toFixed(3)
      .padStart(8)}  ${median(mine.map((r) => r.v.single.jitterMs))
      .toFixed(2)
      .padStart(8)}  ${pair('mean3').padStart(13)}  ${pair('pca1').padStart(13)}  ${pair('gev').padStart(13)}`
  );
}

const population = populationVerdict(snapBefore, snapshotEntries(DIR, { list: listVerityPpg, unit: UNIT }), {
  commit: commitOf.commit,
  commitReason: commitOf.reason,
  tool: TOOL,
  evidence: [TOOL, 'tools/corpus-scope-core.mjs']
});

const offered = blocks.length + Object.values(excluded).reduce((a, b) => a + b, 0);
const byVariant = {};
for (const v of FUSIONS) {
  byVariant[v] = {};
  for (const c of CRITERIA) byVariant[v][c] = blocks.length ? median(blocks.map((r) => r.adv[v][c])) : null;
}
let maxAdvantage = null;
let winner = null;
for (const v of FUSIONS) {
  for (const c of CRITERIA) {
    const a = byVariant[v][c];
    if (a == null) continue;
    if (maxAdvantage == null || a > maxAdvantage) {
      maxAdvantage = a;
      winner = `${v}/${c}`;
    }
  }
}

let status = 'PASS';
let reason = null;
if (!blocks.length) {
  status = 'NOT_RUN';
  reason = `no block was scored, so nothing was examined — exclusions by name: ${JSON.stringify(excluded)}`;
} else if (blocks.length < MIN_BLOCKS) {
  status = 'UNDERPOWERED';
  reason = `${blocks.length} scored block(s) under the pre-stated floor of ${MIN_BLOCKS}, so the direction is not stated on this population`;
} else if (maxAdvantage > ADV_MAX) {
  status = 'FAIL';
  reason = `${winner} reads ${maxAdvantage.toFixed(3)}x above the published direction's bound of ${ADV_MAX}, so on this corpus a combination BEATS selection and Draft v2's negative result does not reproduce`;
}

const verdict = Verdict.make({
  gate: 'ppg-channel-combination',
  status,
  population: { checked: blocks.length, eligible: offered, excluded: offered - blocks.length },
  criterion: { name: 'max_fusion_advantage', threshold: ADV_MAX, unit: 'ratio', direction: 'lte' },
  result: {
    maxAdvantage,
    winner,
    byVariant,
    single: blocks.length ? { snr: median(blocks.map((r) => r.v.single.snr)), jitterMs: median(blocks.map((r) => r.v.single.jitterMs)), sdMs: median(blocks.map((r) => r.v.single.sdMs)) } : null,
    channelRho: blocks.length ? median(blocks.map((r) => r.chRho)) : null,
    files: fileRows.length,
    excludedByReason: excluded
  },
  evidence: [TOOL, 'papers/ppg-ecg-hrv-validation.html', 'ppgdex-dsp.js'],
  reason,
  producedBy: { tool: TOOL, commit: commitOf.commit, commitReason: commitOf.reason }
});
const chk = Verdict.validate(verdict);
if (!chk.ok) {
  console.error(`verdict invalid: ${chk.errors.join(' · ')}`);
  process.exit(2);
}

console.log('');
if (blocks.length) {
  const fmt = (a) => (a.length ? `median ${median(a).toFixed(3)}  IQR ${quantile(a, 0.25).toFixed(3)}-${quantile(a, 0.75).toFixed(3)}` : 'n/a');
  console.log(`${blocks.length} block(s) scored over ${fileRows.length} file(s)\n`);
  console.log(`  best single channel         snr ${fmt(blocks.map((r) => r.v.single.snr))}   jitter ${fmt(blocks.map((r) => r.v.single.jitterMs))} ms`);
  for (const v of FUSIONS) {
    console.log(`  ${v.padEnd(26)} snr ${fmt(blocks.map((r) => r.v[v].snr))}   jitter ${fmt(blocks.map((r) => r.v[v].jitterMs))} ms`);
  }
  console.log('\n  advantage over selection (above 1 = the combination won):');
  for (const v of FUSIONS) console.log(`    ${v.padEnd(6)} spectral ${byVariant[v].spectral.toFixed(3)}x   dispersion ${byVariant[v].dispersion.toFixed(3)}x`);
  console.log(`\n  inter-channel rho (pulse band, median) ${median(blocks.map((r) => r.chRho)).toFixed(4)}`);
  const wAbs = blocks.map((r) => r.wGev.map(Math.abs).sort((a, b) => b - a));
  console.log(`  GEV dominant-weight median ${median(wAbs.map((w) => w[0])).toFixed(3)}  ·  smallest-weight median ${median(wAbs.map((w) => w[w.length - 1])).toFixed(3)}`);
  console.log(`  PCA-1 dominant-weight median ${median(blocks.map((r) => Math.max(...r.wPca.map(Math.abs)))).toFixed(3)}  (1/sqrt(3) = 0.577 is the equal-weight mean)`);
  console.log(`  files where the shipped polarity pass acted first: ${fileRows.filter((r) => r.polarityActed > 0).length} of ${fileRows.length}`);
}
console.log(`\n  excluded by reason (§∅, never a zero): ${JSON.stringify(excluded)}`);
const vline = validityLine(validity);
if (vline) console.log(`  ${vline}`);
console.log(
  `\n  population: ${population.status} — ${population.population.checked} offered ${snapBefore.unit} the run can report over, of ${population.population.eligible} it saw${population.reason ? ` · ${population.reason}` : ''}`
);
const rl = ruleLine(population);
if (rl) console.log(`  ${rl}`);
const missed = notCovered(snapBefore, fileRows, { key: 'rec' });
if (missed.length) console.log(`  it reported over none of ${missed.length}, by name: ${missed.slice(0, 8).join(' · ')}${missed.length > 8 ? ` · … (+${missed.length - 8})` : ''}`);
/* THE CAP IS A CAUSE, AND A COUNT OF UNREPORTED FILES NAMES NO CAUSE. Most of what `notCovered`
   lists above left under the cap rather than under a per-file exclusion, and the two are different
   facts about the population. */
if (files.length < snapBefore.n) console.log(`  ${snapBefore.n - files.length} of those left under the --max-files ${MAX_FILES} cap, largest first`);
console.log(
  `  identity rule (basename, size): ${offer.kept.length} distinct recording(s) over ${offer.kept.length + offer.dropped.length} offered path(s), ${offer.dropped.length} second copy/copies dropped${offer.conflicts.length ? ` · ${offer.conflicts.length} basename(s) kept twice because the sizes differ: ${offer.conflicts.slice(0, 4).join(' · ')}` : ''}`
);
console.log(`\n  tepna.verdict/1: ${verdict.status}  ·  ${verdict.population.checked} checked / ${verdict.population.eligible} eligible / ${verdict.population.excluded} excluded`);
console.log(`  ${JSON.stringify(verdict)}`);
if (verdict.reason) console.log(`  reason: ${verdict.reason}`);
console.log(`  POPULATION (tepna.verdict/1): ${JSON.stringify(population)}`);
if (has('--json')) console.log(JSON.stringify({ files: fileRows, byVariant, verdict, population }, null, 2));
