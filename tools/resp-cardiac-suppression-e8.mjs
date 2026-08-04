#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * resp-cardiac-suppression-e8.mjs — MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS §8
 * ------------------------------------------------------------------------------------------------
 * §8 names cardiac suppression as "the highest-value untried improvement": an adaptive notch at the
 * measured f_HR and 2f_HR on the H10's accelerometer, free because the ECG is co-recorded on the same
 * strap. It also supplies its own caveat, and the caveat is the reason this tool exists rather than a
 * notch:
 *
 *     "the shipped 4th-order zero-phase band-pass already attenuates -36.6 dB at 0.8 Hz, better than
 *      the literature synthesis's own recommendation, so the gain may be small — MEASURE BEFORE
 *      BUILDING."
 *
 * WHAT IS ACTUALLY BEING ASKED. A notch can only help if cardiac energy survives into the band the
 * estimator reads. `respChannel` band-passes 0.13-0.5 Hz (4th order each way, applied zero-phase by
 * filtfilt, so effectively 8th order) on a 5 Hz grid. The cardiac fundamental for this corpus sits at
 * 0.83-1.0 Hz (50-60 bpm) — ABOVE the 0.5 Hz corner, not inside the passband. So the question is not
 * "is the heart visible in the accelerometer" (it is, that is what seismocardiography reads) but "how
 * much of it is left AFTER the filter the estimator already applies". That is a ratio, and it is
 * measurable without building anything.
 *
 * SO THIS MEASURES, per night:
 *   f_HR         from the paired H10 ECG (shipped ECGDSP detector, median RR) — the true rate, not a
 *                spectral guess off the accelerometer, which would be circular
 *   before/after cardiac power at f_HR and 2f_HR relative to the respiratory peak, on the SAME
 *                projection, with and without the shipped band-pass
 * A notch is worth building only if the AFTER ratio is high enough that removing it could move an
 * estimate. If cardiac is already tens of dB below the respiratory peak, no notch can recover
 * anything, and §8's own caveat is confirmed rather than assumed.
 *
 * WHY THE RATIO AND NOT THE ABSOLUTE POWER: the estimator picks a spectral PEAK in 0.13-0.5 Hz. What
 * can corrupt it is another peak comparable in height, not absolute energy somewhere in the record.
 *
 * SHIPPED CODE ONLY — MotionDex's `parseSensorXYZ`, RespAccAnalysis' own `respChannel` / `toGrid` /
 * `butterSOS` / `filtfilt`, ECGDSP's detector. The only new code is the periodogram, exercised
 * corpus-free by `--selftest` against planted sinusoids of known ratio.
 *
 * USAGE
 *   node tools/resp-cardiac-suppression-e8.mjs --dir <captures> [--max-nights 12]
 *   node tools/resp-cardiac-suppression-e8.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { median, quantile } from './ppi-match.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const MAX_NIGHTS = +opt('--max-nights', 12);

const FSC = 5; // Hz — RespAccAnalysis' common grid (its own _const.FSC; asserted at run time)
const RESP_LO = 0.13,
  RESP_HI = 0.5; // the band respChannel passes and the estimator reads

/* ── Welch periodogram. Hann-windowed, 50 % overlap, mean-removed per segment. Returns
      { f:[Hz], p:[power] }. Written here rather than borrowed because nothing in the spine exposes a
      PSD, and a 600-point DFT per segment is cheap at 5 Hz. ─────────────────────────────────────── */
export function welch(x, fs, segSec) {
  const n = Math.min(x.length, Math.max(64, Math.round((segSec || 120) * fs)));
  const step = Math.max(1, Math.floor(n / 2));
  const nf = Math.floor(n / 2) + 1;
  const acc = new Float64Array(nf);
  let segs = 0;
  const w = new Float64Array(n);
  let wp = 0;
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    wp += w[i] * w[i];
  }
  for (let s = 0; s + n <= x.length; s += step) {
    let m = 0;
    for (let i = 0; i < n; i++) m += x[s + i];
    m /= n;
    for (let k = 0; k < nf; k++) {
      let re = 0,
        im = 0;
      const c = (-2 * Math.PI * k) / n;
      for (let i = 0; i < n; i++) {
        const v = (x[s + i] - m) * w[i];
        re += v * Math.cos(c * i);
        im += v * Math.sin(c * i);
      }
      acc[k] += (re * re + im * im) / (fs * wp);
    }
    segs++;
  }
  if (!segs) return null;
  const f = new Float64Array(nf),
    p = new Float64Array(nf);
  for (let k = 0; k < nf; k++) {
    f[k] = (k * fs) / n;
    p[k] = acc[k] / segs;
  }
  return { f, p };
}

/* peak power inside [lo,hi], and the frequency it sits at */
export function bandPeak(psd, lo, hi) {
  let best = -1,
    bf = null;
  for (let k = 0; k < psd.f.length; k++) {
    if (psd.f[k] < lo || psd.f[k] > hi) continue;
    if (psd.p[k] > best) {
      best = psd.p[k];
      bf = psd.f[k];
    }
  }
  return best < 0 ? null : { power: best, hz: bf };
}

/* power at a target frequency, taken as the max within +/- tol so a slightly-drifting HR is not
   missed by landing between bins */
export function powerAt(psd, hz, tol) {
  return bandPeak(psd, hz - (tol || 0.03), hz + (tol || 0.03));
}

const db = (r) => 10 * Math.log10(Math.max(r, 1e-30));

/* ════════════════════════════════════════════ SELFTEST ═════════════════════════════════════════ */
function selftest() {
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? '  ok   ' : '  FAIL ') + m);
    if (!c) fail++;
  };
  const fs = FSC,
    dur = 600;
  const n = fs * dur;
  // planted: respiration 0.25 Hz amplitude 1, cardiac 1.0 Hz amplitude 0.1 -> power ratio -20 dB
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    x[i] = Math.sin(2 * Math.PI * 0.25 * t) + 0.1 * Math.sin(2 * Math.PI * 1.0 * t);
  }
  const psd = welch(x, fs, 120);
  ok(!!psd, 'welch returns a spectrum');
  const rp = bandPeak(psd, RESP_LO, RESP_HI);
  ok(rp && Math.abs(rp.hz - 0.25) < 0.02, `the respiratory peak is found at ${rp ? rp.hz.toFixed(3) : 'n/a'} Hz (planted 0.25)`);
  const cp = powerAt(psd, 1.0, 0.03);
  const ratio = db(cp.power / rp.power);
  ok(Math.abs(ratio - -20) < 1.5, `the planted -20 dB cardiac:respiratory ratio measures ${ratio.toFixed(1)} dB`);

  // a pure respiratory signal must show essentially nothing at 1 Hz
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = Math.sin((2 * Math.PI * 0.25 * i) / fs);
  const psd2 = welch(y, fs, 120);
  ok(db(powerAt(psd2, 1.0, 0.03).power / bandPeak(psd2, RESP_LO, RESP_HI).power) < -60, 'a cardiac-free signal reads far below -60 dB at f_HR');

  // and the measurement must not be fooled by a peak OUTSIDE the respiratory band
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = 5 * Math.sin((2 * Math.PI * 1.0 * i) / fs) + Math.sin((2 * Math.PI * 0.25 * i) / fs);
  const psd3 = welch(z, fs, 120);
  ok(Math.abs(bandPeak(psd3, RESP_LO, RESP_HI).hz - 0.25) < 0.02, 'a large 1 Hz peak does not become the respiratory peak — the band is respected');
  ok(db(powerAt(psd3, 1.0, 0.03).power / bandPeak(psd3, RESP_LO, RESP_HI).power) > 10, '…and it is correctly reported as a POSITIVE cardiac:respiratory ratio');

  console.log(fail ? `\nselftest: ${fail} FAILURE(S)` : '\nselftest: all green');
  return fail;
}

if (SELFTEST) process.exit(selftest() ? 1 : 0);
if (!DIR) {
  console.error('need --dir <captures>  (or --selftest)');
  process.exit(2);
}

/* ═══════════════════════════════════════════ CORPUS RUN ════════════════════════════════════════ */
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
function realm(files) {
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
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const Mr = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'motiondex-registry.js', 'motiondex-dsp.js']);
const M = Mr.MotionDSP || Mr.MOTIONDSP || Mr.MotionDex;
const A = realm(['resp-acc-analysis.js']).RespAccAnalysis;
const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;
if (!M || typeof M.parseSensorXYZ !== 'function') {
  console.error('MotionDex parseSensorXYZ unavailable — cannot parse the H10 ACC stream');
  process.exit(2);
}
if (A._const.FSC !== FSC) {
  console.error(`grid mismatch: RespAccAnalysis FSC=${A._const.FSC}, this tool assumes ${FSC}`);
  process.exit(2);
}

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
const all = walk(DIR);
const accs = all
  .filter((f) => /H10.*_ACC\.txt$/i.test(f.p))
  .sort((a, b) => b.size - a.size)
  .slice(0, MAX_NIGHTS);

console.log('MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS §8 — is there cardiac energy left to notch?');
console.log(`grid ${FSC} Hz · respiratory band ${RESP_LO}-${RESP_HI} Hz · f_HR from the paired H10 ECG\n`);
console.log('night                                   f_HR    respHz   BEFORE band-pass        AFTER band-pass');
console.log('                                        (Hz)             fHR_dB   2fHR_dB        fHR_dB   2fHR_dB');

const rows = [];
for (const f of accs) {
  let rowsXYZ;
  try {
    rowsXYZ = M.parseSensorXYZ(readFileSync(f.p, 'utf8'));
  } catch (_e) {
    continue;
  }
  if (!rowsXYZ || rowsXYZ.length < FSC * 600) continue;

  /* f_HR from the paired ECG — the SAME session, which Polar Sensor Logger guarantees by writing one
     14-digit stamp per session across every stream (`..._20260716213451_{ACC,ECG,HR}.txt`). So the
     pairing is a filename substitution, not an overlap search, and a missing sibling is skipped rather
     than approximated with a neighbouring session's heart rate. */
  const ecgPath = f.p.replace(/_ACC\.txt$/i, '_ECG.txt');
  let fHR = null;
  try {
    const er = E.parseECG(readFileSync(ecgPath, 'utf8'));
    const eres = E.analyze(er);
    if (eres && eres.peaks && eres.peaks.length > 100) {
      const rr = [];
      for (let i = 1; i < eres.peaks.length; i++) {
        const d = (eres.peaks[i] - eres.peaks[i - 1]) / er.fs;
        if (d > 0.3 && d < 2) rr.push(d);
      }
      if (rr.length > 50) fHR = 1 / median(rr);
    }
  } catch (_e) {}
  if (!fHR) continue;

  // AFTER: exactly what the estimator reads
  const rc = A.respChannel(rowsXYZ);
  if (!rc || !rc.channel || rc.channel.length < FSC * 600) continue;
  // BEFORE: the same dominant projection on the same grid, WITHOUT the 0.13-0.5 band-pass
  const keys = ['x', 'y', 'z'];
  const chRaw = [];
  for (let a = 0; a < 3; a++) {
    const v = new Float64Array(rowsXYZ.length);
    for (let i = 0; i < rowsXYZ.length; i++) v[i] = rowsXYZ[i][keys[a]];
    chRaw.push(A.toGrid(v, rc.hz));
  }
  const before = A.dominantProjection(chRaw);

  const pB = welch(before, FSC, 120),
    pA = welch(rc.channel, FSC, 120);
  if (!pB || !pA) continue;
  const rB = bandPeak(pB, RESP_LO, RESP_HI),
    rA = bandPeak(pA, RESP_LO, RESP_HI);
  if (!rB || !rA) continue;
  const f2 = Math.min(2 * fHR, FSC / 2 - 0.05);
  const row = {
    name: f.p
      .split('/')
      .pop()
      .replace(/Polar_H10_\d+_/, '')
      .replace('_ACC.txt', '')
      .slice(0, 30),
    fHR,
    respHz: rA.hz,
    bF: db(powerAt(pB, fHR).power / rB.power),
    b2: db(powerAt(pB, f2).power / rB.power),
    aF: db(powerAt(pA, fHR).power / rA.power),
    a2: db(powerAt(pA, f2).power / rA.power)
  };
  rows.push(row);
  const n1 = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
  console.log(`${row.name.padEnd(40)} ${fHR.toFixed(3)}   ${rA.hz.toFixed(3)}    ${n1(row.bF).padStart(7)}  ${n1(row.b2).padStart(7)}       ${n1(row.aF).padStart(7)}  ${n1(row.a2).padStart(7)}`);
}

if (!rows.length) {
  console.log('\nno night scored — §8 cannot be adjudicated on this corpus.');
  process.exit(0);
}
const col = (k) => rows.map((r) => r[k]);
const fmt = (a) => `median ${median(a).toFixed(1)}  IQR ${quantile(a, 0.25).toFixed(1)}–${quantile(a, 0.75).toFixed(1)}`;
console.log(`\n${rows.length} night(s)\n`);
console.log(`  cardiac : respiratory-peak power, in dB (negative = cardiac is BELOW the respiratory peak)`);
console.log(`    at f_HR    before band-pass  ${fmt(col('bF'))} dB`);
console.log(`               AFTER  band-pass  ${fmt(col('aF'))} dB`);
console.log(`    at 2f_HR   before band-pass  ${fmt(col('b2'))} dB`);
console.log(`               AFTER  band-pass  ${fmt(col('a2'))} dB`);
console.log(`\n  f_HR ${fmt(col('fHR').map((v) => v * 1))} Hz   ·   respiratory peak ${fmt(col('respHz'))} Hz`);
const worst = Math.max(...col('aF'), ...col('a2'));
console.log(`\n  WORST post-filter cardiac ratio on any night: ${worst.toFixed(1)} dB`);
console.log('  A notch can only recover what survives the filter already applied. Read that number');
console.log('  against the respiratory peak it would have to compete with — the estimator picks the');
console.log('  LARGEST peak in 0.13-0.5 Hz, so a component this far down cannot move the pick.');
