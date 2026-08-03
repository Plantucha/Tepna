#!/usr/bin/env node
/*
 * tools/rho-overlap-power.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * HOW MUCH OVERLAP DOES rho NEED? — measured, so a minimum-n rule can be DERIVED or REFUSED.
 *
 * `INTEGRATOR-TCH-FU-IV-FOLLOWUPS` §4 asks for a minimum aligned-overlap rule and is explicit that it
 * must come "from how rho's stability varies with n on the corpus, not from a round number". This
 * measures that curve: per night, per node-pair, take the aligned per-epoch motion series and for each
 * subsample size k draw many random subsets, recording the SD of Pearson r across draws.
 *
 * TWO THINGS IT GETS RIGHT THAT THE OBVIOUS VERSION DOES NOT:
 *
 *  1. FINITE-POPULATION CORRECTION. Subsampling k of N without replacement shrinks the spread by
 *     sqrt((N-k)/(N-1)). At k=80 of N=86 every draw is nearly the same set, so the raw SD collapses to
 *     0.027 — which would claim a precision that does not exist and put a "knee" in the curve that is
 *     pure artifact. Corrected, the same point reads 0.113.
 *  2. IT REPORTS THE ANALYTIC (1-r^2)/sqrt(k-3) BESIDE IT, so the measurement can be checked rather
 *     than trusted. Real motion is heavier-tailed than the Gaussian the analytic assumes, and the
 *     measured SD sits ~1.2-1.4x above it at every k — consistently, which is the signature of a real
 *     distributional difference rather than a bug in either.
 *
 * SCOPE: measures the PAIRWISE r. The published rho is the magnitude-weighted aggregate over up to 3
 * pairs, so SD(rho) is somewhat lower than SD(r) — this is an upper bound on the aggregate's spread.
 *
 * USAGE: node tools/rho-overlap-power.mjs      (reads the committed uploads/trio corpus)
 */
/* Implementation. Original note: How does rho's SAMPLING SPREAD vary with n? Measured on the committed 25-night trio corpus.
   Per night, per node-pair, take the aligned per-epoch motion series, then for each subsample size k
   draw many random subsets and record the SD of Pearson r across draws. Deterministic RNG. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pear = (a, b) => {
  const xs = [],
    ys = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] != null && b[i] != null && isFinite(a[i]) && isFinite(b[i])) {
      xs.push(a[i]);
      ys.push(b[i]);
    }
  }
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n,
    my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx,
      dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
};
let seed = 20260803;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
// per-epoch motion, keyed by tMin, from each node export
const motionOf = (f) => {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const eps = (d.timeseries && d.timeseries.epochs) || [];
  const m = new Map();
  for (const e of eps) {
    if (e && e.tMin != null && e.motionIndex != null) m.set(Math.round(e.tMin), e.motionIndex);
  }
  return m;
};
const nights = fs
  .readdirSync(path.join(ROOT, 'uploads/trio'))
  .filter((d) => /^\d{4}-/.test(d))
  .sort();
const KS = [10, 15, 20, 30, 40, 60, 80];
const DRAWS = 400;
const acc = new Map(KS.map((k) => [k, []]));
let pairsUsed = 0,
  nightsUsed = 0;
for (const night of nights) {
  const dir = path.join(ROOT, 'uploads/trio', night);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.node-export.json'));
  const ms = files.map((f) => ({ node: f.split('_')[0], m: motionOf(path.join(dir, f)) })).filter((x) => x.m.size > 0);
  if (ms.length < 2) continue;
  nightsUsed++;
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++) {
      const keys = [...ms[i].m.keys()].filter((k) => ms[j].m.has(k)).sort((a, b) => a - b);
      if (keys.length < 10) continue;
      const A = keys.map((k) => ms[i].m.get(k)),
        B = keys.map((k) => ms[j].m.get(k));
      const full = pear(A, B);
      if (full == null) continue;
      pairsUsed++;
      for (const k of KS) {
        if (keys.length < k) continue;
        const rs = [];
        for (let d = 0; d < DRAWS; d++) {
          const idx = [];
          const pool = [...Array(keys.length).keys()];
          for (let t = 0; t < k; t++) {
            const p = Math.floor(rnd() * pool.length);
            idx.push(pool[p]);
            pool.splice(p, 1);
          }
          const r = pear(
            idx.map((x) => A[x]),
            idx.map((x) => B[x])
          );
          if (r != null) rs.push(r);
        }
        if (rs.length < 50) continue;
        const mu = rs.reduce((s, v) => s + v, 0) / rs.length;
        const sd = Math.sqrt(rs.reduce((s, v) => s + (v - mu) * (v - mu), 0) / (rs.length - 1));
        /* FINITE-POPULATION CORRECTION. Subsampling k of N WITHOUT replacement shrinks the spread by
         sqrt((N-k)/(N-1)) — at k=80 of N=86 every draw is nearly the same set, so the raw SD collapses
         toward 0 and would claim a precision that does not exist. Divide it back out to recover the
         SD an INDEPENDENT sample of size k would have, which is the quantity a minimum-n rule needs. */
        const N = keys.length,
          fpc = Math.sqrt((N - k) / (N - 1));
        acc.get(k).push({ sd, sdCorr: fpc > 0 ? sd / fpc : null, full, n: N });
      }
    }
}
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : null;
};
console.log(`nights ${nightsUsed}, pairs ${pairsUsed}, ${DRAWS} draws per (pair,k)\n`);
console.log(' k    median SD(r) [FPC-corrected]   IQR              pairs   analytic (1-r²)/√(k-3)');
for (const k of KS) {
  const rows = acc.get(k);
  if (!rows.length) {
    console.log(` ${String(k).padStart(2)}    (no pair has this many epochs)`);
    continue;
  }
  const sds = rows
    .map((r) => r.sdCorr)
    .filter((v) => v != null && isFinite(v))
    .sort((a, b) => a - b);
  const q = (p) => sds[Math.floor(sds.length * p)];
  const analytic = med(rows.map((r) => (1 - r.full * r.full) / Math.sqrt(k - 3)));
  console.log(` ${String(k).padStart(2)}    ${med(sds).toFixed(3)}          ${q(0.25).toFixed(3)}–${q(0.75).toFixed(3)}        ${String(rows.length).padStart(4)}    ${analytic.toFixed(3)}`);
}
