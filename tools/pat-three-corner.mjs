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
 * 3 · THE HAT SAYS WHICH LEG MOVED A CORNER. `--verdict` prints one `tepna.verdict/1` carrying the
 *     `contributions` block of VERDICT-CONTRIBUTIONS-2026-10-04 §2 — the three legs' signed partials of
 *     the corner's closed form, their shares, and the dominant one — so the question the brief opens on
 *     ("which leg's variance drives the subtraction") is answered by the object instead of by a reader.
 *     The status is UNKNOWN by design: a per-site sigma has no pre-stated band, and one written now
 *     would be a number rather than a test.
 *
 *   node tools/pat-three-corner.mjs --dir <captures root> [--night 2026-08-03] [--win 5] [--ecg-axis linear|counter|piecewise]
 *   node tools/pat-three-corner.mjs --dir <captures root> --verdict [--corner auto|chest|finger|ankle]
 *   node tools/pat-three-corner.mjs --verdict-sample     # the object over a PLANTED leg triple — reads no corpus
 *   node tools/pat-three-corner.mjs --selftest
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ecgCounterTimeMs } from './pat-matchrate-strict.mjs';
import { notANight, populationVerdict, ruleLine, snapshotNights } from './corpus-scope-core.mjs';
import { printVerdict, undeclaredVerdict } from './verdict-undeclared.mjs';

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
/* --ecg-axis (default `linear`, the historical form, so no published number moves): `counter` times each
   R-peak on the H10's own sample counter — see `ecgCounterTimeMs` in pat-matchrate-strict.mjs for why a
   whole-file `fs` walks the ECG train by up to seconds per night — and `piecewise` on the DSP's
   host-disciplined `tMsAt`. The PPG legs are host-disciplined either way. */
const ECG_AXIS = arg('--ecg-axis', 'linear');
if (!['linear', 'counter', 'piecewise'].includes(ECG_AXIS)) {
  console.error('--ecg-axis must be linear|counter|piecewise');
  process.exit(2);
}
/* `--verdict` prints ONE object on stdout and every line of prose on stderr, so the object can be
   piped whole. `--verdict-sample` does the same over a PLANTED leg triple and reads no corpus at all,
   which is what the adoption gate runs: `tools/verdict-adoption.mjs` executes the command it finds in
   `emits` and parses its stdout, and a gate that needs a night folder cannot run in CI. */
const SELFTEST = argv.includes('--selftest');
const SAMPLE = argv.includes('--verdict-sample');
const VERDICT = SAMPLE || argv.includes('--verdict');
const CORNERS = ['chest', 'finger', 'ankle'];
/* Which corner the object attributes. The contract carries ONE `contributions` block per object, so the
   object names one corner; `auto` takes the REFUSED corner when there is one, because a refusal is the
   case the brief opens on, and chest otherwise. At most one corner can be negative — a2 + b2 = SAB and
   a pairwise variance is never negative — so `auto` is single-valued on real data. */
const CORNER = arg('--corner', 'auto');
if (!['auto', ...CORNERS].includes(CORNER)) {
  console.error('--corner must be auto|chest|finger|ankle');
  process.exit(2);
}
const say = VERDICT ? (...a) => console.error(...a) : (...a) => console.log(...a);
if (!DIR && !SAMPLE && !SELFTEST) {
  console.error('need --dir <captures root>   (or --verdict-sample / --selftest, neither of which reads a corpus)');
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
  if (!i || i.length <= 100) return null;
  return i.map((k) => (ECG_AXIS === 'counter' ? ecgCounterTimeMs(r, k) : ECG_AXIS === 'piecewise' ? r.tMsAt(k) : r.t0Ms + (k / r.fs) * 1000));
};
const beatsPPG = (f) => {
  const r = PPG.parsePPG(fs.readFileSync(f, 'utf8'));
  if (!r) return null;
  const a = PPG.analyze(r);
  return a && a.tt && a.tt.length > 100 ? a.tt.map((s) => r.t0Ms + s * 1000) : null;
};

/* WHICH THREE FILES ARE THE NIGHT. A folder can hold more than one recording per device (a
   00:26-07:09 night AND the 22:00-04:20 one after it), and the hat is only meaningful over ONE
   recording seen by all three corners. Picking each device's largest file independently composed a
   trio that never existed (ECG + ankle from the earlier night, ring from the later: overlap -14.9 h)
   and printed "no three-way window" as if that were a fact about the DATA. So the triple is chosen
   JOINTLY: the combination with the largest three-way overlap `min(z) - max(a)` wins, ties go to the
   larger summed span, then to the path order, so the pick is deterministic. If NO combination
   overlaps, the best (negative) one still comes back and the caller's overlap guard refuses it —
   now truthfully, because no choice of files would have produced a window. Pure over `{f, a, z, span}`. */
function pickTrio(ecg, ring, ankle) {
  let best = null;
  for (const eF of ecg)
    for (const oF of ring)
      for (const vF of ankle) {
        const overlap = Math.min(eF.z, oF.z, vF.z) - Math.max(eF.a, oF.a, vF.a);
        const total = eF.span + oF.span + vF.span;
        const key = eF.f + '\0' + oF.f + '\0' + vF.f;
        if (!best || overlap > best.overlap || (overlap === best.overlap && (total > best.total || (total === best.total && key < best.key)))) best = { eF, oF, vF, overlap, total, key };
      }
  if (best) return { eF: best.eF, oF: best.oF, vF: best.vF };
  /* a device with NO candidate: nothing can be composed, but the caller's "missing a corner" line must
     still say which corners DO exist, so hand back each device's largest file. */
  const largest = (c) => [...c].sort((a, b) => b.span - a.span)[0];
  return { eF: largest(ecg), oF: largest(ring), vF: largest(ankle) };
}

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

/* After the realm is loaded and the helpers exist, and before anything reads a directory: the
   selftest needs `AnalysisStats` and `med`, and must never need a corpus. */
if (SELFTEST) process.exit(selftest());

say('THREE-CORNER PAT — A=H10 chest ECG · B=O2Ring finger · C=Verity ANKLE · ecg-axis ' + ECG_AXIS);
say(`  ${WIN_MIN}-min fixed grid · reject on per-stream quality only · all three must pass independently`);
say('  bands: A→B ' + JSON.stringify(BAND.AB) + '  A→C ' + JSON.stringify(BAND.AC) + '  B→C ' + JSON.stringify(BAND.BC) + ' ms\n');
say('  night        win   lag A→B  A→C  B→C |  closure  |  IQR AB   AC   BC');
console.log('  ' + '-'.repeat(80));

/* ONE WALK, AND THE WALK IS THE POPULATION. `/^2026-/` is this tool's own NIGHT RULE and travels as
   the walk's `re`, so `snapshotNights` names every night-shaped name it refused; inside a `.filter()`
   the refusal left no trace at all. `--night` is a SELECTION over that offer and stays here. Under
   `--verdict-sample` no corpus is read, so the snapshot refuses and the population line says so. Row
   2026-10-25-a-hard-coded-year-rule-refuses-a-night-and-the-verdict-reads-eligible-one. */
const popBefore = SAMPLE
  ? {
      ok: false,
      root: DIR,
      reason: 'not read: --verdict-sample reads no corpus',
      n: 0,
      nights: [],
      digest: null,
      maxCtimeMs: null,
      at: null,
      rule: String(/^2026-/),
      ruleIsDefault: false,
      rejectedNightShaped: null,
      admittedNonNight: null
    }
  : snapshotNights(DIR, { re: /^2026-/ });
const nights = (popBefore.nights || []).filter((d) => (!ONLY || d === ONLY) && fs.statSync(path.join(DIR, d)).isDirectory());
const scoredNights = [];
const V = { AB: [], AC: [], BC: [] },
  CLOSE = [],
  LAG = { AB: [], AC: [], BC: [] };
/* `eligible` for the verdict's population: every window the fixed grid produced on a night that
   reached the windowing step, counted BEFORE any per-stream rejection, so `checked + excluded =
   eligible` holds by construction. A night that never got a grid — a missing corner, a failed
   detector, under two windows of three-way overlap — contributes to NEITHER side: there was no window
   to reject. The verdict's `reason` says so rather than letting the equality imply a wider population
   than was ever windowed. */
let gridWindows = 0;
if (SAMPLE) {
  /* A PLANTED leg triple, 49 windows, no corpus read. The medians are chosen so the CHEST corner is
     refused — med_BC² > med_AB² + med_AC² — because the refused corner is the case the brief opens on
     and the one whose block a reader most needs. The spread is symmetric about the median, so the
     median is exact and the emitted object is identical on every machine. */
  V.AB = plantedLeg(20);
  V.AC = plantedLeg(30);
  V.BC = plantedLeg(60);
  gridWindows = V.AB.length;
}
for (const n of nights) {
  const dir = path.join(DIR, n),
    files = fs.readdirSync(dir);
  const cands = (re) =>
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
      .filter(Boolean);
  const { eF, oF, vF } = pickTrio(cands(/Polar_H10_.*_ECG\.txt$/i), cands(/o2ring.*_PPG\.txt$/i), cands(/veritysense.*_PPG\.txt$/i));
  if (eF && oF && vF) say(`  ${n}  trio: ${path.basename(eF.f)} + ${path.basename(oF.f)} + ${path.basename(vF.f)}`);
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
    gridWindows++;
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
  scoredNights.push(n);
}

say('  ' + '-'.repeat(80));
/* THE POPULATION THIS RUN COVERED, printed before the hat it qualifies. The status labels MOVEMENT of
   the night population under the run, never coverage. */
const population = populationVerdict(popBefore, SAMPLE ? popBefore : snapshotNights(DIR, { re: /^2026-/ }), {
  tool: 'tools/pat-three-corner.mjs',
  evidence: ['tools/pat-three-corner.mjs']
});
const unscoredNights = notANight({ n: nights.length, nights }, scoredNights);
say(
  `  population: ${popBefore.ok ? popBefore.n + ' offered under ' + DIR : 'NOT ENUMERATED — ' + popBefore.reason} · ${nights.length} selected · ${scoredNights.length} scored · movement ${population.status}${ONLY ? ` · --night left ${popBefore.n - nights.length} offered night(s) unread` : ''}${population.reason ? ' — ' + population.reason : ''}`
);
const popRuleLine = ruleLine(population);
if (popRuleLine) say('  ' + popRuleLine);
say(`  selected but not scored: ${unscoredNights.length ? unscoredNights.join(', ') : 'none'}`);
/* THROUGH `say`, NOT `console.log`. Under `--verdict` and `--verdict-sample` this tool's contract is
   that STDOUT carries the hat object ALONE — `verdict-adoption.mjs` parses stdout as JSON and a
   second line on it reds the gate (measured at step 37/40: "Unexpected non-whitespace character
   after JSON"). `say` is stderr under either flag and stdout on a plain run, which is where a human
   reader and a POPULATION consumer both want it. */
say('POPULATION ' + JSON.stringify(population));
if (!V.AB.length) {
  say('\n  no night produced a three-way window — that is the result.');
  /* Under --verdict that is still a verdict: nothing was checked, so the object says NOT_RUN rather
     than letting an empty stdout read as a tool that was never asked. */
  if (VERDICT) emitHatVerdict(null);
  process.exit(0);
}
if (SAMPLE) {
  say(`\n  PLANTED SAMPLE — ${V.AB.length} synthetic windows per leg. NO corpus was read, and no number below describes any night.`);
  say(`    planted median IQR   AB ${med(V.AB).toFixed(0)} · AC ${med(V.AC).toFixed(0)} · BC ${med(V.BC).toFixed(0)} ms`);
} else {
  say(`\n  CORPUS — ${V.AB.length} windows with all three sensors passing quality`);
  say(`    median lag   A→B (chest→finger) ${med(LAG.AB).toFixed(0)} ms · A→C (chest→ankle) ${med(LAG.AC).toFixed(0)} ms · B→C (finger→ankle) ${med(LAG.BC).toFixed(0)} ms`);
  say(`    median IQR   AB ${med(V.AB).toFixed(0)} · AC ${med(V.AC).toFixed(0)} · BC ${med(V.BC).toFixed(0)} ms`);
  say(`\n  1 · CLOSURE   A→C − (A→B + B→C) = ${med(CLOSE).toFixed(1)} ms   (IQR ${iqr(CLOSE).toFixed(0)} ms, n=${CLOSE.length})`);
  say(`      ⚠️ VACUOUS — both paths select the same ankle beat, so this identity holds for ANY data.`);
  say(`      Verified 2026-08-09: 2001/2001 same-beat selection on a synthetic train. NOT evidence.`);
}

/* 2 · classic three-cornered hat on the pairwise variances (rho = 0, no truth corner) */
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
say(`\n  2 · THREE-CORNERED HAT (classic, rho=0; sigma = IQR/1.349)`);
const rep = (name, v) => (v > 0 ? `${Math.sqrt(v).toFixed(1)} ms` : `REFUSED (negative variance ${v.toFixed(0)}) — the model does not fit`);
say(`      sigma A  H10 chest ECG   : ${rep('A', a2)}`);
say(`      sigma B  O2Ring finger   : ${rep('B', b2)}`);
say(`      sigma C  Verity ankle    : ${rep('C', c2)}`);
if (a2 <= 0 || b2 <= 0 || c2 <= 0)
  say(
    `      A negative variance is NOT square-rooted. It means the three pairwise dispersions are\n` +
      `      not consistent with three independent per-sensor noises — correlated error, or a leg\n` +
      `      measuring something other than transit. Reported, never hidden.`
  );

/* ── 3 · THE VERDICT OBJECT — tepna.verdict/1 over the CLASSIC hat (VERDICT-CONTRIBUTIONS §2 row 1) ──
   UNKNOWN BY DESIGN, through the shared band-less builder (`tools/verdict-undeclared.mjs`): a per-site
   sigma has no pre-stated band, and a band written now would be a number rather than a test
   (VERDICT-CONTRACT §1). What this object adds over the printed lines is the `contributions` block —
   each leg's signed partial of the corner's closed form, its share of the total absolute movement, and
   which leg dominates.

   THE VARIANCES ATTRIBUTED ARE THE ONES THIS TOOL PRINTS: (median within-window IQR / 1.349)², not a
   plain across-window variance. That is why the kernel is reached through `patHatContributionsFromVars`
   and never through `patHatContributions`, which would re-estimate the legs from the windows and
   attribute a dispersion the printed hat never solved.

   `h` is `null` when no window survived: nothing was checked, so the builder returns NOT_RUN with a
   null result and no block. Pure apart from the print. */
function buildHatVerdict(h, pop, meta) {
  const S = ctx.AnalysisStats;
  if (!S || typeof S.patHatContributionsFromVars !== 'function') {
    console.error('AnalysisStats.patHatContributionsFromVars unavailable — analysis-stats.js did not load into the realm');
    process.exit(2);
  }
  const m = meta || {};
  const r1 = (x) => (Number.isFinite(x) ? +x.toFixed(1) : null);
  const cv = h ? { chest: h.a2, finger: h.b2, ankle: h.c2 } : null;
  /* `rep()` above prints a refusal for any corner that is not strictly positive; the verdict uses the
     same test, so the object and the lines above it can never disagree about which corner was refused. */
  const refused = cv ? CORNERS.filter((c) => !(cv[c] > 0)) : [];
  const corner = CORNER !== 'auto' ? CORNER : refused[0] || 'chest';
  const blocks = h ? S.patHatContributionsFromVars(h.SAB, h.SAC, h.SBC) : null;
  const notes = [];
  if (m.sample)
    notes.push(
      'PLANTED, NOT MEASURED — `--verdict-sample` reads no corpus, and the three legs are synthetic per-window IQRs chosen to refuse the chest corner, so this object asserts the SHAPE and states nothing about any night'
    );
  if (cv) {
    notes.push(`the block attributes sigma2.${corner} = ${r1(cv[corner])} ms², chosen by ${CORNER !== 'auto' ? 'the --corner flag' : refused.length ? 'the refusal' : 'the chest default'}`);
    if (refused.length)
      notes.push(
        `the hat REFUSES ${refused.join(', ')} — a negative variance is reported, never square-rooted, and a negative corner cannot be separated from a precision limit without an interval, which this tool does not compute (AnalysisStats.patHatBootstrapCI does)`
      );
    notes.push('`eligible` counts the windows the fixed grid produced on nights that reached the windowing step; a night that never got a grid is in neither term');
  }
  return undeclaredVerdict({
    tool: 'tools/pat-three-corner.mjs',
    gate: 'pat-three-corner-hat',
    stat: h
      ? {
          label: `classic three-cornered hat (rho = 0), sigma² per site, attributing ${corner}`,
          corner,
          ecgAxis: ECG_AXIS,
          windowMin: WIN_MIN,
          nights: m.nights == null ? null : m.nights,
          sigma2Ms2: { chest: r1(h.a2), finger: r1(h.b2), ankle: r1(h.c2) },
          sigmaMs: { chest: h.a2 > 0 ? r1(Math.sqrt(h.a2)) : null, finger: h.b2 > 0 ? r1(Math.sqrt(h.b2)) : null, ankle: h.c2 > 0 ? r1(Math.sqrt(h.c2)) : null },
          refusedCorners: refused,
          legVarMs2: { 'leg.chest-finger': r1(h.SAB), 'leg.chest-ankle': r1(h.SAC), 'leg.finger-ankle': r1(h.SBC) }
        }
      : null,
    contributions: blocks ? blocks[corner] : null,
    population: pop,
    /* No night folder, device serial or capture path reaches the object — a count and a glob shape say
       what a reader would open without naming a recording. */
    evidence: m.sample ? ['<planted leg triple: 49 windows per leg, median IQR 20 / 30 / 60 ms>'] : ['<captures root>/2026-*/{Polar_H10_*_ECG.txt,o2ring*_PPG.txt,veritysense*_PPG.txt}'],
    note: notes.join('; '),
    ...(m.sample ? { commit: null, commitReason: '--verdict-sample: planted leg triple, no code identity claimed', at: '2026-10-12T00:00:00Z' } : {})
  });
}

function emitHatVerdict(h) {
  printVerdict(buildHatVerdict(h, { checked: V.AB.length, eligible: gridWindows }, { sample: SAMPLE, nights: SAMPLE ? null : nights.length }));
}

/* 49 synthetic per-window IQRs with an EXACT median: the spread is symmetric about `m`, so the planted
   leg variance — and therefore every delta and share in the emitted block — is identical on every
   machine and in every CI run. */
function plantedLeg(m) {
  const n = 49;
  return Array.from({ length: n }, (_, i) => m + (i - (n - 1) / 2) * 0.5);
}

function selftest() {
  let fail = 0;
  let ran = 0;
  /* The total is COUNTED, not typed — RESIDUE 2026-10-11-ten-tools-hardcode-a-selftest-count. */
  const ok = (n, c, d) => {
    ran++;
    console.log((c ? '  ok   ' : '  FAIL ') + n + (!c && d != null ? '  — ' + d : ''));
    if (!c) fail++;
  };
  const Vj = createRequire(import.meta.url)(path.join(ROOT, 'verdict.js'));
  const legVar = (a) => (med(a) / 1.349) ** 2;
  const SAB = legVar(plantedLeg(20)),
    SAC = legVar(plantedLeg(30)),
    SBC = legVar(plantedLeg(60));
  const h = { SAB, SAC, SBC, a2: (SAB + SAC - SBC) / 2, b2: (SAB + SBC - SAC) / 2, c2: (SAC + SBC - SAB) / 2 };
  const v = buildHatVerdict(h, { checked: 49, eligible: 49 }, { sample: true, nights: null });
  const res = Vj.validate(v);
  ok('the planted sample is a valid tepna.verdict/1', res.ok === true, (res.errors || []).join(' | '));
  ok('…and the shipped validator EXAMINED the contributions block', (res.checked || []).indexOf('contributions') >= 0, JSON.stringify(res.checked));
  ok('…status UNKNOWN, scope internal — a per-site sigma has no pre-stated band', v.status === 'UNKNOWN' && v.scope === 'internal', v.status + ' / ' + v.scope);
  ok('…the plant refuses the chest corner, and the object attributes exactly that corner', h.a2 < 0 && v.contributions.of === 'sigma2.chest', JSON.stringify({ a2: h.a2, of: v.contributions.of }));
  ok('…the reason says the legs were planted, so the sample can never read as a night', /PLANTED, NOT MEASURED/.test(v.reason), v.reason.slice(0, 80));
  ok('…no night folder, serial or capture path rides in the object', !/uploads|srv|2026-\d\d-\d\d\//.test(JSON.stringify(v)), JSON.stringify(v.evidence));
  const inp = v.contributions.inputs;
  ok('…the three legs are the brief’s own keys, in order', inp.map((it) => it.key).join() === 'leg.chest-finger,leg.chest-ankle,leg.finger-ankle', JSON.stringify(inp.map((it) => it.key)));
  const sum = inp.reduce((a, it) => a + it.delta, 0);
  ok('…the deltas SUM to the corner the hat solved, so the block decomposes the figure', Math.abs(sum - h.a2) < 1e-9, sum + ' vs ' + h.a2);
  ok(
    '…the shares sum to 1 and name the dominant leg',
    Math.abs(inp.reduce((a, it) => a + it.share, 0) - 1) < 1e-12 && v.contributions.dominant === 'leg.finger-ankle',
    JSON.stringify({ dominant: v.contributions.dominant })
  );
  ok('…population is an equality over windows, not a floor', v.population.checked + v.population.excluded === v.population.eligible && v.population.checked === 49, JSON.stringify(v.population));
  /* `--corner` overrides the refusal, and the override is the only thing that moves. */
  const other = buildHatVerdict(h, { checked: 49, eligible: 60 }, { sample: true, nights: null });
  ok('a second build over the same plant is byte-identical apart from the population', JSON.stringify({ ...other, population: v.population }) === JSON.stringify(v), 'the object is not deterministic');
  /* Nothing checked → NOT_RUN, null result, and no block to attribute. */
  const nr = buildHatVerdict(null, { checked: 0, eligible: 12 }, { sample: true, nights: null });
  ok(
    'no surviving window → NOT_RUN with a null result and no block',
    nr.status === 'NOT_RUN' && nr.result === null && nr.contributions === undefined && Vj.validate(nr).ok === true,
    JSON.stringify({ status: nr.status, errors: Vj.validate(nr).errors })
  );
  /* The kernel this tool calls must be the FromVars one: handing it the windows instead of the
     variances attributes a different quantity, and this assertion is what would catch the swap. */
  const S = ctx.AnalysisStats;
  const byWindow = S.patHatContributions(plantedLeg(20), plantedLeg(30), plantedLeg(60));
  ok(
    'the windows route and the variances route are DIFFERENT quantities — the hat attributes the one it printed',
    Math.abs(byWindow.chest.inputs[0].delta - inp[0].delta) > 1,
    JSON.stringify({ byWindow: byWindow.chest.inputs[0].delta, printed: inp[0].delta })
  );
  /* ── WHICH THREE FILES ARE THE NIGHT (residue 2026-10-05-pat-three-corner-picks-the-biggest-file…) ──
     The folder is the MEASURED 2026-10-04 shape: an early night (00:28-07:05) and a late one
     (22:00-04:20), where the early one is larger for the ECG and the ankle and the late one for the
     ring. Largest-per-device composed ECG+ankle from the early night and the ring from the late one. */
  const H = 3600e3,
    T0 = Date.UTC(2026, 9, 4, 0, 0, 0);
  const sp = (name, fromH, toH) => ({ f: name, a: T0 + fromH * H, z: T0 + toH * H, span: (toH - fromH) * H });
  const eEarly = sp('ecg-early', 0.47, 7.08),
    eLate = sp('ecg-late', 22, 28.33),
    oEarly = sp('ring-early', 0.53, 6.7),
    oLate = sp('ring-late', 22, 28.25),
    vEarly = sp('ank-early', 0.53, 7.07),
    vLate = sp('ank-late', 22.03, 28.33);
  /* THROUGH THE CLI first, on files the tool really reads: the stubs carry only the two timestamp rows
     `spanOf` needs, so the detectors refuse them — the line under test is the SELECTION, printed
     before any detector runs. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pat3-sel-'));
  try {
    const night = path.join(root, '2026-10-04');
    fs.mkdirSync(night);
    const stub = (name, s) => fs.writeFileSync(path.join(night, name), `Phone timestamp;sensor timestamp [ns];v\nx;${BigInt(s.a) * 1000000n};0\nx;${BigInt(s.z) * 1000000n};0\n`);
    stub('Polar_H10_x_20261004002801_ECG.txt', eEarly);
    stub('Polar_H10_x_20261004220023_ECG.txt', eLate);
    stub('O2Ring_x_20261004003220_PPG.txt', oEarly);
    stub('O2Ring_x_20261004220023_PPG.txt', oLate);
    stub('Polar_VeritySense_x_20261004003220_PPG.txt', vEarly);
    stub('Polar_VeritySense_x_20261004220206_PPG.txt', vLate);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--dir', root], { encoding: 'utf8', timeout: 60000 });
    const line = String(r.stdout || '')
      .split('\n')
      .find((l) => /trio:/.test(l));
    ok(
      'the CLI selects ONE recording’s files for the night and names them',
      !!line && /20261004220023_ECG.*20261004220023_PPG.*20261004220206_PPG/.test(line) && !/00(28|32)/.test(line),
      line || 'no `trio:` line printed — the selection is invisible: ' + String(r.stdout || r.stderr).slice(-200)
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const pk = pickTrio([eEarly, eLate], [oEarly, oLate], [vEarly, vLate]);
  ok(
    'a folder holding two recordings yields ONE recording’s trio, not the largest file per device',
    [pk.eF, pk.oF, pk.vF].map((x) => x.f).join() === 'ecg-late,ring-late,ank-late',
    [pk.eF, pk.oF, pk.vF].map((x) => x.f).join()
  );
  const lone = pickTrio([eEarly], [oEarly], [vEarly]);
  ok('a single recording is unchanged', [lone.eF, lone.oF, lone.vF].map((x) => x.f).join() === 'ecg-early,ring-early,ank-early', JSON.stringify(lone));
  const apart = pickTrio([eEarly], [oLate], [vEarly]);
  ok('with NO overlapping combination the pick is still returned, for the overlap guard to refuse', !!(apart.eF && apart.oF && apart.vF), JSON.stringify(apart));
  const tie = pickTrio([sp('b', 0, 2), sp('a', 0, 2)], [sp('o', 0, 2)], [sp('v', 0, 2)]);
  ok('equal overlap AND span → the lexicographically first path, so the pick is deterministic', tie.eF.f === 'a', tie.eF.f);
  const miss = pickTrio([eEarly], [], [vEarly]);
  ok('a missing corner is reported as missing, and the others still named', !!miss.eF && !miss.oF && !!miss.vF, JSON.stringify(miss));
  console.log(fail ? fail + ' failed of ' + ran : 'all ' + ran + ' selftests passed');
  return fail ? 1 : 0;
}

if (VERDICT) emitHatVerdict({ SAB, SAC, SBC, a2, b2, c2 });
