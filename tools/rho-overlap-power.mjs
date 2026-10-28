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
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries, snapshotNights } from './corpus-scope-core.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'tools/rho-overlap-power.mjs';
const EV = [TOOL, 'tools/corpus-scope-core.mjs'];
const TRIO = path.join(ROOT, 'uploads/trio');
/* ── THE POPULATION THIS CURVE IS MEASURED OVER ──────────────────────────────────────────────
   Row 2026-10-21-forty-one-corpus-enumerators-report-no-population. The header line said
   `nights N, pairs M`, which is a count of what the run USED and says nothing about what the root
   OFFERED: a night whose exports carry no motion series, or carry only one node's, drops out at
   `ms.length < 2` and left no trace. The two numbers answer different questions, and a minimum-n
   rule derived from the curve needs the second one to know what the curve is about. */
/* A NAMED lister, because `snapshotEntries` publishes `rule: list.name` and an inline arrow would
   publish `rule: null` — the one decision the caller makes, unrecorded. */
function sampleNights() {
  return ['2026-06-10', '2026-06-11', '2026-06-12'];
}
/* The adoption sample reads no corpus: a fixed three-night list stands in for the walk, so the
   object's shape is checkable on a machine that has no uploads tree at all. */
/* THE SAMPLE LIVES IN A NAMED HELPER, because `corpus-reads.mjs` blanks a `verdictSample` body
   before it decides whether this tool reports a population: a fabricated call left at top level
   would clear the tool over a walk no run makes (the lesson its own CONTROL leg records). */
function verdictSample() {
  const at = '2026-10-28T00:00:00Z';
  const snap = snapshotEntries('<uploads>/trio', { list: sampleNights, unit: 'nights', at });
  return populationVerdict(snap, snap, { tool: TOOL, at, evidence: EV });
}
if (process.argv.slice(2).includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
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
/* THE TOOL'S OWN RULE TRAVELS INTO THE SNAPSHOT. This walk admits `^\d{4}-` rather than the full
   night shape, so passing the default would silently change which directories are offered. The
   snapshot publishes the rule it was given, and a loose rule admitting a non-night directory now
   says so in `admittedNonNight` instead of folding it into the curve. */
const NIGHT_RULE = /^\d{4}-/;
const snapBefore = snapshotNights(TRIO, { re: NIGHT_RULE });
if (!snapBefore.ok) {
  console.error(`refused: ${snapBefore.reason} — ${TRIO}`);
  console.log('POPULATION ' + JSON.stringify(populationVerdict(snapBefore, snapBefore, { tool: TOOL, evidence: EV })));
  process.exit(2);
}
const nights = snapBefore.nights;
const scoredNights = [];
const KS = [10, 15, 20, 30, 40, 60, 80];
const DRAWS = 400;
const acc = new Map(KS.map((k) => [k, []]));
let pairsUsed = 0,
  nightsUsed = 0;
for (const night of nights) {
  const dir = path.join(TRIO, night);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.node-export.json'));
  const ms = files.map((f) => ({ node: f.split('_')[0], m: motionOf(path.join(dir, f)) })).filter((x) => x.m.size > 0);
  if (ms.length < 2) continue;
  nightsUsed++;
  scoredNights.push(night);
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
/* ── THE POPULATION, PUBLISHED BEFORE THE CURVE ─────────────────────────────────────────────
   Printed here rather than at the end so the object sits beside the count it qualifies, and so a
   reader who stops at the table has already seen what the table is about. */
const commitOf = gitCommitOf();
const population = populationVerdict(snapBefore, snapshotNights(TRIO, { re: NIGHT_RULE }), {
  commit: commitOf.commit,
  commitReason: commitOf.reason,
  tool: TOOL,
  evidence: EV
});
console.log(
  `population: ${snapBefore.n} night(s) offered under ${TRIO} · ${scoredNights.length} contributed a node pair · movement ${population.status}` + (population.reason ? ` — ${population.reason}` : '')
);
const populationRule = ruleLine(population);
if (populationRule) console.log(populationRule);
/* THE OTHER HALF. The verdict is about MOVEMENT between the two walks; it says nothing about the
   offered nights this run never scored, and a COUNT names none of them. The cause here is always
   the same one — fewer than two nodes with a motion series — so the names are the chase list. */
/* 🔴 `notCovered` READS `row[key]`, SO A LIST OF NAMES COVERS NOTHING. Passing `scoredNights`
   bare made every one of the 147 offered nights read as unscored, one line under a count saying 104
   contributed — a contradiction inside one paragraph, and the arithmetic below is the control that
   catches it rather than the eye. */
const unscored = notCovered(
  snapBefore,
  scoredNights.map((night) => ({ night })),
  { key: 'night' }
);
if (unscored.length !== snapBefore.n - scoredNights.length) throw new Error(`population arithmetic: ${snapBefore.n} offered − ${scoredNights.length} scored ≠ ${unscored.length} unscored`);
if (unscored.length)
  console.log(`  ${unscored.length} offered night(s) contributed no pair, by name: ${unscored.slice(0, 8).join(' · ')}${unscored.length > 8 ? ` · … (+${unscored.length - 8})` : ''}`);
console.log('POPULATION ' + JSON.stringify(population) + '\n');
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
/* 🔴 A CURVE OVER NOTHING IS NOT A CURVE. Every `continue` above is silent, so a root that offered
   nights and yielded no pair printed seven `(no pair has this many epochs)` lines and exited 0 —
   the way a complete run exits. The population object states it; the exit code makes a caller act
   on it (§∅: a run that examined nothing reports the absence). */
/* ONE EXIT RULE ACROSS THE FOUR TOOLS THIS SLICE WIRED: a population that could not be enumerated
   (`NOT_RUN`) and a run that scored none of what was offered both exit 2. A SHORTFALL exits 0 on
   purpose — a moved population still describes one continuous set, its intersection, so reduced
   coverage annotates where a discontinuity refuses (owner ruling 2026-09-17, §∅). */
if (population.status === 'NOT_RUN' || scoredNights.length === 0) {
  console.error(`examined nothing: ${snapBefore.n} night(s) offered, ${scoredNights.length} contributed a node pair with a motion series`);
  process.exit(2);
}
