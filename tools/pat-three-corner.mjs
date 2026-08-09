#!/usr/bin/env node
/*
 * tools/pat-three-corner.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ALL THREE PAT PAIRS, ON ONE 5-MIN GRID — plus a CLOSURE test and a three-cornered hat.
 *
 * Every PAT run in this repo has scored ONE pair. A pair cannot say which sensor carries the
 * scatter: `Var(A−B)` is symmetric, so a 90 ms chest→ankle residual is equally consistent with a
 * noisy chest and a quiet ankle or the reverse. Three sites make it identifiable.
 *
 *   A = H10 chest ECG (R-peak)      B = O2Ring right index FINGER (foot)
 *   C = Verity left ANKLE (foot)     — placement per PAT-SENSOR-PLACEMENT-CORRECTION, wearer-confirmed
 *
 * TWO INDEPENDENT THINGS ARE COMPUTED, and they check each other:
 *
 * 1 · CLOSURE — ⚠️ MEASURES NOTHING. RETAINED ONLY AS A WARNING; DO NOT CITE ITS VALUE.
 *     This was written as "a free consistency test of the whole chain". It is not one. When the
 *     A→C search and the B→C search resolve to the SAME ankle beat — which on clean beats happens
 *     essentially always (2001/2001 on a synthetic 1 Hz train) — then
 *         (C − A) ≡ (B − A) + (C − B)
 *     identically, for ANY values whatsoever. The residual it prints (0.4 ms over 389 windows) is
 *     arithmetic, not agreement, and would be ~0 even if every timestamp were garbage.
 *     A REAL closure test must not share a beat between the two paths: derive the legs from disjoint
 *     beat sets, or compare across different beats. Not built. Until it is, treat this line as a
 *     placeholder that documents its own vacuity — a self-satisfying identity reported as evidence
 *     is exactly the failure class this repo keeps rediscovering.
 *
 * 2 · THREE-CORNERED HAT on the pairwise VARIANCES:
 *       Var(A−B) = σ²A + σ²B,  Var(A−C) = σ²A + σ²C,  Var(B−C) = σ²B + σ²C
 *     ⇒ σ²A = (V_AB + V_AC − V_BC)/2, and cyclically. The CLASSIC hat, ρ = 0 — deliberately NOT the
 *     correlated solve. `TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS` §5 shows that a ρ estimated as a
 *     residual correlation against one corner held as truth is ALGEBRAICALLY identical to the ρ at
 *     which that corner's σ collapses — so any ρ derived from these same three series is circular by
 *     construction. Here there is no truth corner and no estimated ρ. A NEGATIVE variance is reported
 *     as a refusal, never square-rooted: it means the model does not fit, which is information.
 *
 * WINDOWING + REJECTION are inherited unchanged from `pat-hrv-windows.mjs`: fixed 5-min grid, every
 * window scored, rejection on per-stream signal quality only (rate plausibility + the Malik artefact
 * fraction from PulseDex), applied before any pair is compared. A window enters only if ALL THREE
 * streams pass independently — which is stricter than any single pair, and the same rule for each.
 *
 *   node tools/pat-three-corner.mjs --dir <captures root> [--night 2026-08-03] [--win 5]
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
const DIR = arg('--dir', null);
const ONLY = arg('--night', null);
const WIN_MIN = +arg('--win', 5);
if (!DIR) {
  console.error('need --dir <captures root>');
  process.exit(1);
}

const RATE_LO = 30,
  RATE_HI = 120;
const MIN_BEATS = 100,
  MAX_ARTIFACT = 0.2;
/* Physiological search windows, per PATH LENGTH — not one window for all three.
   chest→finger and chest→ankle both include PEP; finger→ankle is pulse-to-pulse and is tens of ms.
   Reusing the ECG window on the pulse→pulse leg returns a null BY CONSTRUCTION (the sibling tool
   records exactly this trap), so each leg gets the band its anatomy implies. */
const BAND = { AB: [80, 700], AC: [80, 900], BC: [-200, 400] };

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
for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js', 'pulsedex-dsp.js', 'analysis-stats.js']) {
  try {
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  } catch (e) {
    console.error('load fail', f, e.message.slice(0, 110));
  }
}
const ECG = ctx.ECGDSP || ctx.ECGDex,
  PPG = ctx.PPGDSP || ctx.PpgDex,
  PULSE = ctx.PulseDex;
const artifactClean = PULSE && PULSE._bare && PULSE._bare.artifactClean ? PULSE._bare.artifactClean : null;
if (!ECG || !PPG) {
  console.error('DSP unavailable');
  process.exit(1);
}

const med = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const iqr = (a) => {
  if (a.length < 4) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
};
const varr = (a) => {
  if (a.length < 2) return NaN;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
};

function artifactFrac(times) {
  const rr = [];
  for (let i = 1; i < times.length; i++) rr.push(times[i] - times[i - 1]);
  if (rr.length < 10) return 1;
  if (artifactClean) {
    const c = artifactClean(rr);
    return 1 - (c && c.clean ? c.clean.length : 0) / rr.length;
  }
  let bad = 0;
  for (const v of rr) if (v < 300 || v > 2000) bad++;
  return bad / rr.length;
}
function spanOf(file) {
  const sz = fs.statSync(file).size,
    fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(Math.min(sz, 8192));
  fs.readSync(fd, head, 0, head.length, 0);
  const tn = Math.min(sz, 65536),
    tail = Buffer.alloc(tn);
  fs.readSync(fd, tail, 0, tn, sz - tn);
  fs.closeSync(fd);
  const col = (b, back) => {
    const L = b.toString('utf8').split('\n');
    const r = back ? [...L].reverse() : L;
    for (const l of r) {
      const p = l.split(';');
      if (p.length > 1 && /^\d{10,}$/.test((p[1] || '').trim())) return Number(BigInt(p[1].trim()) / 1000000n);
    }
    return null;
  };
  const a = col(head, false),
    z = col(tail, true);
  return a != null && z != null ? { a, z, span: z - a } : null;
}
const beatsECG = (f) => {
  const r = ECG.parseECG(fs.readFileSync(f, 'utf8'));
  if (!r || !r.int16 || !r.t0Ms) return null;
  const i = ECG.detectPeaks(r.int16, ECG.bandpass(r.int16, r.fs), r.fs);
  return i && i.length > 100 ? i.map((k) => r.t0Ms + (k / r.fs) * 1000) : null;
};
const beatsPPG = (f) => {
  const r = PPG.parsePPG(fs.readFileSync(f, 'utf8'));
  if (!r) return null;
  const a = PPG.analyze(r);
  return a && a.tt && a.tt.length > 100 ? a.tt.map((s) => r.t0Ms + s * 1000) : null;
};

/* pair X→Y inside an anatomy-specific band; returns the per-beat delays */
function lagsOf(X, Y, band) {
  const out = [];
  let j = 0;
  for (const x of X) {
    while (j < Y.length && Y[j] < x + band[0]) j++;
    if (j >= Y.length) break;
    const d = Y[j] - x;
    if (d >= band[0] && d <= band[1]) out.push(d);
  }
  return out;
}

console.log('THREE-CORNER PAT — A=H10 chest ECG · B=O2Ring finger · C=Verity ANKLE');
console.log(`  ${WIN_MIN}-min fixed grid · reject on per-stream quality only · all three must pass independently`);
console.log('  bands: A→B ' + JSON.stringify(BAND.AB) + '  A→C ' + JSON.stringify(BAND.AC) + '  B→C ' + JSON.stringify(BAND.BC) + ' ms\n');
console.log('  night        win   lag A→B  A→C  B→C |  closure  |  IQR AB   AC   BC');
console.log('  ' + '-'.repeat(80));

const nights = fs
  .readdirSync(DIR)
  .filter((d) => /^2026-/.test(d) && (!ONLY || d === ONLY) && fs.statSync(path.join(DIR, d)).isDirectory())
  .sort();
const V = { AB: [], AC: [], BC: [] },
  CLOSE = [],
  LAG = { AB: [], AC: [], BC: [] };
for (const n of nights) {
  const dir = path.join(DIR, n),
    files = fs.readdirSync(dir);
  const big = (re) =>
    files
      .filter((f) => re.test(f))
      .map((f) => {
        const p = path.join(dir, f);
        let s = null;
        try {
          s = spanOf(p);
        } catch {}
        return s ? { f: p, ...s } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.span - a.span)[0];
  const eF = big(/Polar_H10_.*_ECG\.txt$/i),
    oF = big(/o2ring.*_PPG\.txt$/i),
    vF = big(/veritysense.*_PPG\.txt$/i);
  if (!eF || !oF || !vF) {
    console.log(`  ${n}  ⊘ missing a corner (ECG ${!!eF} · ring ${!!oF} · ankle ${!!vF})`);
    continue;
  }
  let A = null,
    B = null,
    C = null;
  try {
    A = beatsECG(eF.f);
    B = beatsPPG(oF.f);
    C = beatsPPG(vF.f);
  } catch {}
  if (!A || !B || !C) {
    console.log(`  ${n}  ⊘ a detector failed (ECG ${!!A} · ring ${!!B} · ankle ${!!C})`);
    continue;
  }
  const wm = WIN_MIN * 60000;
  const t0 = Math.max(A[0], B[0], C[0]),
    tE = Math.min(A[A.length - 1], B[B.length - 1], C[C.length - 1]);
  if (!(tE > t0 + 2 * wm)) {
    console.log(`  ${n}  ⊘ three-way overlap under two windows`);
    continue;
  }
  const nightV = { AB: [], AC: [], BC: [] },
    nightL = { AB: [], AC: [], BC: [] },
    nightC = [];
  let kept = 0;
  for (let s = t0; s + wm <= tE; s += wm) {
    const aw = A.filter((t) => t >= s && t < s + wm),
      bw = B.filter((t) => t >= s && t < s + wm),
      cw = C.filter((t) => t >= s && t < s + wm);
    const okStream = (w) => w.length >= MIN_BEATS && w.length / WIN_MIN >= RATE_LO && w.length / WIN_MIN <= RATE_HI && artifactFrac(w) <= MAX_ARTIFACT;
    if (!okStream(aw) || !okStream(bw) || !okStream(cw)) continue;
    const lAB = lagsOf(aw, bw, BAND.AB),
      lAC = lagsOf(aw, cw, BAND.AC),
      lBC = lagsOf(bw, cw, BAND.BC);
    if (lAB.length < 30 || lAC.length < 30 || lBC.length < 30) continue;
    kept++;
    const mAB = med(lAB),
      mAC = med(lAC),
      mBC = med(lBC);
    nightL.AB.push(mAB);
    nightL.AC.push(mAC);
    nightL.BC.push(mBC);
    nightV.AB.push(iqr(lAB));
    nightV.AC.push(iqr(lAC));
    nightV.BC.push(iqr(lBC));
    nightC.push(mAC - (mAB + mBC));
  }
  if (!kept) {
    console.log(`  ${n}  ⊘ no window passed all three streams`);
    continue;
  }
  console.log(
    `  ${n}  ${String(kept).padStart(4)}   ${med(nightL.AB).toFixed(0).padStart(6)} ${med(nightL.AC).toFixed(0).padStart(4)} ${med(nightL.BC).toFixed(0).padStart(4)} | ` +
      `${med(nightC).toFixed(0).padStart(6)} ms | ${med(nightV.AB).toFixed(0).padStart(6)} ${med(nightV.AC).toFixed(0).padStart(4)} ${med(nightV.BC).toFixed(0).padStart(4)}`
  );
  for (const k of ['AB', 'AC', 'BC']) {
    V[k].push(...nightV[k]);
    LAG[k].push(...nightL[k]);
  }
  CLOSE.push(...nightC);
}

console.log('  ' + '-'.repeat(80));
if (!V.AB.length) {
  console.log('\n  no night produced a three-way window — that is the result.');
  process.exit(0);
}
console.log(`\n  CORPUS — ${V.AB.length} windows with all three sensors passing quality`);
console.log(`    median lag   A→B (chest→finger) ${med(LAG.AB).toFixed(0)} ms · A→C (chest→ankle) ${med(LAG.AC).toFixed(0)} ms · B→C (finger→ankle) ${med(LAG.BC).toFixed(0)} ms`);
console.log(`    median IQR   AB ${med(V.AB).toFixed(0)} · AC ${med(V.AC).toFixed(0)} · BC ${med(V.BC).toFixed(0)} ms`);
console.log(`\n  1 · CLOSURE   A→C − (A→B + B→C) = ${med(CLOSE).toFixed(1)} ms   (IQR ${iqr(CLOSE).toFixed(0)} ms, n=${CLOSE.length})`);
console.log(`      ⚠️ VACUOUS — both paths select the same ankle beat, so this identity holds for ANY data.`);
console.log(`      Verified 2026-08-09: 2001/2001 same-beat selection on a synthetic train. NOT evidence.`);

/* 2 · classic three-cornered hat on the pairwise variances (rho = 0, no truth corner) */
const vAB = varr(V.AB.map((x) => x)),
  vAC = varr(V.AC.map((x) => x)),
  vBC = varr(V.BC.map((x) => x));
/* Use the WITHIN-WINDOW scatter itself as the pairwise dispersion: square the median IQR to a
   variance-like quantity via the normal relation sigma = IQR/1.349, which is the robust estimator
   this repo already uses elsewhere. Stated explicitly because it is an assumption, not a fact. */
const s = (a) => med(a) / 1.349;
const SAB = s(V.AB) ** 2,
  SAC = s(V.AC) ** 2,
  SBC = s(V.BC) ** 2;
const a2 = (SAB + SAC - SBC) / 2,
  b2 = (SAB + SBC - SAC) / 2,
  c2 = (SAC + SBC - SAB) / 2;
console.log(`\n  2 · THREE-CORNERED HAT (classic, rho=0; sigma = IQR/1.349)`);
const rep = (name, v) => (v > 0 ? `${Math.sqrt(v).toFixed(1)} ms` : `REFUSED (negative variance ${v.toFixed(0)}) — the model does not fit`);
console.log(`      sigma A  H10 chest ECG   : ${rep('A', a2)}`);
console.log(`      sigma B  O2Ring finger   : ${rep('B', b2)}`);
console.log(`      sigma C  Verity ankle    : ${rep('C', c2)}`);
if (a2 <= 0 || b2 <= 0 || c2 <= 0)
  console.log(
    `      A negative variance is NOT square-rooted. It means the three pairwise dispersions are\n` +
      `      not consistent with three independent per-sensor noises — correlated error, or a leg\n` +
      `      measuring something other than transit. Reported, never hidden.`
  );
