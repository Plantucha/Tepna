#!/usr/bin/env node
/*
 * tools/tch-firmware-reference.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE HR THREE-CORNERED HAT, CHECKED AGAINST A REFERENCE IT DOES NOT CONTAIN — every night, as a verdict.
 *
 * sensor-trio-night.html splits the HR disagreement of H10 · Verity · O2Ring into one σ per device with a
 * three-cornered hat. The hat cannot check itself, and `tools/r5-hr-reference.mjs` proves why a corner
 * cannot check it either: measured against one of its own corners, the comparison is an identity.
 *
 * THE REFERENCE is a FOURTH series: the beat intervals on which TWO INDEPENDENT R-PEAK DETECTORS agree —
 * ECGDex Pan–Tompkins on the raw `_ECG.txt`, and the strap FIRMWARE's own detector (`_RR.txt`), time-paired
 * window by window with `tools/oracle-ecg-firmware-rr.mjs`'s own functions (firmwareHostTimes →
 * per-window coincidenceLag → pairByTime) and kept only where the two intervals agree within
 * AGREE_MS (one 130 Hz sample is 7.7 ms). Per second: the median HR of those consensus intervals.
 *
 * THE CORNERS are built exactly as the page builds them, by the page's own worker functions: H10 from
 * `ecgHrMap` (Pan–Tompkins on the raw ECG), Verity from `ppgHrMapReal`, O2Ring from `o2MarkerHrMap` (its
 * `156` beat markers) with the page's fallbacks. For each: TRUE σ = SD(corner − reference), BIAS = mean,
 * and the error correlations ρ between corners, all on the seconds where the reference and all three
 * corners exist.
 *
 * JUDGED: the Verity and O2Ring corners. The H10 corner is REPORTED, NEVER JUDGED — the reference is
 * built from its own detections, so its measured error is a lower bound on a quantity the reference
 * cannot see (r5's rule, one step removed).
 *
 * TWO ESTIMATORS, ONE BAND (pre-stated 2026-09-26, before the first run):
 *   a corner PASSES when |σ_est − σ_true| ≤ BAND_ABS bpm OR ≤ BAND_REL × σ_true;
 *   an estimator is PASS when ≥ PASS_FRAC of the judged night-corners pass; UNDERPOWERED below MIN_NIGHTS.
 *   - classic hat (ρ = 0) — what sensor-trio-night shows today. THIS IS THE VERDICT'S STATUS.
 *   - correlated hat — `AnalysisStats.tchSigmasPairwiseFromVars` with the three error correlations
 *     MEASURED AGAINST THE REFERENCE, taken LEAVE-ONE-OUT (median over the OTHER nights). Never the
 *     night's own ρ: TCH-CORRELATED-SOLVE-KNIFE-EDGE §5 proves a ρ measured on the same data is the ρ at
 *     which a corner's σ collapses, and this reference shares the H10's beats. Reported beside the classic
 *     verdict as `result.correlated`; it becomes the page's estimator only if it passes the same band.
 *
 * MEASURED 2026-09-26 (Wren, rig, 37 box nights): classic hat 53/74 = 72 % — FAIL. Verity σ̂ 0.41 against a
 * true 0.73 bpm (hat below true on 32/36), O2Ring 1.46 vs 1.71 (all 37 within the band), H10 0.97 vs a
 * measured 0.81. Optical error correlation ρ(V,O) median 0.32, and bias ≤ 0.04 bpm on every corner. The
 * correlated hat with leave-one-out ρ moved every corner toward truth (Verity 0.61, H10 0.85) but
 * refused 10/36 nights and passed 60 % — also FAIL. WHY, and it is a property of the data, not a tuning
 * miss: the small optical corner is NOT IDENTIFIABLE when ρ(V,O) approaches σ_V/σ_O, because
 * ∂var(V−O)/∂σ_V = 2(σ_V − ρσ_O) → 0 and the difference variances stop depending on σ_V. These nights sit
 * there — ρ ≈ 0.32 against σ_V/σ_O ≈ 0.73/1.71 = 0.43 — so no ρ, measured or guessed, separates the two
 * optical corners reliably from pairwise differences alone. The reference-measured σ does not need to:
 * on a night with firmware RR it IS the answer, and this tool publishes it.
 *
 * NIGHTLY: `--ledger <file.jsonl>` keeps one row per scored night (append-only, outside the repo — these
 * are numbers about a person's nights) and a run scores only the nights the ledger lacks, then pools ALL
 * rows for the verdict. The corpus stays where it is; nothing here is committed data.
 *
 *   node tools/tch-firmware-reference.mjs --selftest
 *   node tools/tch-firmware-reference.mjs --verdict-sample            # corpus-free shape the adoption gate reads
 *   node tools/tch-firmware-reference.mjs --dir <captures root> [--night 2026-09-25]… [--ledger f.jsonl] [--json]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coincidenceLag, firmwareHostTimes, pairByTime } from './oracle-ecg-firmware-rr.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const req = createRequire(import.meta.url);
const AS = req(path.join(ROOT, 'analysis-stats.js'));

export const AGREE_MS = 8;
export const BAND_ABS = 0.3;
export const BAND_REL = 0.3;
export const PASS_FRAC = 0.8;
export const MIN_NIGHTS = 10;
export const MIN_SECONDS = 1000;
const KEYS = ['h10', 'verity', 'o2'];
const JUDGED = ['verity', 'o2'];

/* ── pure core ─────────────────────────────────────────────────────────────────────────────────── */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
export function median(a) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function corr(x, y) {
  const mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
export function withinBand(est, truth) {
  return Number.isFinite(est) && Number.isFinite(truth) && (Math.abs(est - truth) <= BAND_ABS || Math.abs(est - truth) <= BAND_REL * truth);
}
/* Consensus reference: pairs of consecutive self↔firmware matches whose intervals agree within AGREE_MS.
   selfMs/selfNN: our beat times (host ms) and the NN interval ending at each; fwMs/fwRR: firmware beat
   times already on the host axis (lag-corrected) and its intervals. Returns [[sec, hr], …]. */
export function consensusPairs(selfMs, selfNN, fwMs, fwRR, tolMs = 150) {
  const P = pairByTime(selfMs, fwMs, tolMs).pairs,
    out = [];
  let consecutive = 0;
  for (let k = 1; k < P.length; k++) {
    const [i, j] = P[k],
      [i0, j0] = P[k - 1];
    if (!(i === i0 + 1 && j === j0 + 1)) continue;
    consecutive++;
    if (Math.abs(selfNN[i] - fwRR[j]) <= AGREE_MS) out.push([Math.floor(selfMs[i] / 1000), 60000 / ((selfNN[i] + fwRR[j]) / 2)]);
  }
  return { pairs: out, consecutive };
}
export function perSecondMedian(pairs) {
  const by = new Map();
  for (const [s, v] of pairs) (by.get(s) || by.set(s, []).get(s)).push(v);
  const out = new Map();
  for (const [s, a] of by) out.set(s, median(a));
  return out;
}
/* One night's numbers from four aligned per-second maps (reference + three corners). */
export function scoreSeries(REF, H, V, O) {
  const ks = [...REF.keys()].filter((s) => H.has(s) && V.has(s) && O.has(s)).sort((a, b) => a - b);
  if (ks.length < MIN_SECONDS) return { ok: false, reason: ks.length + ' s with the reference and all three corners (< ' + MIN_SECONDS + ')', n: ks.length };
  const g = (M) => ks.map((s) => M.get(s)),
    ref = g(REF),
    X = { h10: g(H), verity: g(V), o2: g(O) },
    E = {},
    trueSd = {},
    bias = {};
  for (const k of KEYS) {
    E[k] = X[k].map((x, i) => x - ref[i]);
    trueSd[k] = sd(E[k]);
    bias[k] = mean(E[k]);
  }
  const diffVar = (a, b) => AS.variance(X[a].map((x, i) => x - X[b][i]));
  const vHV = diffVar('h10', 'verity'),
    vHO = diffVar('h10', 'o2'),
    vVO = diffVar('verity', 'o2');
  const c = AS.threeCorneredHat(vHV, vHO, vVO);
  const hat = { h10: c.a >= 0 ? Math.sqrt(c.a) : null, verity: c.b >= 0 ? Math.sqrt(c.b) : null, o2: c.c >= 0 ? Math.sqrt(c.c) : null };
  const rho = { hv: corr(E.h10, E.verity), ho: corr(E.h10, E.o2), vo: corr(E.verity, E.o2) };
  return { ok: true, n: ks.length, trueSd, bias, hat, rho, vars: { hv: vHV, ho: vHO, vo: vVO } };
}
/* Correlated hat for ONE night with ρ taken from the OTHER nights (leave-one-out). */
export function correlatedLOO(rows, idx) {
  const others = rows.filter((r, i) => i !== idx && r.ok);
  if (others.length < 3) return { ok: false, reason: 'fewer than 3 other nights to take ρ from' };
  const rho = { ab: median(others.map((r) => r.rho.hv)), ac: median(others.map((r) => r.rho.ho)), bc: median(others.map((r) => r.rho.vo)) };
  const v = rows[idx].vars,
    s = AS.tchSigmasPairwiseFromVars(v.hv, v.ho, v.vo, rho);
  if (!s || !s.ok) return { ok: false, reason: (s && s.reason) || 'correlated solve refused', rho };
  return { ok: true, rho, sigma: { h10: s.a, verity: s.b, o2: s.c } };
}
function judge(rows, pick) {
  let pass = 0,
    total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.ok) continue;
    const est = pick(r, i);
    for (const k of JUDGED) {
      total++;
      if (est && withinBand(est[k], r.trueSd[k])) pass++;
    }
  }
  return { pass, total, frac: total ? pass / total : null };
}
export function pool(rows) {
  const ok = rows.filter((r) => r.ok);
  const classic = judge(rows, (r) => r.hat);
  const corrRes = rows.map((r, i) => (r.ok ? correlatedLOO(rows, i) : null));
  const correlated = judge(rows, (r, i) => (corrRes[i] && corrRes[i].ok ? corrRes[i].sigma : null));
  const med = (f) => median(ok.map(f));
  const out = { nights: ok.length, classic, correlated: { ...correlated, refused: corrRes.filter((c) => c && !c.ok).length }, medians: {} };
  for (const k of KEYS)
    out.medians[k] = {
      trueSd: med((r) => r.trueSd[k]),
      bias: med((r) => r.bias[k]),
      classic: med((r) => r.hat[k]),
      correlated: median(corrRes.filter((c) => c && c.ok).map((c) => c.sigma[k]))
    };
  out.medians.rho = { hv: med((r) => r.rho.hv), ho: med((r) => r.rho.ho), vo: med((r) => r.rho.vo) };
  return out;
}
export function verdictObject(P, rows, meta) {
  meta = meta || {};
  const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
  let status,
    reason = null;
  if (P.nights < MIN_NIGHTS) {
    status = 'UNDERPOWERED';
    reason = `${P.nights} night(s) scored < the pre-stated minimum of ${MIN_NIGHTS}`;
  } else if (P.classic.frac >= PASS_FRAC) status = 'PASS';
  else {
    status = 'FAIL';
    reason = `classic hat: ${P.classic.pass}/${P.classic.total} optical night-corners within ±${BAND_ABS} bpm or ±${BAND_REL * 100} % of the reference-measured σ (< ${PASS_FRAC * 100} %); Verity σ̂ ${r3(P.medians.verity.classic)} vs true ${r3(P.medians.verity.trueSd)} bpm, ρ(V,O) ${r3(P.medians.rho.vo)}`;
  }
  const m = {};
  for (const k of KEYS) m[k] = { trueSd: r3(P.medians[k].trueSd), bias: r3(P.medians[k].bias), classic: r3(P.medians[k].classic), correlated: r3(P.medians[k].correlated) };
  return {
    schema: 'tepna.verdict/1',
    gate: 'tch-firmware-reference',
    scope: 'internal',
    status,
    population: { checked: P.nights, eligible: rows.length, excluded: rows.length - P.nights },
    criterion: { name: 'classic_hat_optical_corners_within_band_fraction', threshold: PASS_FRAC, unit: 'fraction', direction: 'gte' },
    result:
      status === 'UNDERPOWERED' && !P.nights
        ? null
        : {
            classicPassFraction: r3(P.classic.frac),
            correlated: { passFraction: r3(P.correlated.frac), refused: P.correlated.refused, status: P.correlated.frac >= PASS_FRAC ? 'PASS' : 'FAIL' },
            medians: m,
            rho: { hv: r3(P.medians.rho.hv), ho: r3(P.medians.rho.ho), vo: r3(P.medians.rho.vo) }
          },
    evidence: ['tools/tch-firmware-reference.mjs', ...(meta.roots || []).map((r) => `${r}/**/{*_ECG.txt,*_RR.txt,*_PPG.txt,*_SPO2.csv}`)],
    reason,
    producedBy: {
      tool: 'tools/tch-firmware-reference.mjs',
      commit: meta.commit || null,
      ...(meta.commit ? {} : { commitReason: meta.sample ? '--verdict-sample: synthetic rows, no code identity claimed' : 'not run inside a git checkout' })
    },
    at: (meta.at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z')
  };
}

/* ── synthetic nights (selftest + --verdict-sample): planted σ and ρ, known truth ─────────────── */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s & 0xffffff) / 0x1000000;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
}
export function syntheticMaps(seed, sig, rhoVO, n = 4000) {
  const r = rng(seed),
    REF = new Map(),
    H = new Map(),
    V = new Map(),
    O = new Map();
  for (let s = 0; s < n; s++) {
    const hr = 55 + 5 * Math.sin(s / 600) + gauss(r),
      z = gauss(r),
      zv = gauss(r),
      zo = gauss(r);
    REF.set(s, hr);
    H.set(s, hr + sig.h10 * gauss(r));
    // a shared optical term makes corr(eV, eO) = rhoVO with the planted marginal σs
    V.set(s, hr + sig.verity * (Math.sqrt(rhoVO) * z + Math.sqrt(1 - rhoVO) * zv));
    O.set(s, hr + sig.o2 * (Math.sqrt(rhoVO) * z + Math.sqrt(1 - rhoVO) * zo));
  }
  return { REF, H, V, O };
}
export function syntheticRows(k, rhoVO, sig = { h10: 0.8, verity: 0.7, o2: 1.7 }) {
  return Array.from({ length: k }, (_, i) => {
    const m = syntheticMaps(1000 + i, sig, rhoVO);
    return { night: 'synthetic-' + i, ...scoreSeries(m.REF, m.H, m.V, m.O) };
  });
}
export function verdictSample() {
  const rows = syntheticRows(12, 0.3);
  return verdictObject(pool(rows), rows, { roots: ['<synthetic>'], commit: null, at: '2026-09-26T20:00:00Z', sample: true });
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  const V = req(path.join(ROOT, 'verdict.js'));
  // 1 · the measurement recovers planted truth
  const m = syntheticMaps(7, { h10: 0.8, verity: 0.7, o2: 1.7 }, 0);
  const s0 = scoreSeries(m.REF, m.H, m.V, m.O);
  ok(s0.ok && Math.abs(s0.trueSd.verity - 0.7) < 0.05 && Math.abs(s0.trueSd.o2 - 1.7) < 0.08, 'true σ recovers the planted σ (ρ = 0)');
  // 2 · with independent errors the classic hat is right; with correlated optical errors it under-reads them
  ok(s0.hat.verity != null && Math.abs(s0.hat.verity - 0.7) < 0.1, 'classic hat is right when ρ = 0');
  const mc = syntheticMaps(8, { h10: 0.8, verity: 0.7, o2: 1.7 }, 0.4),
    sc = scoreSeries(mc.REF, mc.H, mc.V, mc.O);
  ok(sc.ok && Math.abs(sc.rho.vo - 0.4) < 0.06, 'ρ(V,O) measured against the reference recovers the planted 0.4');
  ok(sc.hat.verity == null || sc.hat.verity < sc.trueSd.verity - 0.1, 'ANTI-VACUITY · the classic hat under-reads a correlated optical corner');
  ok(sc.hat.h10 > sc.trueSd.h10 + 0.1, 'ANTI-VACUITY · …and charges the shared error to the H10');
  // 3 · leave-one-out: a planted outlier night's own ρ never reaches its own solve
  const rows = syntheticRows(8, 0.4);
  rows.push({ night: 'outlier', ...scoreSeries(...Object.values(syntheticMaps(99, { h10: 0.8, verity: 0.7, o2: 1.7 }, 0.9))) });
  const loo = correlatedLOO(rows, rows.length - 1);
  ok(loo.rho && Math.abs(loo.rho.bc - 0.4) < 0.08, 'leave-one-out ρ for the outlier comes from the OTHER nights (≈0.4, not its own 0.9)');
  // 4 · where σ is identifiable (ρ well below σ_small/σ_large = 0.7/1.7 ≈ 0.41), the reference ρ fixes the hat
  const P = pool(syntheticRows(12, 0.3));
  ok(P.correlated.frac >= PASS_FRAC && P.correlated.frac > P.classic.frac, 'correlated hat (ρ from the reference) passes where the classic hat fails, ρ = 0.3');
  // 4b · NEAR ρ ≈ σ_small/σ_large THE SMALL CORNER IS NOT IDENTIFIABLE: ∂vVO/∂σV = 2(σV − ρσO) ≈ 0, so the
  //      difference variances barely move with σV. The solve must mostly REFUSE there, never pass by luck.
  const Pe = pool(syntheticRows(12, 0.4));
  ok(Pe.correlated.refused >= 6 && Pe.correlated.frac < PASS_FRAC, 'at ρ ≈ σV/σO the correlated solve refuses most nights and does not PASS (' + Pe.correlated.refused + ' refused)');
  // 5 · band + verdict contract
  ok(withinBand(1.0, 1.25) && withinBand(2.0, 2.5) && !withinBand(0.41, 0.73), 'band: ±0.3 bpm or ±30 %; the measured Verity miss fails it');
  const vs = verdictSample();
  ok(V.validate(vs).ok, 'verdict sample validates: ' + V.validate(vs).errors.join(' | '));
  const few = syntheticRows(3, 0);
  ok(verdictObject(pool(few), few, { at: '2026-09-26T20:00:00Z' }).status === 'UNDERPOWERED', 'fewer than MIN_NIGHTS ⇒ UNDERPOWERED, never PASS');
  const bad = [{ night: 'x', ok: false, reason: 'no overlap' }];
  const vb = verdictObject(pool(bad), bad, { at: '2026-09-26T20:00:00Z' });
  ok(vb.population.checked === 0 && vb.population.excluded === 1 && V.validate(vb).ok, 'an all-refused run is UNDERPOWERED over checked 0, and says so');
  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'SELFTEST PASS (13/13)');
  return fails.length ? 1 : 0;
}

/* ── corpus side: the page's own worker functions in a headless realm ─────────────────────────── */
function loadRealm() {
  const DexBuild = req(path.join(ROOT, 'tools', 'build-core.js'));
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Math,
    JSON,
    Date,
    Map,
    Set,
    Uint8Array,
    Int16Array,
    Int32Array,
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
    Proxy,
    Symbol,
    Error,
    RegExp,
    BigInt
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.importScripts = () => {};
  ctx.postMessage = () => {};
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'analysis-stats.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js', 'sensor-trio-worker.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  return ctx;
}
function largest(dir, re) {
  const c = fs.readdirSync(dir).filter((f) => re.test(f));
  return c.length ? path.join(dir, c.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size)[0]) : null;
}
export function scoreNightDir(ctx, dir) {
  const E = ctx.ECGDSP,
    fn = (n) => vm.runInContext(n, ctx),
    night = path.basename(dir);
  const f = {
    ecg: largest(dir, /H10.*_ECG\.txt$/),
    rr: largest(dir, /H10.*_RR\.txt$/),
    ppg: largest(dir, /VeritySense.*_PPG\.txt$/),
    ring: largest(dir, /O2Ring.*_PPG\.txt$/),
    spo2: largest(dir, /_SPO2\.csv$/)
  };
  const missing = ['ecg', 'rr', 'ppg'].filter((k) => !f[k]).concat(f.ring || f.spo2 ? [] : ['ring']);
  if (missing.length) return { night, ok: false, reason: 'missing ' + missing.join(', ') };
  try {
    const ecgTxt = fs.readFileSync(f.ecg, 'utf8');
    const rec = E.parseECG(ecgTxt),
      dev = E.parseDeviceRR(fs.readFileSync(f.rr, 'utf8')),
      r = E.analyze(rec, null);
    const t0 = r.t0Ms || rec.t0Ms || 0,
      selfMs = [],
      selfNN = [];
    for (let i = 0; i < r.nn.length; i++) {
      const x = r.nn[i];
      if (Number.isFinite(x) && x >= 200 && x <= 3000 && Number.isFinite(r.tt[i])) {
        selfMs.push(t0 + r.tt[i] * 1000);
        selfNN.push(x);
      }
    }
    const fw = firmwareHostTimes(dev, 300),
      fwMs = [],
      fwRR = [];
    for (let a = 0; a < fw.timesMs.length; a += 600) {
      const b = Math.min(fw.timesMs.length, a + 600),
        w = Array.from(fw.timesMs.subarray(a, b));
      const near = selfMs.filter((t) => t >= w[0] - 6200 && t <= w[w.length - 1] + 6200);
      if (near.length < 50) continue;
      const L = coincidenceLag(near, w, 150, 6000);
      if (L.refused) continue;
      for (let i = a; i < b; i++) {
        fwMs.push(fw.timesMs[i] - L.lagMs);
        fwRR.push(dev[i].rr);
      }
    }
    const cp = consensusPairs(selfMs, selfNN, fwMs, fwRR);
    const REF = perSecondMedian(cp.pairs);
    const unwrap = (x) => (x && x.hr ? x.hr : x);
    const H = unwrap(fn('ecgHrMap')(ecgTxt)),
      V = unwrap(fn('ppgHrMapReal')(fs.readFileSync(f.ppg, 'utf8')));
    let O = null,
      o2Source = null;
    if (f.ring) {
      const t = fs.readFileSync(f.ring, 'utf8');
      O = fn('o2MarkerHrMap')(t);
      if (O) o2Source = 'ring·156-markers';
      else {
        O = unwrap(fn('ppgHrMapReal')(t));
        if (O) o2Source = 'ring·PPGDSP';
      }
    }
    if (!O && f.spo2) {
      O = fn('o2PulseMap')(fs.readFileSync(f.spo2, 'utf8'));
      if (O) o2Source = 'ring·SpO2-csv';
    }
    if (!H || !V || !O) return { night, ok: false, reason: 'a corner produced no HR map (' + (!H ? 'H10 ' : '') + (!V ? 'Verity ' : '') + (!O ? 'O2Ring' : '') + ')' };
    const s = scoreSeries(REF, H, V, O);
    return { night, o2Source, reference: { consecutivePairs: cp.consecutive, agreeing: cp.pairs.length, seconds: REF.size }, ...s };
  } catch (e) {
    return { night, ok: false, reason: String((e && e.message) || e).slice(0, 160) };
  }
}

async function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 1));
    return 0;
  }
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : null;
  };
  const dir = arg('--dir');
  if (!dir || !fs.existsSync(dir)) {
    console.error('usage: node tools/tch-firmware-reference.mjs --selftest | --verdict-sample | --dir <captures root> [--night YYYY-MM-DD]… [--ledger f.jsonl] [--json]');
    return 2;
  }
  const only = argv.flatMap((a, i) => (a === '--night' && argv[i + 1] ? [argv[i + 1]] : []));
  const ledger = arg('--ledger');
  const seen = new Map();
  if (ledger && fs.existsSync(ledger))
    for (const l of fs.readFileSync(ledger, 'utf8').split('\n'))
      if (l.trim()) {
        const r = JSON.parse(l);
        seen.set(r.night, r);
      }
  const nights = fs
    .readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && (!only.length || only.includes(n)))
    .sort();
  let ctx = null;
  for (const n of nights) {
    if (seen.has(n)) continue;
    ctx = ctx || loadRealm();
    const row = scoreNightDir(ctx, path.join(dir, n));
    seen.set(n, row);
    if (ledger) fs.appendFileSync(ledger, JSON.stringify(row) + '\n');
    console.error(`${n}  ${row.ok ? 'scored ' + row.n + ' s' : 'refused: ' + row.reason}`);
  }
  const rows = [...seen.values()].filter((r) => !only.length || only.includes(r.night)).sort((a, b) => (a.night < b.night ? -1 : 1));
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    /* not a checkout → commit null with commitReason */
  }
  const P = pool(rows);
  const verdict = verdictObject(P, rows, { roots: [dir], commit });
  if (argv.includes('--json')) console.log(JSON.stringify({ ...verdict, detail: { pooled: P, nights: rows } }, null, 1));
  else {
    const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
    console.log(`HR three-cornered hat vs the two-detector reference — ${P.nights} night(s) scored of ${rows.length}`);
    for (const k of KEYS) {
      const M = P.medians[k];
      console.log(
        `  ${k.padEnd(7)} true σ ${f(M.trueSd)} · classic hat ${f(M.classic)} · correlated (LOO ρ) ${f(M.correlated)} · bias ${f(M.bias)} bpm${k === 'h10' ? '   (reported, not judged)' : ''}`
      );
    }
    console.log(`  ρ of errors vs reference: HV ${f(P.medians.rho.hv)} · HO ${f(P.medians.rho.ho)} · VO ${f(P.medians.rho.vo)}`);
    console.log(
      `  classic ${P.classic.pass}/${P.classic.total} · correlated ${P.correlated.pass}/${P.correlated.total} (refused ${P.correlated.refused}) within ±${BAND_ABS} bpm or ±${BAND_REL * 100} %`
    );
    console.log('\nVERDICT (tepna.verdict/1): ' + JSON.stringify({ status: verdict.status, population: verdict.population, reason: verdict.reason }));
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).then((c) => process.exit(c));
