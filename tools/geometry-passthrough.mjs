/*
 * geometry-passthrough.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * DOES THE ALIGNMENT CHAIN INTRODUCE GEOMETRY THAT WAS NOT IN ITS INPUT?
 *
 * `geometry-scan.mjs` runs the probes over REAL recordings, which characterises DATA: it says this
 * night censors, that night steps. It cannot say whether a FUNCTION is wrong, because a real night's
 * true geometry is unknown — that is precisely what is being argued about.
 *
 * This is the software test, and it is the actual mutation analogue. Synthesize an ECG and a PPG whose
 * geometry is known EXACTLY — uniform sampling, a constant heart rate, and every PPG foot placed a
 * fixed LAG_MS after its R-peak — then push both through the PRODUCTION functions:
 *
 *     ECGDSP.parseECG -> bandpass -> detectPeaks -> tMsAt
 *     PPGDSP.parsePPG -> detectChannel -> foot
 *     pairing -> lag series -> 5-min bin medians
 *
 * The true lag is FLAT by construction, so every probe must stay silent and the recovered lag must
 * equal LAG_MS. Anything else was introduced by the code between input and output — a saturation, a
 * sawtooth, a step or a drawn ladder that no recording put there.
 *
 * Then the mutants: perturb the INPUT with one known shape at a time (a host-stamp step, a rate error,
 * a dropout) and assert the chain propagates it to the output where the probes can see it. A chain
 * that stays silent on a planted input defect is not clean, it is BLIND — the same failure as a gate
 * that cannot fail, which this project has shipped more than once.
 *
 * Usage:  node tools/geometry-passthrough.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { probeAll } from './geometry-probe.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const ECG_HZ = 130;
export const PPG_HZ = 55;
export const RR_MS = 1000;
export const LAG_MS = 300;
const PHYS_LO = 200,
  PHYS_HI = 650;

/* A clean ECG: uniform sampling, a sharp QRS every RR_MS, host stamps exactly on the sample grid.
   `sensor timestamp [ns]` and `timestamp [ms]` are both consistent with that grid, so nothing in the
   input carries a shape. */
export function synthEcg(durSec, opts) {
  const o = opts || {};
  const n = Math.round(durSec * ECG_HZ);
  const t0 = Date.UTC(2026, 7, 1, 22, 0, 0);
  const lines = ['Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]'];
  for (let i = 0; i < n; i++) {
    const relMs = (i / ECG_HZ) * 1000;
    // one known perturbation at a time, applied to the HOST stamp only
    const stepMs = o.hostStepMs && i > n / 2 ? o.hostStepMs : 0;
    const rateErr = o.hostPpm ? relMs * o.hostPpm * 1e-6 : 0;
    const hostMs = t0 + relMs + stepMs + rateErr;
    const phase = relMs % RR_MS;
    /* A REALISTIC QRS, ~90 ms Q-R-S, plus a T wave. The first fixture used a 12 ms triangle — 1.6
       samples at 130 Hz — which Pan-Tompkins cannot localise consistently because its integration
       window is sized for a real complex, so the recovered lag scattered by 130 ms on an input that is
       flat by construction. That scatter was the FIXTURE, not the chain. Fifth unrealistically clean
       fixture in this session; the rule keeps being the same one. */
    const q = phase >= 0 && phase < 20 ? -120 * Math.sin((Math.PI * phase) / 20) : 0;
    const r = phase >= 20 && phase < 50 ? 950 * Math.sin((Math.PI * (phase - 20)) / 30) : 0;
    const sw = phase >= 50 && phase < 90 ? -220 * Math.sin((Math.PI * (phase - 50)) / 40) : 0;
    const tw = phase >= 220 && phase < 400 ? 180 * Math.sin((Math.PI * (phase - 220)) / 180) : 0;
    const qrs = q + r + sw + tw;
    const base = 40 * Math.sin(relMs / 2300);
    const d = new Date(hostMs);
    const stamp = d.toISOString().replace('Z', '').slice(0, 23);
    lines.push(stamp + ';' + Math.round(relMs * 1e6) + ';' + relMs.toFixed(6) + ';' + Math.round(qrs + base));
  }
  return lines.join('\n') + '\n';
}

/* A clean PPG: uniform sampling, one pulse per RR_MS with its FOOT exactly LAG_MS after the matching
   R-peak. The pulse is a smooth rise-and-decay so the foot detector has a real upstroke to find. */
export function synthPpg(durSec, opts) {
  const o = opts || {};
  const n = Math.round(durSec * PPG_HZ);
  const t0 = Date.UTC(2026, 7, 1, 22, 0, 0);
  const lines = ['Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient'];
  for (let i = 0; i < n; i++) {
    const relMs = (i / PPG_HZ) * 1000;
    const stepMs = o.hostStepMs && i > n / 2 ? o.hostStepMs : 0;
    const rateErr = o.hostPpm ? relMs * o.hostPpm * 1e-6 : 0;
    const hostMs = t0 + relMs + stepMs + rateErr;
    // phase measured from the FOOT instant, which sits LAG_MS after each R
    let ph = (relMs - LAG_MS) % RR_MS;
    if (ph < 0) ph += RR_MS;
    const v = ph < 250 ? Math.sin((Math.PI * ph) / 250) : 0;
    /* THREE DISTINCT CHANNELS. Identical channels are the REPLICATED-column case: the parser collapses
       them to one and treats the file as O2Ring-like, which carries a 125 Hz assumption — so a 55 Hz
       fixture came back parsed at 125 and every downstream number was scrambled by 125/55. The parser
       is right; the fixture was unrealistic. A 3-LED sensor's channels differ in DC and amplitude. */
    const d = new Date(hostMs);
    const stamp = d.toISOString().replace('Z', '').slice(0, 23);
    const c0 = Math.round(400000 + 9000 * v);
    const c1 = Math.round(378000 + 7400 * v);
    const c2 = Math.round(601000 + 12500 * v);
    lines.push(stamp + ';' + Math.round(relMs * 1e6) + ';' + c0 + ';' + c1 + ';' + c2 + ';-130');
  }
  return lines.join('\n') + '\n';
}

export function loadDsp() {
  const DexBuild = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'build-core.js'));
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Math,
    JSON,
    Date,
    Uint8Array,
    Int16Array,
    Float32Array,
    Float64Array,
    Array,
    Object,
    Number,
    String,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    Infinity,
    NaN
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  return { E: ctx.ECGDSP, P: ctx.PPGDSP };
}

const asc = (a) =>
  Array.from(a)
    .filter(Number.isFinite)
    .sort((x, y) => x - y);
const qt = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
const med = (a) => qt(asc(a), 0.5);

function feetOf(bp, peaks, fsHz) {
  const out = [],
    W = Math.round((150 * fsHz) / 1000);
  for (let k = 0; k < peaks.length; k++) {
    const p = peaks[k],
      prev = k > 0 ? peaks[k - 1] : Math.max(0, p - W),
      lo = Math.max(prev, p - W);
    let mi = lo,
      mv = bp[lo];
    for (let j = lo; j < p; j++)
      if (bp[j] < mv) {
        mv = bp[j];
        mi = j;
      }
    let ms = mi,
      msv = -Infinity;
    for (let j = mi; j < p; j++) {
      const dv = bp[j + 1] - bp[j];
      if (dv > msv) {
        msv = dv;
        ms = j;
      }
    }
    out.push(msv > 1e-12 ? Math.max(lo, Math.min(p, ms - (bp[ms] - mv) / msv)) : ms);
  }
  return out;
}

/* Push one synthetic pair through the production chain and return what came out the other end. */
export function passthrough(dsp, durSec, ecgOpts, ppgOpts) {
  const { E, P } = dsp;
  const er = E.parseECG(synthEcg(durSec, ecgOpts));
  const R = Array.from(E.detectPeaks(er.int16, E.bandpass(er.int16, er.fs), er.fs)).map((i) => er.tMsAt(i));
  const pr = P.parsePPG(synthPpg(durSec, ppgOpts));
  const det = P.detectChannel(pr.ch[0], pr.fs);
  const n = pr.ch[0].length;
  const toMs = (i) => {
    const a = Math.floor(i),
      b = Math.min(n - 1, a + 1);
    const sa = pr.relSec && Number.isFinite(pr.relSec[a]) ? pr.relSec[a] : a / pr.fs;
    const sb = pr.relSec && Number.isFinite(pr.relSec[b]) ? pr.relSec[b] : b / pr.fs;
    return pr.t0Ms + (sa + (sb - sa) * (i - a)) * 1000;
  };
  const F = feetOf(det.bp, det.peaks, pr.fs).map(toMs);
  const lag = [];
  let j = 0;
  for (let i = 0; i + 1 < R.length; i++) {
    const r = R[i],
      rr = R[i + 1] - r;
    if (!(rr > 300 && rr < 2000)) continue;
    while (j < F.length && F[j] < r) j++;
    for (let k = j; k < F.length; k++) {
      const L = F[k] - r;
      if (L > 0.9 * rr) break;
      if (L > 0) {
        lag.push([r, L]);
        break;
      }
    }
  }
  const v = lag.map((x) => x[1]);
  const t0 = lag.length ? lag[0][0] : 0,
    t1 = lag.length ? lag[lag.length - 1][0] : 0,
    bm = [];
  for (let b = t0; b < t1; b += 300000) {
    const w = lag.filter((x) => x[0] >= b && x[0] < b + 300000).map((x) => x[1]);
    if (w.length >= 20) bm.push(med(w));
  }
  return {
    nR: R.length,
    nF: F.length,
    nPairs: v.length,
    ecgFs: er.fs,
    ppgFs: pr.fs,
    medLag: med(v),
    lagIqr: qt(asc(v), 0.75) - qt(asc(v), 0.25),
    binMed: bm,
    fired: probeAll(v, { lo: PHYS_LO, hi: PHYS_HI, period: RR_MS }).fired,
    binFired: bm.length >= 12 ? probeAll(bm, { lo: PHYS_LO, hi: PHYS_HI, period: RR_MS }).fired : []
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dsp = loadDsp();
  const DUR = 1800;
  const cases = [
    ['CLEAN — nothing planted', {}, {}],
    ['ECG host stamp STEP +400 ms', { hostStepMs: 400 }, {}],
    ['PPG host stamp STEP +400 ms', {}, { hostStepMs: 400 }],
    ['PPG host rate error +5000 ppm', {}, { hostPpm: 5000 }],
    ['ECG host rate error +5000 ppm', { hostPpm: 5000 }, {}]
  ];
  console.log('case                             fs(ecg/ppg)   pairs   medLag   IQR   | probes fired');
  for (const [name, eo, po] of cases) {
    const r = passthrough(dsp, DUR, eo, po);
    const all = r.fired.concat(r.binFired.map((x) => 'bin:' + x));
    console.log(
      name.padEnd(32) +
        (r.ecgFs.toFixed(1) + '/' + r.ppgFs.toFixed(1)).padStart(11) +
        String(r.nPairs).padStart(8) +
        (Number.isFinite(r.medLag) ? r.medLag.toFixed(1) : '-').padStart(9) +
        (Number.isFinite(r.lagIqr) ? r.lagIqr.toFixed(1) : '-').padStart(6) +
        '   | ' +
        (all.length ? all.join(', ') : '(none)')
    );
  }
}
