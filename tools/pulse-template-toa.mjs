#!/usr/bin/env node
/*
 * tools/pulse-template-toa.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * FOURIER-DOMAIN TEMPLATE TIME-OF-ARRIVAL for the PPG pulse — CROSS-DOMAIN-METHODS §2.
 *
 * WHY NOW. Allan deviation (2026-08-12) put the host↔device clock at 0.023–0.094 ms, ~100× inside
 * PAT's 10 ms budget. The systolic foot, measured between the THREE co-located LEDs of one device —
 * same clock, same pulse, so detection error and nothing else — is 12.7 ms σ. The bottleneck moved,
 * and this attacks the term that now dominates.
 *
 * THE METHOD, from pulsar timing (Taylor 1992, "FFTFIT"). Build a template by averaging aligned
 * pulses, then estimate each pulse's arrival by fitting the PHASE GRADIENT of the cross-power
 * spectrum against that template. A time shift τ is a linear phase ramp in the Fourier domain:
 *
 *     X(f) · conj(T(f))  has phase  φ(f) = -2π f τ        ⇒  τ = -slope(φ)/2π
 *
 * so τ falls out of a weighted line fit through φ(f), and NOTHING quantises it to a sample. Phase
 * resolution imposes no floor; time-domain cross-correlation, by contrast, is limited to about ten
 * times WORSE than the data resolution (Taylor 1992).
 *
 * WHY THIS SHOULD BEAT INTERSECTING TANGENTS, and why the repo's own flat result is not evidence
 * against it. `PPG-SAMPLE-RATE-AND-PAT` §3 measured residIQR flat from 25→176 Hz and concluded rate
 * buys nothing. That is what theory predicts FOR A POINT-BASED FIDUCIAL: `refineFeet` uses ~3 local
 * samples (trough, steepest rise, their crossing) and discards the rest of the pulse, so extra samples
 * cannot reach it. A matched filter integrates the WHOLE pulse, so its effective SNR grows with
 * samples-per-pulse — σ_TOA ≈ W/(S/N). Both measurements are correct; they describe different
 * estimators, and only one of them can spend a higher rate.
 *
 * ⚠️ THIS TOOL PROVES NOTHING BY ITSELF. A TOA estimator can always be made to look precise by
 * becoming self-consistent — the classic circular-analysis failure this repo keeps hitting
 * (Kriegeskorte et al. 2009; CROSS-DOMAIN-METHODS §3). So the acceptance test is EXTERNAL: three
 * co-located LEDs share one clock and one pulse, so their pairwise TOA scatter is detection error and
 * nothing else. If this method is better, that scatter falls. If it merely agrees with itself, it will
 * not. `--compare` reports both methods on that same measure, side by side.
 *
 * USAGE
 *   node tools/pulse-template-toa.mjs --ppg <file> [--beats 4000] [--compare]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── pure numerics: a small DFT is enough. The pulse window is ~1 s, so at 55–176 Hz that is 64–256
      bins and we only ever use the lowest few harmonics — an FFT would be faster and is not needed. ── */

/** Discrete Fourier transform of a real window, returning only bins 1..kMax (bin 0 is the mean and
 *  carries no timing). Returns {re, im} arrays indexed from k=1. */
export function dftLow(x, kMax) {
  const n = x.length;
  const re = new Float64Array(kMax + 1);
  const im = new Float64Array(kMax + 1);
  for (let k = 1; k <= kMax; k++) {
    let sr = 0,
      si = 0;
    const w = (-2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      sr += x[i] * Math.cos(w * i);
      si += x[i] * Math.sin(w * i);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}

/** Unwrap a phase sequence so a line can be fitted through it — a ramp that crosses ±π must not be
 *  read as a jump back. This is the step whose absence makes a naive phase fit useless. */
export function unwrap(ph) {
  const out = ph.slice();
  for (let i = 1; i < out.length; i++) {
    let d = out[i] - out[i - 1];
    while (d > Math.PI) {
      out[i] -= 2 * Math.PI;
      d = out[i] - out[i - 1];
    }
    while (d < -Math.PI) {
      out[i] += 2 * Math.PI;
      d = out[i] - out[i - 1];
    }
  }
  return out;
}

/**
 * Sub-sample shift between a pulse and a template, in SAMPLES, by the phase-gradient of the
 * cross-power spectrum. Positive means `x` arrives LATER than `tpl`.
 *
 * Weighted by |T(f)|·|X(f)| — the amplitude at each harmonic IS itsreliability, so a bin where the
 * pulse has no energy contributes no phase. An unweighted fit lets an empty high harmonic, whose phase
 * is pure noise, drag the answer; that is the usual way this method is got wrong.
 */
export function phaseShift(x, tpl, kMax) {
  const n = Math.min(x.length, tpl.length);
  const X = dftLow(x.slice(0, n), kMax);
  const T = dftLow(tpl.slice(0, n), kMax);
  const ks = [],
    phs = [],
    ws = [];
  for (let k = 1; k <= kMax; k++) {
    // cross-power X · conj(T)
    const cr = X.re[k] * T.re[k] + X.im[k] * T.im[k];
    const ci = X.im[k] * T.re[k] - X.re[k] * T.im[k];
    const magX = Math.hypot(X.re[k], X.im[k]);
    const magT = Math.hypot(T.re[k], T.im[k]);
    if (magX <= 0 || magT <= 0) continue;
    ks.push(k);
    phs.push(Math.atan2(ci, cr));
    ws.push(magX * magT);
  }
  if (ks.length < 2) return null;
  const un = unwrap(phs);
  // weighted least squares through the ORIGIN: φ(k) = -2π k τ / n, so slope alone gives τ.
  let sww = 0,
    swx = 0;
  for (let i = 0; i < ks.length; i++) {
    sww += ws[i] * ks[i] * ks[i];
    swx += ws[i] * ks[i] * un[i];
  }
  if (sww <= 0) return null;
  const slope = swx / sww; // dφ/dk
  return (-slope * n) / (2 * Math.PI); // shift in samples
}

/** Mean of aligned windows — the template. Windows are pre-aligned by their coarse fiducial, so this
 *  is the ensemble average whose SNR grows as √N and against which each pulse is then fitted. */
export function buildTemplate(windows) {
  if (!windows.length) return null;
  const n = windows[0].length;
  const t = new Float64Array(n);
  for (const w of windows) for (let i = 0; i < n; i++) t[i] += w[i];
  for (let i = 0; i < n; i++) t[i] /= windows.length;
  // remove the mean: bin 0 carries no timing and a DC step would bias the low harmonics
  let m = 0;
  for (let i = 0; i < n; i++) m += t[i];
  m /= n;
  for (let i = 0; i < n; i++) t[i] -= m;
  return t;
}

/** Extract a mean-removed window of `len` samples starting at `start`, or null if out of range. */
export function windowAt(sig, start, len) {
  if (start < 0 || start + len > sig.length) return null;
  const w = new Float64Array(len);
  let m = 0;
  for (let i = 0; i < len; i++) {
    w[i] = sig[start + i];
    m += w[i];
  }
  m /= len;
  for (let i = 0; i < len; i++) w[i] -= m;
  return w;
}

/**
 * Template TOAs for one channel: coarse fiducial → template → per-pulse sub-sample refinement.
 * Returns times in ms on the same axis the coarse feet were given on.
 */
export function templateToa(sig, feet, fsHz, opts = {}) {
  const pre = opts.preMs != null ? opts.preMs : 200;
  const post = opts.postMs != null ? opts.postMs : 600;
  const kMax = opts.kMax != null ? opts.kMax : 8;
  const len = Math.round(((pre + post) * fsHz) / 1000);
  const off = Math.round((pre * fsHz) / 1000);
  if (len < 8) return null;
  const idx = [],
    wins = [];
  for (const f of feet) {
    const s = Math.round(f) - off;
    const w = windowAt(sig, s, len);
    if (w) {
      idx.push(f);
      wins.push(w);
    }
  }
  if (wins.length < 20) return null;
  const tpl = buildTemplate(wins);
  const out = [];
  for (let i = 0; i < wins.length; i++) {
    const d = phaseShift(wins[i], tpl, kMax);
    // a shift larger than the window is a failed fit, not a measurement
    if (d == null || Math.abs(d) > len / 4) continue;
    out.push({ coarse: idx[i], refined: idx[i] + d, shiftSamples: d });
  }
  return { toas: out, template: tpl, nWindows: wins.length, len, kMax };
}

/* ════ CLI ════════════════════════════════════════════════════════════════════════════════════ */

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  const arg = (n, d) => {
    const i = process.argv.indexOf('--' + n);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
  };
  const ppgPath = arg('ppg', null);
  if (!ppgPath) {
    console.error('usage: node tools/pulse-template-toa.mjs --ppg <file> [--beats N] [--compare]');
    process.exit(2);
  }
  const maxBeats = Number(arg('beats', 4000));

  const DexBuild = require(join(ROOT, 'tools', 'build-core.js'));
  const ctx = vm.createContext({
    console,
    Math,
    JSON,
    Date,
    Array,
    Object,
    Number,
    String,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    Infinity,
    NaN,
    Uint8Array,
    Int16Array,
    Float32Array,
    Float64Array,
    setTimeout,
    clearTimeout
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-dsp.js']) vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  const P = ctx.PPGDSP;

  const rec = P.parsePPG(readFileSync(ppgPath, 'utf8'));
  const fs = rec.fs;
  console.log(`PPG ${rec.ch.length} channels · fs=${fs.toFixed(2)} Hz · ${rec.ch[0].length} samples`);

  const q = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(p * (s.length - 1))];
  };
  const toMs = (i) => {
    const k = Math.round(i);
    const s = rec.relSec && isFinite(rec.relSec[k]) ? rec.relSec[k] : k / fs;
    return rec.t0Ms + s * 1000 + (i - k) * (1000 / fs);
  };

  const perCh = [0, 1, 2].map((c) => {
    const det = P.detectChannel(rec.ch[c], fs);
    const feet = det.feet.slice(0, maxBeats);
    const tt = templateToa(det.bp, feet, fs, {});
    return { det, feet, tt };
  });

  /* THE ACCEPTANCE TEST — inter-LED scatter. Three co-located LEDs, one clock, one pulse: whatever
     differs between them is detection error. A method that is merely self-consistent cannot move it. */
  const pairScatter = (pick) => {
    const out = [];
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2]
    ]) {
      const A = pick(perCh[a]).map(toMs),
        B = pick(perCh[b]).map(toMs);
      const d = [];
      let k = 0;
      for (const t of A) {
        while (k + 1 < B.length && Math.abs(B[k + 1] - t) < Math.abs(B[k] - t)) k++;
        if (B.length && Math.abs(B[k] - t) < 200) d.push(B[k] - t);
      }
      if (d.length > 50) out.push(q(d, 0.75) - q(d, 0.25));
    }
    return out;
  };

  const coarse = pairScatter((c) => c.feet);
  const refined = pairScatter((c) => (c.tt ? c.tt.toas.map((t) => t.refined) : []));
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

  console.log(`\ntemplate: ${perCh[0].tt ? perCh[0].tt.nWindows : 0} windows of ${perCh[0].tt ? perCh[0].tt.len : 0} samples, ${perCh[0].tt ? perCh[0].tt.kMax : 0} harmonics`);
  console.log('\nINTER-LED SCATTER (IQR, ms) — same clock, same pulse ⇒ detection error alone');
  console.log(`  intersecting tangents (shipped) : ${coarse.map((v) => v.toFixed(2)).join('  ')}   mean ${mean(coarse).toFixed(2)}`);
  console.log(`  Fourier template TOA           : ${refined.map((v) => v.toFixed(2)).join('  ')}   mean ${mean(refined).toFixed(2)}`);
  const gain = (1 - mean(refined) / mean(coarse)) * 100;
  console.log(
    `\n  change: ${gain > 0 ? '-' : '+'}${Math.abs(gain).toFixed(1)} %` +
      (gain > 0 ? '  (scatter reduced — detection error genuinely removed)' : '  (no improvement; the method is not paying for itself here)')
  );
}
