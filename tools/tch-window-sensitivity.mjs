#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * tch-window-sensitivity.mjs — how much of the night did you keep, and what did
 * that do to σ?
 *
 * WHY. `tools/tch-fused-corpus.mjs` re-fit the papers' fused-weight hat on a
 * committed `ms;hr;c` corpus and did NOT reproduce the published Verity/H10 σ
 * (1.42 / 1.28 → 3.51 / 1.78). This tool decomposes that gap, and the answer is
 * mostly not about the Verity corner at all:
 *
 *   **σ is a monotonic function of WINDOW LENGTH, for every corner.** Same nights,
 *   same estimator, same code — only how many simultaneous seconds are handed to
 *   the hat:
 *
 *       win_s     σ_O2   σ_H10  σ_Ver
 *        3600     2.34   1.41   2.36
 *       11214     2.54   1.57   2.78     ← the papers' ≈291,561 s / 26 nights
 *        full     2.99   1.78   3.51
 *
 *   Verity +49 %, O2Ring +28 %, H10 +26 % from a 1-hour window to a whole night.
 *   **Neither paper states window length as a parameter**, so two honest analysts
 *   with the same devices and the same nights can publish σ that differ by half
 *   again — and neither is wrong.
 *
 * This is the same discipline `CLAUDE.md` §7 already imposes on `hostAxis.ppm`
 * ("never quote ppm without the span beside it"), arriving at the σ layer: **a
 * reference-free σ is not a number, it is a number PER WINDOW LENGTH.**
 *
 * The second axis is night selection: nights where the Verity corner tracks the
 * chest ECG (r ≥ 0.70) give σ_Ver 2.72 against 3.91 for decorrelated nights — so a
 * quality gate that drops decorrelated nights lowers the published σ by selection,
 * not by measurement. (The shipped worker gate — σ>12 AND decorrelated from BOTH
 * peers — excludes 0/17 here, so it is not what did it.)
 *
 * ⚠ WHAT THIS DOES **NOT** SETTLE. The residual gap to the published 1.42 cannot be
 * attributed, because the papers' corpus (2026-06-10 … 07-05) is **not
 * re-derivable on this machine** — its box raw is gone, and the `Ecg nightly` tree
 * is phone-captured (a different timing-provenance tier; see
 * SENSOR-TRIO-NIGHTS-PAPER-BRIEF). Corpus and method are therefore confounded, and
 * this tool deliberately reports the decomposition it CAN measure rather than
 * naming a cause it cannot.
 *
 * USAGE
 *   node tools/trio-batch.mjs --src <captures> --out <dir>     # build ms;hr;c corpus
 *   node tools/tch-window-sensitivity.mjs <dir>
 * ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AS = createRequire(import.meta.url)(join(ROOT, 'analysis-stats.js'));

const HR_MIN = 30,
  HR_MAX = 220;
const secFloor = (t) => Math.floor(t / 1000);
const medMap = (pairs) => {
  const by = new Map();
  for (const [s, v] of pairs) {
    let a = by.get(s);
    if (!a) by.set(s, (a = []));
    a.push(v);
  }
  const o = new Map();
  for (const [s, a] of by) {
    a.sort((p, q) => p - q);
    o.set(s, a[a.length >> 1]);
  }
  return o;
};
function rollingClean(m) {
  const secs = [...m.keys()].sort((a, b) => a - b),
    vals = secs.map((s) => m.get(s)),
    o = new Map();
  for (let j = 0; j < secs.length; j++) {
    const w = vals.slice(Math.max(0, j - 2), Math.min(vals.length, j + 3)).sort((a, b) => a - b);
    if (Math.abs(vals[j] - w[w.length >> 1]) <= 20) o.set(secs[j], vals[j]);
  }
  return o;
}
function beats(block, t0) {
  if (!block || !Array.isArray(block.tSec)) return null;
  const conf = Array.isArray(block.conf) && block.conf.length === block.ms.length ? block.conf : null;
  const pairs = [],
    cBy = new Map();
  for (let i = 0; i < block.ms.length; i++) {
    const rr = block.ms[i];
    if (!(rr > 250 && rr < 2200)) continue;
    const hr = 60000 / rr;
    if (!(hr >= HR_MIN && hr <= HR_MAX)) continue;
    const s = secFloor(t0 + block.tSec[i] * 1000);
    pairs.push([s, hr]);
    const c = conf && Number.isFinite(conf[i]) ? conf[i] : 1;
    cBy.set(s, Math.min(cBy.has(s) ? cBy.get(s) : 1, c));
  }
  return pairs.length < 30 ? null : { hr: rollingClean(medMap(pairs)), conf: cBy };
}
function grid(block, t0) {
  if (!block || !Array.isArray(block.values)) return null;
  const base = secFloor(t0),
    pairs = [];
  for (let i = 0; i < block.values.length; i++) {
    const v = block.values[i];
    if (v == null || !Number.isFinite(v) || v < HR_MIN || v > HR_MAX) continue;
    pairs.push([base + i, v]);
  }
  return pairs.length < 30 ? null : { hr: medMap(pairs), conf: new Map() };
}

const DIR = process.argv[2] || '/tmp/trio-box';
const nights = readdirSync(DIR)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && statSync(join(DIR, d)).isDirectory())
  .sort();

const rows = [];
for (const n of nights) {
  const rd = (x) => JSON.parse(readFileSync(join(DIR, n, `${x}_${n}.node-export.json`), 'utf8'));
  let E, V, O;
  try {
    E = rd('ECGDex');
    V = rd('PpgDex');
    O = rd('OxyDex');
  } catch {
    continue;
  }
  const h = beats(E.timeseries?.rr, E.recording.startEpochMs),
    v = beats(V.timeseries?.ppi, V.recording.startEpochMs),
    o = grid(O.timeseries?.hr, O.recording.startEpochMs);
  if (!h || !v || !o) continue;
  const ks = [...h.hr.keys()].filter((s) => v.hr.has(s) && o.hr.has(s)).sort((a, b) => a - b);
  if (ks.length < 1000) continue;
  rows.push({ n, ks, h, v, o });
}

function solve(ks, r) {
  const hh = [],
    vv = [],
    oo = [],
    cH = [],
    cV = [],
    cO = [];
  for (const s of ks) {
    hh.push(r.h.hr.get(s));
    vv.push(r.v.hr.get(s));
    oo.push(r.o.hr.get(s));
    cH.push(r.h.conf.get(s) ?? 1);
    cV.push(r.v.conf.get(s) ?? 1);
    cO.push(1);
  }
  const s = AS.tchSigmasFused(hh, vv, oo, cH, cV, cO);
  return { ...s, rHV: AS.pearson(hh, vv), rVO: AS.pearson(vv, oo), hh, vv, oo, cH, cV, cO };
}
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.max(0, Math.min(a.length - 1, Math.floor(p * (a.length - 1))))] : null);
const med = (a) => q(a, 0.5);
const f = (x) => (x == null ? ' — ' : x.toFixed(2));

// ── baseline: full window, every night ───────────────────────────────────
const base = rows.map((r) => ({ n: r.n, len: r.ks.length, s: solve(r.ks, r) }));
console.log(`\ncorpus: ${rows.length} nights · total simultaneous s = ${base.reduce((a, b) => a + b.len, 0).toLocaleString()}`);
console.log(`per-night window: median ${med(base.map((b) => b.len)).toLocaleString()} s  (paper: 291,561 s / 26 nights ≈ 11,214 s)\n`);
console.log('A · FULL WINDOW, all nights (the shipped figure)');
for (const k of ['o2', 'h10', 'verity'])
  console.log(
    `    ${k.padEnd(7)} median ${f(med(base.map((b) => b.s[k]).filter((x) => x > 0)))}  [${f(
      q(
        base.map((b) => b.s[k]).filter((x) => x > 0),
        0.25
      )
    )}–${f(
      q(
        base.map((b) => b.s[k]).filter((x) => x > 0),
        0.75
      )
    )}]`
  );

// ── B: does Verity σ track window LENGTH? ───────────────────────────────
const lens = base.map((b) => b.len),
  vsig = base.map((b) => b.s.verity);
const ok = base.filter((b) => b.s.verity > 0);
console.log(
  `\nB · Verity σ vs window length: r = ${AS.pearson(
    ok.map((b) => b.len),
    ok.map((b) => b.s.verity)
  ).toFixed(3)}  (n=${ok.length})`
);

// ── C: truncate every night to the paper's mean window (best contiguous) ─
const TARGET = 11214;
const trunc = rows
  .map((r) => {
    if (r.ks.length <= TARGET) return { n: r.n, len: r.ks.length, s: solve(r.ks, r) };
    // best contiguous TARGET seconds = the stretch with the highest Verity confidence
    let bestI = 0,
      bestC = -1;
    for (let i = 0; i + TARGET <= r.ks.length; i += 300) {
      let c = 0;
      for (let j = i; j < i + TARGET; j += 10) c += r.v.conf.get(r.ks[j]) ?? 1;
      if (c > bestC) {
        bestC = c;
        bestI = i;
      }
    }
    const sub = r.ks.slice(bestI, bestI + TARGET);
    return { n: r.n, len: sub.length, s: solve(sub, r) };
  })
  .filter(Boolean);
console.log(`\nC · TRUNCATED to ${TARGET} s (best-confidence contiguous stretch)`);
for (const k of ['o2', 'h10', 'verity']) {
  const a = trunc.map((b) => b.s[k]).filter((x) => x > 0);
  console.log(`    ${k.padEnd(7)} median ${f(med(a))}  [${f(q(a, 0.25))}–${f(q(a, 0.75))}]   (was ${f(med(base.map((b) => b.s[k]).filter((x) => x > 0)))})`);
}

// ── D: the worker's Verity quality gate (σ>12 AND decorrelated from both) ─
const gated = base.filter((b) => !(b.s.verity > 12 && b.s.rHV < 0.3 && b.s.rVO < 0.3));
console.log(`\nD · worker Verity quality gate (σ>12 AND decorrelated): kept ${gated.length}/${base.length}`);
for (const k of ['o2', 'h10', 'verity']) {
  const a = gated.map((b) => b.s[k]).filter((x) => x > 0);
  console.log(`    ${k.padEnd(7)} median ${f(med(a))}`);
}

// ── E: pooled-seconds hat (all nights concatenated) ──────────────────────
const P = { hh: [], vv: [], oo: [], cH: [], cV: [], cO: [] };
for (const r of rows) {
  const s = solve(r.ks, r);
  P.hh.push(...s.hh);
  P.vv.push(...s.vv);
  P.oo.push(...s.oo);
  P.cH.push(...s.cH);
  P.cV.push(...s.cV);
  P.cO.push(...s.cO);
}
const pooled = AS.tchSigmasFused(P.hh, P.vv, P.oo, P.cH, P.cV, P.cO);
console.log(`\nE · POOLED-seconds hat (${P.hh.length.toLocaleString()} s in one solve)`);
console.log(`    o2 ${f(pooled.o2)}   h10 ${f(pooled.h10)}   verity ${f(pooled.verity)}`);

// ── F: per-night detail, sorted by Verity σ ─────────────────────────────
console.log('\nF · per-night (sorted by Verity σ)');
console.log('    night        len_s   r(H,V)  σ_H10  σ_Ver   σ_O2   meanC_V');
for (const b of base.slice().sort((x, y) => (y.s.verity || 0) - (x.s.verity || 0))) {
  const r = rows.find((z) => z.n === b.n);
  const mc = b.s.cV.reduce((a, c) => a + c, 0) / b.s.cV.length;
  console.log(`    ${b.n} ${String(b.len).padStart(7)}   ${b.s.rHV.toFixed(2)}   ${f(b.s.h10).padStart(5)}  ${f(b.s.verity).padStart(5)}  ${f(b.s.o2).padStart(5)}   ${mc.toFixed(3)}`);
}

// ── G: window-length SWEEP — is the σ triple a function of how much night you keep? ──
console.log('\nG · window-length sweep (best-confidence contiguous stretch, same nights)');
console.log('    win_s     n   σ_O2   σ_H10  σ_Ver');
for (const W of [3600, 5400, 7200, 9000, 11214, 14400, 18000, 999999]) {
  const out = rows
    .map((r) => {
      if (r.ks.length <= W) return r.ks.length >= 1000 ? { s: solve(r.ks, r) } : null;
      let bi = 0,
        bc = -1;
      for (let i = 0; i + W <= r.ks.length; i += 600) {
        let c = 0;
        for (let j = i; j < i + W; j += 20) c += r.v.conf.get(r.ks[j]) ?? 1;
        if (c > bc) {
          bc = c;
          bi = i;
        }
      }
      return { s: solve(r.ks.slice(bi, bi + W), r) };
    })
    .filter(Boolean);
  const g = (k) => {
    const a = out.map((b) => b.s[k]).filter((x) => x > 0);
    return f(med(a));
  };
  console.log(`    ${String(W === 999999 ? 'full' : W).padStart(6)}  ${String(out.length).padStart(3)}   ${g('o2').padStart(5)}  ${g('h10').padStart(5)}  ${g('verity').padStart(5)}`);
}

// ── H: split by how well Verity tracks the chest ECG ──────────────────────
console.log('\nH · split by r(H,V) — does the Verity corner track the ECG on that night?');
for (const [lab, pred] of [
  ['r ≥ 0.70 (tracking)', (b) => b.s.rHV >= 0.7],
  ['r < 0.70 (decorrelated)', (b) => b.s.rHV < 0.7]
]) {
  const sub = base.filter(pred);
  const g = (k) => {
    const a = sub.map((b) => b.s[k]).filter((x) => x > 0);
    return f(med(a));
  };
  console.log(`    ${lab.padEnd(24)} n=${String(sub.length).padStart(2)}   σ_O2 ${g('o2')}   σ_H10 ${g('h10')}   σ_Ver ${g('verity')}`);
}
