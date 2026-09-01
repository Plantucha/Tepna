#!/usr/bin/env node
/*
 * tools/pat-per-led.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * EACH LED AS AN INDEPENDENT DETECTOR — and a three-cornered hat that measures FIDUCIAL JITTER directly.
 *
 * The Verity's three optical channels are the SAME green wavelength through the same tissue; they
 * differ only in SNR. That has a consequence nothing in this repo has used: they are three
 * INDEPENDENT MEASUREMENTS OF THE SAME EVENT. Differencing two of them cancels the beat — every
 * physiological term, PEP, PTT, respiratory modulation, heart-rate variation, all of it — and leaves
 * only detector noise.
 *
 *     Var(foot_i − foot_j) = σ²_i + σ²_j        (no physiology term: same beat, same instant)
 *
 * so the classic three-cornered hat returns σ per LED, and that σ IS the fiducial error — the term
 * `pat-literature-spec.mjs` had to take from the literature (5.69 ms, intersecting-tangent RMSE)
 * because nothing here could measure it. Now it can be measured on this corpus, on this hardware.
 *
 * NO CONSENSUS, NO RANKING, NO SELECTION. Every LED waveform is a first-class sensor and all of them
 * are reported. This is a deliberate rejection of BOTH collapsing strategies currently in the tree:
 *
 *   · `consensusBeats` clusters peaks across channels at ±50 ms and re-derives feet on ONE reference
 *     channel. Measured 2026-08-03 (475 min): per-LED foot-to-foot SD 120.9 / 118.8 / 118.0 ms,
 *     consensus 133.2 ms — WORSE than the worst individual channel.
 *   · `ppgFootTimes` picks that reference by PEAK COUNT, which rewards over-detection.
 *   · `PPGDSP.pickChannel` ranks by pulse-band SNR and picks a single winner.
 *
 * All three throw away two thirds of the available information. Three channels are three measurements;
 * ranking them keeps one and discards the rest, and a rank is itself an estimate that can be wrong.
 * Keeping all three costs nothing and buys the one thing a single channel can never provide: their
 * DISAGREEMENT, which is a direct read on detector error with no reference and no assumption. That is
 * what makes the hat below possible at all — you cannot difference a channel against itself.
 *
 * SNR is therefore REPORTED as an observation and never used to choose. If one channel is worse, that
 * shows up in its own σ, where it is information rather than a discarded input.
 *
 * WHAT IS REPORTED
 *   · per-LED foot-to-foot SD and PAT against the ECG (each LED standalone, no consensus)
 *   · pairwise inter-LED difference SD — pure detector noise
 *   · TCH σ per LED — the fiducial jitter, measured not assumed
 *   · a negative variance is REFUSED, never square-rooted (it would mean the LEDs are not
 *     independent, which for three channels in one housing is a real possibility worth surfacing)
 *
 *   node tools/pat-per-led.mjs --dir <captures root> [--night 2026-08-03] [--site ankle|ring]
 */
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
const DIR = arg('--dir', null),
  ONLY = arg('--night', null),
  SITE = arg('--site', 'ankle');
if (!DIR && !argv.includes('--selftest')) {
  console.error('need --dir  (or --selftest)');
  process.exit(1);
}
const PHYS_LO = 200,
  PHYS_HI = 650; // mirrored from pat-align.js
const MATCH_TOL_MS = 150; // same-beat matching across LEDs; « one RR, » any plausible jitter

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
  parseFloat
});
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'])
  try {
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  } catch (e) {
    console.error('load fail', f, e.message.slice(0, 100));
  }
const E = ctx.ECGDSP,
  P = ctx.PPGDSP;

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
};
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
const ffd = (F) => {
  const o = [];
  for (let i = 1; i < F.length; i++) o.push(F[i] - F[i - 1]);
  return o;
};
const RE = { ring: /o2ring.*_PPG\.txt$/i, ankle: /veritysense.*_PPG\.txt$/i };

function patLags(R, F) {
  const out = [];
  let j = 0;
  for (const r of R) {
    while (j < F.length && F[j] < r) j++;
    for (let k = j; k < F.length; k++) {
      const lag = F[k] - r;
      if (lag > PHYS_HI) break;
      if (lag >= PHYS_LO) {
        out.push(lag);
        break;
      }
    }
  }
  return out;
}
/* match the SAME beat across two LED foot trains — nearest within tol, one-to-one, monotone */
function pairSame(A, B) {
  const d = [];
  let j = 0;
  for (const a of A) {
    while (j < B.length && B[j] < a - MATCH_TOL_MS) j++;
    if (j >= B.length) break;
    if (Math.abs(B[j] - a) <= MATCH_TOL_MS) d.push(B[j] - a);
  }
  return d;
}

/* ── the SNR column, wired for real (PPG-FOOT-PLACEMENT-FOLLOWUPS §2, 2026-09-01) ────────────────
   The original line read `P.channelSNR ? P.channelSNR(c, pr.fs).snr : NaN` — and `channelSNR` is
   LOCAL to ppgdex-dsp.js (line ~830), never on the PPGDSP namespace, so the guard took the NaN arm
   on every run and this column printed "n/a" from the day the tool was written: a guard that makes
   an absence look like data. This wrapper computes the IDENTICAL spectral quantity by DELEGATING
   to the exported `bandpass`/`std` (same mid-recording ≤90 s window, same 0.7–3.0 Hz pulse band
   over 4.0–8.0 Hz noise band) — no DSP edit, no re-bundle. If `channelSNR` itself is ever exported
   (it rides the next real re-bundle, not its own), delete this and call it. */
function chanSNR(sig, fs) {
  const win = Math.min(sig.length, Math.max(Math.round(fs * 90), Math.round(fs * 20)));
  let s0 = Math.floor((sig.length - win) / 2);
  if (s0 < 0) s0 = 0;
  const slice = s0 === 0 && win === sig.length ? sig : sig.subarray(s0, s0 + win);
  const pulse = P.bandpass(slice, fs, 0.7, 3.0);
  const noise = P.bandpass(slice, fs, 4.0, 8.0);
  return P.std(pulse) / (P.std(noise) || 1e-6);
}

/* Selftest pins the wrapper against arithmetic, not against the function it mirrors (which is
   unreachable — that being the point). A 1.5 Hz "pulse" plus a 6.0 Hz "noise" tone, both mid-band:
   the ratio tracks A/B, and doubling the noise amplitude halves the SNR (a gain-independent
   known-answer, so a wrapper returning a constant or the wrong band FAILS it). */
function selftest() {
  const fs = 55;
  const N = fs * 120;
  const mk = (A, B) => {
    const s = new Float64Array(N);
    for (let i = 0; i < N; i++) s[i] = A * Math.sin((2 * Math.PI * 1.5 * i) / fs) + B * Math.sin((2 * Math.PI * 6.0 * i) / fs);
    return s;
  };
  const fails = [];
  const ok = (c, m) => {
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`);
    if (!c) fails.push(m);
  };
  const s1 = chanSNR(mk(10, 1), fs);
  const s2 = chanSNR(mk(10, 2), fs);
  ok(s1 > 5 && s1 < 20, `A/B=10 lands near 10 through both passbands (got ${s1.toFixed(2)})`);
  ok(Math.abs(s1 / s2 - 2) < 0.15, `doubling the noise tone halves SNR (ratio ${(s1 / s2).toFixed(3)})`);
  ok(chanSNR(mk(1, 10), fs) < 1, `noise-dominated signal reads SNR < 1 (got ${chanSNR(mk(1, 10), fs).toFixed(2)})`);
  console.log(fails.length ? `SELFTEST FAIL (${fails.length})` : 'SELFTEST PASS (3/3)');
  return fails.length === 0;
}
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

console.log('PER-LED PAT — each optical channel as its own detector (no consensus)');
console.log('  inter-LED differences cancel the beat, so their TCH gives FIDUCIAL jitter directly\n');
const nights = fs
  .readdirSync(DIR)
  .filter((n) => /^2026-/.test(n) && (!ONLY || n === ONLY) && fs.statSync(path.join(DIR, n)).isDirectory())
  .sort();
for (const n of nights) {
  const dir = path.join(DIR, n);
  const big = (re) =>
    fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ f: path.join(dir, f), s: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => b.s - a.s)[0];
  const eF = big(/Polar_H10_.*_ECG\.txt$/i),
    pF = big(RE[SITE]);
  if (!eF || !pF) {
    console.log(`  ${n}  ⊘ missing a stream`);
    continue;
  }
  let er, pr;
  try {
    er = E.parseECG(fs.readFileSync(eF.f, 'utf8'));
    pr = P.parsePPG(fs.readFileSync(pF.f, 'utf8'));
  } catch {
    console.log(`  ${n}  ⊘ parse failed`);
    continue;
  }
  if (!er || !pr || !pr.ch) {
    console.log(`  ${n}  ⊘ no channels`);
    continue;
  }
  const R = Array.from(E.detectPeaks(er.int16, E.bandpass(er.int16, er.fs), er.fs)).map((i) => er.t0Ms + (i / er.fs) * 1000);
  const toMs = (i) => {
    const s = pr.relSec && pr.relSec[i] != null && isFinite(pr.relSec[i]) ? pr.relSec[i] : i / pr.fs;
    return pr.t0Ms + s * 1000;
  };
  const per = pr.ch.map((c) => P.detectChannel(c, pr.fs));
  const feet = per.map((p) => p.feet.map(toMs));
  const snr = pr.ch.map((c) => chanSNR(c, pr.fs));
  console.log(`  ${n} · ${SITE} · ${pr.ch.length} channel(s) · fs ${pr.fs.toFixed(2)} Hz · ECG R-peaks ${R.length}`);
  console.log('     LED   SNR    feet   foot-foot SD |  PAT n   yield   med     SD');
  for (let c = 0; c < feet.length; c++) {
    if (feet[c].length < 200) {
      console.log(`      ${c}    —    ${String(feet[c].length).padStart(6)}   (too few feet)`);
      continue;
    }
    const L = patLags(R, feet[c]);
    const medS = L.length ? med(L).toFixed(0).padStart(6) : '     —';
    const sdS = L.length ? sd(L).toFixed(1).padStart(7) : '      —';
    const snrS = (isFinite(snr[c]) ? snr[c].toFixed(2) : 'n/a').padStart(5);
    console.log(
      `      ${c}  ${snrS} ${String(feet[c].length).padStart(7)} ${sd(ffd(feet[c])).toFixed(1).padStart(11)} ms | ${String(L.length).padStart(6)} ${((100 * L.length) / R.length).toFixed(0).padStart(4)}% ${medS} ${sdS}`
    );
  }
  if (feet.length < 3) {
    console.log(`     (only ${feet.length} channel — no inter-LED hat possible)\n`);
    continue;
  }
  const dAB = pairSame(feet[0], feet[1]),
    dAC = pairSame(feet[0], feet[2]),
    dBC = pairSame(feet[1], feet[2]);
  if (dAB.length < 100 || dAC.length < 100 || dBC.length < 100) {
    console.log('     (too few same-beat matches for the hat)\n');
    continue;
  }
  const vAB = sd(dAB) ** 2,
    vAC = sd(dAC) ** 2,
    vBC = sd(dBC) ** 2;
  console.log(`     inter-LED difference SD (physiology CANCELLED): 0-1 ${Math.sqrt(vAB).toFixed(2)} · 0-2 ${Math.sqrt(vAC).toFixed(2)} · 1-2 ${Math.sqrt(vBC).toFixed(2)} ms`);
  const a2 = (vAB + vAC - vBC) / 2,
    b2 = (vAB + vBC - vAC) / 2,
    c2 = (vAC + vBC - vAB) / 2;
  const rep = (v) => (v > 0 ? `${Math.sqrt(v).toFixed(2)} ms` : `REFUSED (negative variance) — the LEDs are not independent`);
  console.log(`     TCH fiducial jitter:  LED0 ${rep(a2)} · LED1 ${rep(b2)} · LED2 ${rep(c2)}`);
  console.log(`     → literature fiducial term for comparison: 5.69 ms (intersecting-tangent RMSE)\n`);
}
