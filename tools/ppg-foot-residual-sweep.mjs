#!/usr/bin/env node
/*
 * tools/ppg-foot-residual-sweep.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE RESIDUAL 2.2–13.2 ms — per-night inter-LED foot dispersion against PRE-REGISTERED candidates.
 *
 * PPG-FOOT-PLACEMENT §0's polarity fix left a milder, non-bimodal spread: phone nights span
 * 2.2–13.2 ms inter-LED pairwise IQR and nothing yet says why. This tool measures, per night:
 *
 *   ESTIMAND   per-pair same-beat foot-difference dispersion (SD and IQR — the brief's figure is
 *              IQR), physiology cancelled by construction (same beat, same instant — pat-per-led).
 *   C1         noise-over-slope: robust additive-noise RMS (MAD of SECOND differences /0.6745/√6)
 *              divided by the median foot→peak upstroke slope, per channel; pair predictor
 *              √(p_i² + p_j²). The physical model σ_foot ≈ RMS(noise)/slope.
 *   C2         amplitude-to-noise ratio (median foot→peak amplitude / noiseRms) — the coarse form
 *              of C1. ⚠ The pre-registration named `channelSNR`; that function is LOCAL to
 *              ppgdex-dsp.js and NOT on the PPGDSP namespace — `pat-per-led.mjs`'s guarded read
 *              (`P.channelSNR ? … : NaN`) has been printing n/a since it was written, the
 *              half-wired-mechanism shape again. Exporting it would move every bundle's
 *              manifestHash for a probe, so C2 is instrumented in-tool instead: same quantity
 *              (signal over noise), substitution recorded in the brief, thresholds unchanged.
 *   C3         motion proxy: same-beat match yield per pair.
 *   C4         beat alternation: lag-1 autocorrelation r1 of the pairwise difference series, plus
 *              the dispersion after a 2-beat average (alternation collapses; noise halves only).
 *
 * The acceptance thresholds live in the brief's pre-registration block, COMMITTED BEFORE this tool
 * first ran on the corpus — this tool prints Spearman ρ per candidate and takes no verdict itself.
 *
 * Polarity is CONSENSUS-FORCED via applyConsensusPolarity (PPG-FOOT-PLACEMENT §0's wiring half):
 * a no-op on the phone tree (orient is never wrong there), real on the box tree.
 *
 *   node tools/ppg-foot-residual-sweep.mjs --selftest
 *   node tools/ppg-foot-residual-sweep.mjs --dir <captures root> [--site ankle|ring] [--json <out>]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DexBuild = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'build-core.js'));
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

export const MATCH_TOL_MS = 150; // same-beat matching across LEDs — mirrored from pat-per-led.mjs

/* ── small stats, exported for the selftest ───────────────────────────────────────────────────── */
export const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const i = q * (s.length - 1);
  const lo = Math.floor(i);
  return s[lo] + (i - lo) * ((s[Math.ceil(i)] ?? s[lo]) - s[lo]);
}
export const iqr = (a) => quantile(a, 0.75) - quantile(a, 0.25);
export function lag1(a) {
  if (a.length < 3) return NaN;
  const m = mean(a);
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i++) {
    den += (a[i] - m) ** 2;
    if (i > 0) num += (a[i] - m) * (a[i - 1] - m);
  }
  return den > 0 ? num / den : NaN;
}
/* Spearman rank correlation, average ranks on ties. */
export function spearman(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const rank = (v) => {
    const idx = v.map((val, i) => [val, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x.slice(0, n));
  const ry = rank(y.slice(0, n));
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

/* Robust additive-noise RMS: MAD of SECOND differences. First differences do NOT work — the
   selftest caught it: a pulse's diastolic decay is most of the beat and near-constant-slope, so the
   median |Δ| reads the CARDIAC slope, not the noise (2.62 on a noiseless synthetic pulse). Second
   differences vanish on locally-linear segments (rise interior, decay, baseline) and are sparse
   only at the corners, which a median ignores. For white noise Var(Δ²) = 6σ², so
   σ ≈ MAD(Δ²)/0.6745/√6. */
export function noiseRms(sig) {
  const d = [];
  for (let i = 2; i < sig.length; i++) d.push(Math.abs(sig[i] - 2 * sig[i - 1] + sig[i - 2]));
  const m = quantile(d, 0.5);
  return m / 0.6745 / Math.sqrt(6);
}

/* Median foot→peak amplitude in signal units (fractional indices honoured) — C2's numerator. */
export function medianAmp(bp, feet, peaks) {
  const at = (i) => {
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo < 0 || hi > bp.length - 1) return NaN;
    return lo === hi ? bp[lo] : bp[lo] + (i - lo) * (bp[hi] - bp[lo]);
  };
  const a = [];
  const n = Math.min(feet.length, peaks.length);
  for (let k = 0; k < n; k++) {
    const dv = at(peaks[k]) - at(feet[k]);
    if (dv > 0) a.push(dv);
  }
  return a.length ? quantile(a, 0.5) : NaN;
}

/* Median foot→peak upstroke slope in signal-units per ms (fractional indices honoured). */
export function medianSlope(bp, feet, peaks, fs) {
  const at = (i) => {
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo < 0 || hi > bp.length - 1) return NaN;
    return lo === hi ? bp[lo] : bp[lo] + (i - lo) * (bp[hi] - bp[lo]);
  };
  const s = [];
  const n = Math.min(feet.length, peaks.length);
  for (let k = 0; k < n; k++) {
    const dv = at(peaks[k]) - at(feet[k]);
    const dtMs = ((peaks[k] - feet[k]) / fs) * 1000;
    if (dv > 0 && dtMs > 0) s.push(dv / dtMs);
  }
  return s.length ? quantile(s, 0.5) : NaN;
}

/* Same-beat pairing across two foot trains — nearest within tol, one-to-one, monotone
   (pat-per-led's rule, kept identical so the two tools measure the same thing). */
export function pairSame(A, B, tol = MATCH_TOL_MS) {
  const d = [];
  let j = 0;
  for (const a of A) {
    while (j < B.length && B[j] < a - tol) j++;
    if (j >= B.length) break;
    if (Math.abs(B[j] - a) <= tol) d.push(B[j] - a);
  }
  return d;
}

/* 2-beat average of a difference series — C4's collapse probe: alternation cancels, noise halves. */
export const avg2 = (d) => {
  const o = [];
  for (let i = 0; i + 1 < d.length; i += 2) o.push((d[i] + d[i + 1]) / 2);
  return o;
};

/* ── per-night measurement, DSP-free core (trains + channel stats in, row out) ────────────────── */
export function nightRow(chans) {
  // chans: [{ feetMs, snr, noise, slope }] — ≥2 channels with ≥200 feet each
  const usable = chans.filter((c) => c.feetMs.length >= 200);
  if (usable.length < 2) return null;
  const pairs = [];
  for (let i = 0; i < usable.length; i++)
    for (let j = i + 1; j < usable.length; j++) {
      const d = pairSame(usable[i].feetMs, usable[j].feetMs);
      if (d.length < 100) continue;
      const pi = usable[i].noise / usable[i].slope;
      const pj = usable[j].noise / usable[j].slope;
      pairs.push({
        pair: `${i}-${j}`,
        n: d.length,
        yield: d.length / Math.min(usable[i].feetMs.length, usable[j].feetMs.length),
        sd: sd(d),
        iqr: iqr(d),
        r1: lag1(d),
        sdAvg2: sd(avg2(d)),
        c1: Math.sqrt(pi * pi + pj * pj),
        snrPair: Math.min(usable[i].snr, usable[j].snr)
      });
    }
  return pairs.length ? { pairs } : null;
}

function selftest() {
  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!cond) fail++;
  };
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;

  console.log('\n### the estimand — pairwise dispersion recovers planted per-channel jitter');
  // three channels see the SAME 1000 beats; per-channel jitter 2 / 4 / 8 ms
  const base = [];
  let t = 0;
  for (let i = 0; i < 1000; i++) {
    t += 900 + rnd() * 200;
    base.push(t);
  }
  const chan = (j) => base.map((b) => b + rnd() * j * Math.sqrt(3)); // uniform, SD = j
  const A = chan(2);
  const B = chan(4);
  const C = chan(8);
  const dAB = pairSame(A, B);
  const dAC = pairSame(A, C);
  ok('same-beat pairing keeps ~every beat', dAB.length > 950, `${dAB.length}/1000`);
  const expAB = Math.sqrt(2 * 2 + 4 * 4);
  const expAC = Math.sqrt(2 * 2 + 8 * 8);
  ok('pair SD ≈ √(σi²+σj²) for 2⊕4', Math.abs(sd(dAB) - expAB) < 0.6, `${sd(dAB).toFixed(2)} vs ${expAB.toFixed(2)}`);
  ok('pair SD ≈ √(σi²+σj²) for 2⊕8', Math.abs(sd(dAC) - expAC) < 0.9, `${sd(dAC).toFixed(2)} vs ${expAC.toFixed(2)}`);

  console.log('\n### C4 — planted ALTERNATION is visible in r1 and collapses under a 2-beat average');
  const alt = base.map((b, i) => b + (i % 2 ? 6 : -6) + rnd() * 1);
  const clean = base.map((b) => b + rnd() * 1);
  const dAlt = pairSame(clean, alt);
  ok('alternating night reads r1 ≤ −0.3', lag1(dAlt) <= -0.3, `r1=${lag1(dAlt).toFixed(2)}`);
  ok('non-alternating night does not', Math.abs(lag1(pairSame(clean, chan(3)))) < 0.2, `r1=${lag1(pairSame(clean, chan(3))).toFixed(2)}`);
  ok('2-beat average collapses alternation ≥60 %', sd(avg2(dAlt)) < 0.4 * sd(dAlt), `${sd(dAlt).toFixed(2)} → ${sd(avg2(dAlt)).toFixed(2)}`);
  const dNoise = pairSame(clean, chan(6));
  ok('…but only halves plain noise (the discriminator)', sd(avg2(dNoise)) > 0.55 * sd(dNoise), `${sd(dNoise).toFixed(2)} → ${sd(avg2(dNoise)).toFixed(2)}`);

  console.log('\n### C1 — noiseRms and medianSlope read a synthetic pulse correctly');
  const fs2 = 100;
  const bp = new Float64Array(fs2 * 60);
  const feet = [];
  const peaks = [];
  for (let b = 0; b < 59; b++) {
    const f = b * fs2 + 10;
    const p = f + 20; // 200 ms rise
    for (let i = f; i <= p; i++) bp[i] = ((i - f) / (p - f)) * 100;
    for (let i = p + 1; i < f + fs2 && i < bp.length; i++) bp[i] = Math.max(0, 100 - (i - p) * 2.5);
    feet.push(f);
    peaks.push(p);
  }
  ok('medianSlope of a 100-unit/200 ms ramp is 0.5 u/ms', Math.abs(medianSlope(bp, feet, peaks, fs2) - 0.5) < 1e-9, `${medianSlope(bp, feet, peaks, fs2)}`);
  ok('medianAmp of the same pulse is 100', Math.abs(medianAmp(bp, feet, peaks) - 100) < 1e-9, `${medianAmp(bp, feet, peaks)}`);
  const noisy = bp.map((v) => v + rnd() * 3 * Math.sqrt(3)); // uniform, σ=3
  const nr = noiseRms(noisy);
  ok('noiseRms recovers planted σ=3 within 40 %', nr > 1.8 && nr < 4.2, `${nr.toFixed(2)}`);
  ok('noiseRms is robust to the pulse itself (clean pulse ≪ planted σ)', noiseRms(bp) < 1.0, `${noiseRms(bp).toFixed(3)}`);

  console.log('\n### Spearman — exact on monotone, ~0 on independent, sign on reversed');
  ok('monotone ⇒ +1', spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]) === 1);
  ok('reversed ⇒ −1', spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) === -1);
  const xs = [];
  const ys = [];
  for (let i = 0; i < 200; i++) {
    xs.push(rnd());
    ys.push(rnd());
  }
  ok('independent ⇒ |ρ| < 0.15', Math.abs(spearman(xs, ys)) < 0.15, `${spearman(xs, ys).toFixed(3)}`);

  console.log('\n### nightRow — the C1 predictor orders nights the way the planted noise does');
  const mk = (noise) => ({
    feetMs: base.map((b) => b + rnd() * noise * Math.sqrt(3)),
    snr: 10 / noise,
    noise,
    slope: 1
  });
  const quiet = nightRow([mk(1), mk(1), mk(1)]);
  const loud = nightRow([mk(6), mk(6), mk(6)]);
  ok('quiet night < loud night on every pair', quiet.pairs.every((p) => p.sd < Math.min(...loud.pairs.map((q) => q.sd))));
  ok('C1 predictor orders with it', quiet.pairs[0].c1 < loud.pairs[0].c1);
  ok('fewer than 2 usable channels refuses', nightRow([mk(1)]) === null);

  console.log(`\n${fail === 0 ? 'PASS — estimand, plants, predictors and refusals all hold' : `FAIL — ${fail} problem(s)`}`);
  return fail > 0 ? 1 : 0;
}

/* ── corpus runner ────────────────────────────────────────────────────────────────────────────── */
async function main() {
  if (argv.includes('--selftest')) process.exit(selftest());
  const DIR = arg('--dir', null);
  const SITE = arg('--site', 'ankle');
  const JSON_OUT = arg('--json', null);
  if (!DIR || !fs.existsSync(DIR)) {
    console.error('usage: node tools/ppg-foot-residual-sweep.mjs --selftest | --dir <captures root> [--site ankle|ring] [--json <out>]');
    process.exit(2);
  }
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Math, JSON, Date, Uint8Array, Int16Array, Float32Array, Float64Array, Array, Object, Number, String, isFinite, isNaN, parseInt, parseFloat });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  const P = ctx.PPGDSP;
  const RE = { ring: /o2ring.*_PPG\.txt$/i, ankle: /veritysense.*_PPG\.txt$|polar_sense.*_PPG\.txt$/i };
  /* Two corpus layouts, auto-detected: the box tree keeps date-named subdirectories
     (2026-07-17/…), the phone-tree mirror (`Ecg-nightly-archive`) is FLAT with the date only in
     the filename stamp (…_20260610_211539_PPG.txt). Both resolve to one candidate file per night —
     the largest, the convention every sibling uses. */
  const entries = fs.readdirSync(DIR);
  const dateDirs = entries.filter((n) => /^2026-/.test(n) && fs.statSync(path.join(DIR, n)).isDirectory()).sort();
  const perNight = new Map(); // night -> [{f,s}]
  if (dateDirs.length) {
    for (const n of dateDirs) {
      const dir = path.join(DIR, n);
      const c = fs
        .readdirSync(dir)
        .filter((f) => RE[SITE].test(f))
        .map((f) => ({ f: path.join(dir, f), s: fs.statSync(path.join(dir, f)).size }));
      if (c.length) perNight.set(n, c);
    }
  } else {
    for (const f of entries.filter((f) => RE[SITE].test(f))) {
      const m = /_(\d{8})\d{6}_|_(\d{8})_/.exec(f);
      if (!m) continue;
      const d = m[1] || m[2];
      const night = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      if (!perNight.has(night)) perNight.set(night, []);
      perNight.get(night).push({ f: path.join(DIR, f), s: fs.statSync(path.join(DIR, f)).size });
    }
  }
  const rows = [];
  console.log('night        pair    n    yield    SD      IQR     r1    SD(avg2)   C1(n/s)  ANRmin');
  for (const n of [...perNight.keys()].sort()) {
    const cand = perNight.get(n).sort((a, b) => b.s - a.s)[0];
    if (!cand) continue;
    let rec;
    try {
      rec = P.parsePPG(fs.readFileSync(cand.f, 'utf8'));
    } catch {
      continue;
    }
    if (!rec || !rec.ch || rec.ch.length < 2 || rec.t0Ms == null) continue;
    const per = rec.ch.map((c) => P.detectChannel(c, rec.fs));
    P.applyConsensusPolarity(per, (i, sgn) => P.detectChannel(rec.ch[i], rec.fs, sgn));
    const toMs = (i) => {
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      const fr = i - lo;
      const rel = rec.relSec;
      const okI = (k) => rel && rel[k] != null && isFinite(rel[k]);
      const sec = okI(lo) && okI(hi) ? rel[lo] + fr * (rel[hi] - rel[lo]) : i / rec.fs;
      return rec.t0Ms + sec * 1000;
    };
    const chans = per.map((p) => {
      const noise = noiseRms(p.bp);
      return {
        feetMs: p.feet.map(toMs),
        snr: medianAmp(p.bp, p.feet, p.peaks) / noise, // in-tool ANR — see the C2 header note
        noise,
        slope: medianSlope(p.bp, p.feet, p.peaks, rec.fs)
      };
    });
    const row = nightRow(chans);
    if (!row) {
      console.log(`${n}  ⊘ fewer than 2 pairable channels`);
      continue;
    }
    for (const p of row.pairs)
      console.log(
        `${n}  ${p.pair}  ${String(p.n).padStart(6)}  ${(100 * p.yield).toFixed(0).padStart(4)}%  ${p.sd.toFixed(2).padStart(6)}  ${p.iqr.toFixed(2).padStart(6)}  ${p.r1.toFixed(2).padStart(5)}  ${p.sdAvg2.toFixed(2).padStart(7)}  ${p.c1.toFixed(3).padStart(8)}  ${isFinite(p.snrPair) ? p.snrPair.toFixed(2).padStart(6) : '     —'}`
      );
    rows.push({ night: n, fs: rec.fs, ...row });
  }
  /* Cross-night Spearman per pre-registered candidate — worst pair per night, IQR as the estimand
     (the brief's figure), SD reported beside it. */
  const per = rows.map((r) => r.pairs.reduce((a, b) => (b.iqr > a.iqr ? b : a)));
  const y = per.map((p) => p.iqr);
  const table = [
    ['C1 noise/slope (expect ρ ≥ +0.7)', spearman(per.map((p) => p.c1), y)],
    ['C2 ANRmin (expect ρ ≤ −0.7)', spearman(per.map((p) => p.snrPair), y)],
    ['C3 yield (expect ρ ≤ −0.7)', spearman(per.map((p) => p.yield), y)],
    ['C4 r1 (expect top-half concentration at r1 ≤ −0.3)', spearman(per.map((p) => p.r1), y)]
  ];
  console.log(`\nCross-night Spearman vs worst-pair IQR (n=${rows.length} nights):`);
  for (const [k, v] of table) console.log(`  ${k}: ρ = ${isFinite(v) ? v.toFixed(3) : 'n/a'}`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

if (process.argv[1]?.endsWith('ppg-foot-residual-sweep.mjs')) await main();
