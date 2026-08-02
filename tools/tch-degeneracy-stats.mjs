#!/usr/bin/env node
/*
 * tools/tch-degeneracy-stats.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * HOW OFTEN DOES THE THREE-CORNERED HAT GO DEGENERATE, AND ON WHAT KIND OF NIGHT?
 * (TRIO-ARTIFACT-GATE-AND-N15-POWER §5's last Done-when item.)
 *
 * That item reads: *"several nights still yield negative variance (σ = null) or implausibly small σ
 * … That is the known quiet-order / correlated-error regime … a SEPARATE defect from artifact
 * contamination."* Three things in it are assertions rather than measurements — **how many** nights,
 * **which corner** lands on the boundary, and **whether** the correlated-error reading holds.
 *
 * THIS TOOL DOES NOT RE-ESTIMATE ANYTHING. `tools/tch-multinight.mjs --dir` already runs the shipped
 * `IntegratorTCH.threeCorneredHat` and already prints the excluded-night block with each night's σ
 * triple. This reads THAT output and does the arithmetic the brief's item asks for, so the primary
 * measurement stays the committed tool's own and this adds only counting + a permutation test.
 *
 * WHY A PERMUTATION TEST AND NOT A t-TEST: n = 8 degenerate nights. Nothing here is normal, nothing
 * here is well-powered, and the honest deliverable is as likely to be "not establishable at this n"
 * as a number — which is precisely what it turned out to be for the corner attribution.
 *
 * USAGE
 *   node tools/tch-multinight.mjs --dir uploads/trio > /tmp/tch.txt
 *   node tools/tch-degeneracy-stats.mjs /tmp/tch.txt
 *     --selftest   known-answer check on a synthetic fixture of that output (no corpus, no I/O)
 */
import { readFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const SELFTEST = argv.includes('--selftest');

/* Column order in tch-multinight's magnitude table and its median lines: ECGDex / PpgDex / OxyDex. */
const CORNERS = ['ECGDex', 'PpgDex', 'OxyDex'];

export function parseTch(txt) {
  const excluded = new Set();
  const sig = {};
  for (const m of txt.matchAll(/^\s+(\d{4}-\d\d-\d\d)\s+σ\s+([\d.]+)\/([\d.]+)\/([\d.]+)/gm)) {
    excluded.add(m[1]);
    sig[m[1]] = [+m[2], +m[3], +m[4]];
  }
  const rows = [];
  for (const m of txt.matchAll(/^\s+(\d{4}-\d\d-\d\d)\s+(\d+)\s+([\d.]+)\s+\S+\s+([\d.]+)\/([\d.]+)\/([\d.]+)/gm)) rows.push({ night: m[1], epochs: +m[2], rho: +m[3] });
  return { rows, excluded, sig };
}

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/* Deterministic LCG — no Math.random (house rule: a reported p-value must be reproducible). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* Two-sided Mann–Whitney by permutation. Two-sided ON PURPOSE: the direction was chosen after
   looking at the medians, so a one-sided p here would be the garden of forking paths. */
export function permTest(a, b, iters = 40000, seed = 1) {
  const U = (x, y) => {
    let u = 0;
    for (const p of x) for (const q of y) u += p > q ? 1 : p === q ? 0.5 : 0;
    return u;
  };
  const obs = U(a, b),
    all = a.concat(b),
    n1 = a.length,
    mid = (a.length * b.length) / 2;
  const rnd = lcg(seed);
  let hits = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = all[i];
      all[i] = all[j];
      all[j] = t;
    }
    if (Math.abs(U(all.slice(0, n1), all.slice(n1)) - mid) >= Math.abs(obs - mid)) hits++;
  }
  return { U: obs, p: hits / iters };
}

/* Exact one-sided binomial tail, for "is one corner over-represented on the boundary?" */
export function binomTail(k, n, p) {
  const C = (a, b) => {
    let r = 1;
    for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1);
    return r;
  };
  let s = 0;
  for (let i = k; i <= n; i++) s += C(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i);
  return s;
}

function report(txt) {
  const { rows, excluded, sig } = parseTch(txt);
  if (!rows.length) {
    console.error('no magnitude-table rows parsed — pipe `tch-multinight.mjs --dir <corpus>` output in');
    process.exit(2);
  }
  const tally = Object.fromEntries(CORNERS.map((c) => [c, 0]));
  for (const n of excluded) {
    const s = sig[n];
    tally[CORNERS[s.indexOf(Math.min.apply(null, s))]]++;
  }
  const nExc = excluded.size;
  const top = CORNERS.reduce((a, c) => (tally[c] > tally[a] ? c : a), CORNERS[0]);
  const pCorner = binomTail(tally[top], nExc, 1 / 3);
  const rhoExc = rows.filter((r) => excluded.has(r.night)).map((r) => r.rho);
  const rhoInc = rows.filter((r) => !excluded.has(r.night)).map((r) => r.rho);
  const t = permTest(rhoExc, rhoInc);

  console.log('TCH DEGENERACY — TRIO-ARTIFACT-GATE §5, last Done-when item\n');
  console.log('  nights in table              : ' + rows.length);
  console.log('  DEGENERATE (negative classic) : ' + nExc + '  (' + ((nExc / rows.length) * 100).toFixed(0) + ' %)');
  console.log('\n  boundary member (the ~0 corner):');
  for (const c of CORNERS) console.log('    ' + c.padEnd(8) + ' ' + tally[c]);
  console.log('    → P(X ≥ ' + tally[top] + ' | n=' + nExc + ', uniform 1/3) = ' + pCorner.toFixed(3) + (pCorner > 0.05 ? '   NOT establishable at this n' : ''));
  console.log('\n  co-motion ρ (the parameter the correlated fit uses to rescue these nights):');
  console.log('    degenerate  n=' + rhoExc.length + '  median ' + median(rhoExc).toFixed(2));
  console.log('    estimated   n=' + rhoInc.length + '  median ' + median(rhoInc).toFixed(2));
  console.log('    → two-sided permutation p = ' + t.p.toFixed(3) + (t.p > 0.05 ? '   suggestive, not significant' : ''));
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (d != null && !c ? '  — ' + d : ''));
    if (!c) fail++;
  };
  const fixture = [
    '  2026-01-01 80  0.50  classic→classic           1.00/2.00/3.00        1.00/2.00/3.00        PpgDex',
    '  2026-01-02 80  0.10  correlated→correlated     1.00/2.00/0.01        1.00/2.00/0.01        PpgDex',
    '    2 night(s) EXCLUDED — negative classic variance,',
    '      2026-01-02  σ 1.00/2.00/0.01  (method correlated)',
    '      2026-01-03  σ 0.02/2.00/3.00  (method correlated)'
  ].join('\n');
  const { rows, excluded, sig } = parseTch(fixture);
  ok('parses the magnitude table', rows.length === 2, 'rows=' + rows.length);
  ok('parses the excluded block', excluded.size === 2 && sig['2026-01-03'][0] === 0.02, JSON.stringify([...excluded]));
  ok('boundary member is the MINIMUM σ, not a fixed column', CORNERS[sig['2026-01-03'].indexOf(Math.min(...sig['2026-01-03']))] === 'ECGDex');
  // Known answers for the statistics, so a refactor cannot quietly change a published p-value.
  ok('binomTail(5,8,1/3) ≈ 0.088', Math.abs(binomTail(5, 8, 1 / 3) - 0.0879) < 0.001, binomTail(5, 8, 1 / 3).toFixed(4));
  ok('binomTail(8,8,1/3) ≈ 1/6561', Math.abs(binomTail(8, 8, 1 / 3) - 1 / 6561) < 1e-6);
  // A separated pair must come back small; an interleaved pair must not.
  const sep = permTest([1, 2, 3], [10, 11, 12, 13], 4000);
  const mix = permTest([1, 5, 9], [2, 6, 10, 14], 4000);
  ok('permTest separates a clearly-shifted pair', sep.p < 0.1, 'p=' + sep.p.toFixed(3));
  ok('…and does NOT flag an interleaved pair', mix.p > 0.3, 'p=' + mix.p.toFixed(3));
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}

if (SELFTEST) process.exit(selftest());
const path = argv.find((a) => !a.startsWith('--'));
if (!path || !existsSync(path)) {
  console.error('usage: node tools/tch-multinight.mjs --dir uploads/trio > /tmp/tch.txt && node tools/tch-degeneracy-stats.mjs /tmp/tch.txt');
  process.exit(2);
}
report(readFileSync(path, 'utf8'));
