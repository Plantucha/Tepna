#!/usr/bin/env node
/*
 * tools/pb-agreement.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DOES OXYDEX'S PERIODIC BREATHING AGREE WITH THE DEVICE'S?
 * (MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS §1.1, re-run per CROSS-DEVICE-CLOCK-SKEW §3.4.)
 *
 * §1.1 tried to answer this EPISODE BY EPISODE — do OxyDex's PB episodes overlap the device's CSR
 * spans — and got 0 of 20. That result was void: the CPAP clock is ~38.28 min slow, so the comparison
 * was measuring the clock, not the detectors.
 *
 * THE RE-RUN CANNOT BE THE SAME COMPARISON, and that is the first thing this tool establishes rather
 * than assumes. The device's PB export carries **exactly one event per night** with
 * `meta.totalSec`/`meta.pct` — a NIGHTLY TOTAL, not located spans. There is nothing to overlap
 * against at episode resolution, with or without a corrected clock. So the episode question is not
 * "still open pending the offset"; it is unanswerable from this export, and saying so is the result.
 *
 * What IS answerable is the question §1.1 actually cared about: OxyDex tells the user "CS pattern
 * likely — review CPAP pressure" on most nights while the machine scores PB on few. That is a
 * NIGHT-LEVEL disagreement, and a night-level comparison is **immune to the clock offset entirely** —
 * which is why this re-run does not need the offset applied at all.
 *
 * OUTPUT: a 2x2 night-level agreement table (device PB yes/no x OxyDex PB yes/no), plus the burden
 * correlation on nights where both fire.
 *
 * USAGE
 *   node tools/pb-agreement.mjs --cpap /tmp/cpap-exports.json [--dir uploads/trio] [--json]
 *     --selftest   known-answer checks for the agreement math (no corpus, no I/O)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const AS_JSON = argv.includes('--json');
const SELFTEST = argv.includes('--selftest');
const DIR = opt('--dir', join(ROOT, 'uploads', 'trio'));
const CPAP = opt('--cpap', null);

/* Cohen's kappa — agreement CORRECTED for chance. Raw percent-agreement is the wrong statistic here:
   when one rater says "yes" on 90 % of nights and the other on 10 %, they agree by accident often
   enough to look concordant. Kappa is what separates "these two see the same thing" from "these two
   are both mostly guessing in their own direction". */
/* ⚠️ κ REFUSES WHEN A RATER NEVER VARIED, because a degenerate κ and a measured κ of 0 print the
   same three characters and mean opposite things.

   Measured 2026-08-17, comparing the rewritten PB detector against the device on a 5-night overlap:
   a=0, b=0, c=1, d=4 — the device scored PB on NO night. That is not `pe === 1`, so the old guard let
   it through: pe = 0.8 and κ = (0.8 − 0.8)/(1 − 0.8) = exactly 0.000. It renders identically to "the
   two methods agree no better than chance" — a real, publishable finding — while the truth was "no
   night was scored positive by both raters, so there is nothing to agree about".

   With a zero margin, κ carries NO information about the other rater: every cell in that rater's
   row/column is forced, so agreement-beyond-chance is undefined rather than absent. The paired-night
   count is therefore not diagnostic metadata to print alongside — it is part of the verdict, which is
   why this refuses rather than returning a number and trusting the reader to check the table.
   Same family as the Clock Contract §2.6: a missing measurement must be visible, never fabricated. */
function kappaOrRefusal(a, b, c, d) {
  const n = a + b + c + d;
  if (!n) return { k: null, why: 'no paired nights' };
  const margins = [
    [a + b, 'the device scored PB on NO night'],
    [c + d, 'the device scored PB on EVERY night'],
    [a + c, 'OxyDex flagged PB on NO night'],
    [b + d, 'OxyDex flagged PB on EVERY night']
  ];
  for (const [m, why] of margins) if (m === 0) return { k: null, why: `${why} (n=${n}) — one rater never varied, so κ is UNDEFINED, not 0` };
  const po = (a + d) / n;
  const pe = (((a + b) * (a + c)) / n + ((c + d) * (b + d)) / n) / n;
  if (pe === 1) return { k: null, why: 'expected agreement is 1 — κ undefined' };
  return { k: (po - pe) / (1 - pe), why: null };
}
/* Thin wrapper so existing callers and the JSON field keep their shape. */
function kappa(a, b, c, d) {
  return kappaOrRefusal(a, b, c, d).k;
}
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx,
      dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

if (SELFTEST) {
  let bad = 0;
  const near = (l, got, want, tol) => {
    const ok = got != null && Math.abs(got - want) <= tol;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${l}: got ${got}, want ${want} ±${tol}`);
  };
  near('kappa perfect agreement', kappa(10, 0, 0, 10), 1, 1e-12);
  near('kappa chance-level', kappa(25, 25, 25, 25), 0, 1e-12);
  // the case this exists for: both raters mostly-yes, high raw agreement, NO real concordance
  near('kappa ~0 despite 82% raw agreement', kappa(90, 5, 5, 0), 0, 0.06);
  near('pearson perfect', pearson([1, 2, 3], [2, 4, 6]), 1, 1e-12);

  /* THE DEGENERATE CASES — each of these used to print a confident 0.000. */
  const refuses = (l, a, b, c, d) => {
    const r = kappaOrRefusal(a, b, c, d);
    const ok = r.k === null && typeof r.why === 'string' && r.why.length > 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${l}: k=${r.k}, why=${JSON.stringify(r.why)}`);
  };
  // the exact table measured 2026-08-17 on the 5-night overlap — device never positive
  refuses('REFUSES the real 2026-08-17 table (0,0,1,4) rather than printing 0.000', 0, 0, 1, 4);
  refuses('REFUSES when the device scored PB on every night', 3, 0, 0, 0);
  refuses('REFUSES when OxyDex flagged PB on no night', 0, 4, 0, 6);
  refuses('REFUSES when OxyDex flagged PB on every night', 4, 0, 6, 0);
  refuses('REFUSES an empty table', 0, 0, 0, 0);
  /* ANTI-VACUITY: a function that refused everything would pass all five above. The three
     non-degenerate cases at the top must still return numbers — they are asserted by `near`. */
  const live = kappaOrRefusal(90, 5, 5, 0);
  const okLive = live.k != null && live.why === null;
  if (!okLive) bad++;
  console.log(`${okLive ? 'ok  ' : 'FAIL'} and a NON-degenerate table still returns a number (guard is not blanket): k=${live.k == null ? null : live.k.toFixed(3)}`);

  console.log(bad ? `\n${bad} FAILED` : '\nall selftests pass');
  process.exit(bad ? 1 : 0);
}

if (!CPAP || !existsSync(CPAP)) {
  console.error('pb-agreement: --cpap <exports.json> required.\n  node tools/cpap-corpus.mjs --root <SD>/DATALOG --out /tmp/cpap-exports.json\n');
  process.exit(2);
}
if (!existsSync(DIR)) {
  console.error(`pb-agreement: ${DIR} does not exist (run tools/trio-batch.mjs first).\n`);
  process.exit(2);
}

const raw = JSON.parse(readFileSync(CPAP, 'utf8'));
const cpapNights = Array.isArray(raw) ? raw : raw.nights || raw.exports || [];
const dev = new Map(); // 'YYYY-MM-DD' → { totalSec, pct } | { totalSec: 0 }
let multiSpan = 0;
for (const n of cpapNights) {
  const day = n._day || (n.recording && n.recording._day);
  if (!day) continue;
  const key = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const pb = (n.ganglior_events || []).filter((e) => e.impulse === 'periodic_breathing');
  if (pb.length > 1) multiSpan++;
  dev.set(key, pb.length ? { totalSec: (pb[0].meta && pb[0].meta.totalSec) || 0, pct: (pb[0].meta && pb[0].meta.pct) || 0 } : { totalSec: 0, pct: 0 });
}

const rows = [];
for (const night of readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()) {
  const f = join(DIR, night, `OxyDex_${night}.node-export.json`);
  if (!existsSync(f) || !dev.has(night)) continue;
  let j;
  try {
    j = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  const pb = (j.ganglior_events || []).filter((e) => e.impulse === 'periodic_breathing');
  // OxyDex PB events are per-WINDOW detections (meta.windowSec), so burden ≈ n * windowSec.
  const oxySec = pb.reduce((s, e) => s + ((e.meta && e.meta.windowSec) || 300), 0);
  const D = dev.get(night);
  rows.push({ night, oxyN: pb.length, oxySec, devSec: D.totalSec, devPct: D.pct });
}

const a = rows.filter((r) => r.devSec > 0 && r.oxyN > 0).length; // both
const b = rows.filter((r) => r.devSec > 0 && r.oxyN === 0).length; // device only
const c = rows.filter((r) => r.devSec === 0 && r.oxyN > 0).length; // OxyDex only
const d = rows.filter((r) => r.devSec === 0 && r.oxyN === 0).length; // neither
const kr = kappaOrRefusal(a, b, c, d);
const k = kr.k;
const both = rows.filter((r) => r.devSec > 0 && r.oxyN > 0);
const r =
  both.length >= 3
    ? pearson(
        both.map((x) => x.oxySec),
        both.map((x) => x.devSec)
      )
    : null;

if (AS_JSON) {
  console.log(
    JSON.stringify({ dir: DIR, cpap: CPAP, nights: rows.length, table: { both: a, deviceOnly: b, oxyOnly: c, neither: d }, kappa: k, burdenR: r, multiSpanNights: multiSpan, rows }, null, 2)
  );
  process.exit(0);
}

console.log(`\npb-agreement — ${rows.length} paired night(s)`);
console.log(`\nThe device exports PB as ONE event per night carrying meta.totalSec — a nightly TOTAL, not`);
console.log(`located spans (${multiSpan} night(s) carried more than one). So an episode-by-episode overlap is`);
console.log(`not possible from this export, with or without the ~38.28 min clock correction. This is the`);
console.log(`night-level comparison instead, which the clock offset cannot affect.\n`);
console.log('                    OxyDex PB   OxyDex none');
console.log(`  device PB          ${String(a).padEnd(11)} ${b}`);
console.log(`  device none        ${String(c).padEnd(11)} ${d}`);
console.log(`\n  Cohen's kappa (chance-corrected agreement): ${k == null ? `— REFUSED: ${kr.why}` : k.toFixed(3)}`);
console.log(`  OxyDex flags PB on ${a + c}/${rows.length} nights; the device on ${a + b}/${rows.length}.`);
if (r != null) console.log(`  burden correlation where BOTH fire (n=${both.length}): r = ${r.toFixed(3)}`);
else console.log(`  burden correlation: n=${both.length} nights where both fire — too few to report`);
console.log('');
