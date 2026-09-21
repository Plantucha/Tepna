#!/usr/bin/env node
/*
 * tools/pletha-marker-oracle.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the project root.
 * ═════════════════════════════════════════════════════════════════════════════
 * SCORE THE "ISOLATED 156 IS A MARKER" HEURISTIC AGAINST THE DEVICE'S OWN BEAT FLAG.
 *
 * `pinnedSpans` (ppgdex-dsp.js) steps over an ISOLATED `156` when merging spans — it treats a lone 156
 * as the O2Ring's inserted beat-marker row and a RUN of 156s as signal that happens to sit at 156.
 * That rule decides whether a marker-split plateau is one span or two, and residue
 * 2026-09-06-marker-isolation-heuristic-unvalidated recorded that it had never been scored against
 * its own failure mode, because `_PPG.txt` carries the marker IN-BAND and cannot say which 156s are
 * beats. The `0x03` pletha stream can: `_PLETHA.txt` carries `beat` OUT-OF-BAND beside every sample.
 *
 * This tool builds the 2×2 the heuristic implies — {lone 156, run 156} × {beat==1, beat==0} — plus the
 * one cell that would falsify the oracle itself (beat==1 on a non-156 row), over every PLETHA file
 * under a root. The heuristic HOLDS iff lone-156 rows are all beat==1, run-156 rows are all beat==0,
 * and no beat lands off a 156. ⚠️ A pass with an EMPTY run cell is vacuous — the 2026-09-06 attempt
 * scored 11/11 on a file with no run of 156s at all and licensed nothing; the run count is printed
 * beside the verdict so a reader can see whether the discriminating case occurred.
 *
 * Streams one file at a time; keeps counts, never rows (lazy-load rule).
 *
 *   node tools/pletha-marker-oracle.mjs <captures-root>     # e.g. …/vigil-archive/captures
 *   node tools/pletha-marker-oracle.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export function scoreRows(vals, beats) {
  const t = { rows: vals.length, loneB1: 0, loneB0: 0, runB1: 0, runB0: 0, beatOff156: 0, runs: 0, longest: 0 };
  let i = 0;
  while (i < vals.length) {
    if (vals[i] === 156) {
      let j = i;
      while (j + 1 < vals.length && vals[j + 1] === 156) j++;
      const n = j - i + 1;
      t.runs++;
      if (n > t.longest) t.longest = n;
      for (let k = i; k <= j; k++) {
        if (n === 1) beats[k] ? t.loneB1++ : t.loneB0++;
        else beats[k] ? t.runB1++ : t.runB0++;
      }
      i = j + 1;
    } else {
      if (beats[i]) t.beatOff156++;
      i++;
    }
  }
  return t;
}

export function verdict(t) {
  const holds = t.loneB0 === 0 && t.runB1 === 0 && t.beatOff156 === 0;
  const runRows = t.runB1 + t.runB0;
  return { holds, vacuous: runRows === 0, runRows, label: !holds ? 'FALSIFIED' : runRows === 0 ? 'HOLDS (vacuous — no run of 156s seen)' : 'HOLDS' };
}

async function scoreFile(p) {
  const vals = [];
  const beats = [];
  let vi = -1;
  let bi = -1;
  const rl = readline.createInterface({ input: fs.createReadStream(p, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const c = line.split(';');
    if (vi < 0) {
      vi = c.indexOf('sample');
      bi = c.indexOf('beat');
      if (vi < 0 || bi < 0) return null; // not a pletha file
      continue;
    }
    vals.push(+c[vi]);
    beats.push(c[bi] === '1');
  }
  return scoreRows(vals, beats);
}

function selftest() {
  let ok = 0;
  const eq = (a, b, m) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      console.error('✗ ' + m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
      process.exit(1);
    }
    ok++;
  };
  // lone markers with beats, one run of 156s without, one beat off a 156
  const v = [97, 156, 98, 156, 156, 99, 156, 100];
  const b = [false, true, false, false, false, false, true, true];
  const t = scoreRows(v, b);
  eq([t.loneB1, t.loneB0, t.runB1, t.runB0, t.beatOff156, t.runs, t.longest], [2, 0, 0, 2, 1, 3, 2], 'the 2x2 and the off-156 cell');
  eq(verdict(t).holds, false, 'a beat off a 156 falsifies');
  const clean = scoreRows([97, 156, 98, 156, 156, 99], [false, true, false, false, false, false]);
  eq(verdict(clean), { holds: true, vacuous: false, runRows: 2, label: 'HOLDS' }, 'lone=beat, run=signal → holds, non-vacuous');
  const vac = scoreRows([97, 156, 98], [false, true, false]);
  eq(verdict(vac).vacuous, true, 'no run of 156s → the pass is VACUOUS and says so');
  eq(verdict(scoreRows([156, 156], [true, false])).holds, false, 'a beat inside a run falsifies');
  console.log('✓ all ' + ok + ' assertions passed');
}

const arg = process.argv[2];
if (arg === '--selftest') selftest();
else if (!arg || !fs.existsSync(arg)) {
  console.error('usage: node tools/pletha-marker-oracle.mjs <captures-root> | --selftest');
  process.exit(2);
} else {
  const files = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const q = path.join(d, n);
      if (fs.statSync(q).isDirectory()) walk(q);
      else if (/_PLETHA\.txt$/.test(n)) files.push(q);
    }
  };
  walk(arg);
  const tot = { rows: 0, loneB1: 0, loneB0: 0, runB1: 0, runB0: 0, beatOff156: 0, runs: 0, longest: 0 };
  let scored = 0;
  for (const f of files.sort()) {
    const t = await scoreFile(f);
    if (!t) continue;
    scored++;
    for (const k of Object.keys(tot)) tot[k] = k === 'longest' ? Math.max(tot[k], t[k]) : tot[k] + t[k];
    const v = verdict(t);
    console.log(`${path.basename(f).slice(-24, -11)}  rows ${String(t.rows).padStart(6)}  runs≥2 ${String(t.runB1 + t.runB0).padStart(3)}  ${v.label}`);
  }
  const v = verdict(tot);
  console.log(`\n${scored} of ${files.length} PLETHA file(s) scored · ${tot.rows} rows`);
  console.log(`  lone 156 · beat=1 ${tot.loneB1}   beat=0 ${tot.loneB0}`);
  console.log(`  run  156 · beat=1 ${tot.runB1}   beat=0 ${tot.runB0}   (runs ${tot.runs}, longest ${tot.longest})`);
  console.log(`  beat=1 on a non-156 row: ${tot.beatOff156}`);
  console.log(`VERDICT: ${v.label}${v.holds && !v.vacuous ? ` — discriminating run rows: ${v.runRows}` : ''}`);
  process.exit(v.holds ? 0 : 1);
}
